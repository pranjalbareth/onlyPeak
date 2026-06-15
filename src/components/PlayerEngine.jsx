// src/components/PlayerEngine.jsx
// HEADLESS playback engine (Section 9). Bridges the playerStore (intent) and the
// browser's audio side effects.
//
// TWO interchangeable <audio> elements (A and B). At any moment one is the ACTIVE
// output (it represents playerStore.currentPeak); the other is used to preload
// the next peak and, when crossfade is enabled, to fade the next peak in while
// the active one fades out. After a transition the two simply swap roles — the
// incoming element becomes active — which keeps transitions gapless without
// reloading a source.
//
// Crossfade (build-spec Section 11, Phase 6) is opt-in via Settings → Crossfade.
//   - 0 ms (default): hard cut. The active peak plays to its end, the queue
//     advances, and the preloaded next element swaps in gaplessly. This path is
//     behaviourally identical to the original single-element engine.
//   - >0 ms: a few seconds before the active peak ends we start the next peak on
//     the other element and ramp the two volumes over the crossfade duration,
//     then swap + advance the store. Smoothest on downloaded (already-trimmed)
//     peaks; online peaks fade in once the stream is seekable.
//
// Online streams are the full song, so the active element is seeked to startSec
// and timeupdate fires the advance at endSec. Cached clips are pre-trimmed and
// play from 0; their natural 'ended' (or the crossfade window) advances.

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { getPeak, getAudioBlob, hasAudioBlob } from '../db/index.js';
import { audioUrl } from '../lib/api.js';
import {
  setupMediaSession,
  updateMetadata,
  setPlaybackState,
  setPositionState,
} from '../lib/mediaSession.js';

export default function PlayerEngine() {
  const aRef = useRef(null);
  const bRef = useRef(null);

  // Which element is the audible/current one.
  const activeKeyRef = useRef('a');
  // Object URL assigned to each element (revoked on reassign / unmount).
  const urlRef = useRef({ a: null, b: null });
  // What each element currently holds: { peakId, sourceType } | null.
  const loadedRef = useRef({ a: null, b: null });

  // Live [startSec, endSec] of the ACTIVE peak for the timeupdate handler.
  const boundsRef = useRef({ startSec: 0, endSec: 0 });

  // Latch so a peak's end advances the queue at most once (timeupdate fires ~4x/s
  // and loads are async). Cleared on any re-seek / fresh start.
  const endedFiredRef = useRef(false);

  // Crossfade state: { active, rafId }.
  const xfadeRef = useRef({ active: false, rafId: 0 });
  // Coordination so the store-advance a crossfade triggers doesn't make the
  // store-driven effects reload/re-seek the already-positioned incoming element.
  const skipReloadForRef = useRef(null);   // peakId to skip in the peakKey effect
  const skipSeekTokenRef = useRef(-1);     // seekToken value to skip in the seek effect

  const elOf = (key) => (key === 'a' ? aRef.current : bRef.current);
  const otherKeyOf = (key) => (key === 'a' ? 'b' : 'a');

  function revokeUrl(key) {
    if (urlRef.current[key]) {
      URL.revokeObjectURL(urlRef.current[key]);
      urlRef.current[key] = null;
    }
  }

  function crossfadeSec() {
    const ms = useLibraryStore.getState().settings?.crossfadeMs || 0;
    return ms / 1000;
  }

  /** Assign the right source (cached blob or online stream) to an element. */
  async function loadInto(key, peak, sourceType) {
    const el = elOf(key);
    if (!el) return;
    const cur = loadedRef.current[key];
    if (cur && cur.peakId === peak.id && cur.sourceType === sourceType) return; // already loaded

    if (sourceType === 'cached') {
      const blob = await getAudioBlob(peak.id);
      if (blob) {
        revokeUrl(key);
        const url = URL.createObjectURL(blob);
        urlRef.current[key] = url;
        el.src = url;
        el.load();
        loadedRef.current[key] = { peakId: peak.id, sourceType: 'cached' };
        return;
      }
      // Blob vanished -> fall through to the online stream.
    }
    revokeUrl(key);
    el.src = audioUrl(peak.videoId);
    el.load();
    loadedRef.current[key] = { peakId: peak.id, sourceType: 'online' };
  }

  function pushMediaMeta() {
    const { currentPeak, currentSong } = usePlayerStore.getState();
    if (!currentPeak) return;
    updateMetadata({
      title: currentPeak.title,
      artist: currentSong?.artist,
      artworkUrl: currentSong?.thumbnailUrl,
    });
    const len = Math.max(0, (currentPeak.endSec || 0) - (currentPeak.startSec || 0));
    setPositionState({ durationSec: len, positionSec: 0 });
  }

  /** Stop a running volume ramp + clear the crossfade flag (no element changes). */
  function stopRamp() {
    if (xfadeRef.current.rafId) cancelAnimationFrame(xfadeRef.current.rafId);
    xfadeRef.current = { active: false, rafId: 0 };
  }

  function cancelCrossfade() {
    if (!xfadeRef.current.active) return;
    stopRamp();
    const otherKey = otherKeyOf(activeKeyRef.current);
    const other = elOf(otherKey);
    if (other) {
      other.pause();
      other.volume = 1;
      other.muted = true;
    }
    const act = elOf(activeKeyRef.current);
    if (act) act.volume = 1;
  }

  function rampVolumes(fromKey, toKey, durSec, onDone) {
    const from = elOf(fromKey);
    const to = elOf(toKey);
    const startT = performance.now();
    const dur = Math.max(100, durSec * 1000);
    const step = (now) => {
      if (!xfadeRef.current.active) return; // cancelled
      const t = Math.min(1, (now - startT) / dur);
      if (from) from.volume = Math.max(0, 1 - t);
      if (to) to.volume = Math.min(1, t);
      if (t < 1) {
        xfadeRef.current.rafId = requestAnimationFrame(step);
      } else {
        onDone();
      }
    };
    xfadeRef.current.rafId = requestAnimationFrame(step);
  }

  function finishCrossfade(toKey, peak, nextIndex) {
    const fromKey = activeKeyRef.current;
    const from = elOf(fromKey);
    if (from) {
      from.pause();
      from.volume = 1;
    }
    activeKeyRef.current = toKey;
    const to = elOf(toKey);
    if (to) to.volume = 1;
    boundsRef.current = { startSec: peak.startSec || 0, endSec: peak.endSec || 0 };
    endedFiredRef.current = false;
    xfadeRef.current = { active: false, rafId: 0 };

    // Advance the store to the peak we just faded in WITHOUT a reload/re-seek
    // (the incoming element is already positioned and playing).
    const store = usePlayerStore.getState();
    skipReloadForRef.current = peak.id;
    skipSeekTokenRef.current = store.seekToken + 1; // _loadCurrent bumps it by 1
    store._goTo(nextIndex);
  }

  async function beginCrossfade(durSec) {
    if (xfadeRef.current.active) return;
    xfadeRef.current.active = true;

    const store = usePlayerStore.getState();
    const { index, queue, loopPlaylist } = store;
    let nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (loopPlaylist && queue.length > 1) nextIndex = 0;
      else {
        xfadeRef.current.active = false;
        return;
      }
    }
    const nextId = queue[nextIndex];
    if (!nextId) {
      xfadeRef.current.active = false;
      return;
    }

    // From here the active element must not also hard-advance at its own end.
    endedFiredRef.current = true;

    const peak = await getPeak(nextId);
    if (!peak || !xfadeRef.current.active) {
      if (xfadeRef.current.active) xfadeRef.current.active = false;
      return;
    }
    const cached = await hasAudioBlob(nextId);
    const sourceType = cached ? 'cached' : 'online';
    const toKey = otherKeyOf(activeKeyRef.current);
    await loadInto(toKey, peak, sourceType);
    if (!xfadeRef.current.active) return; // cancelled during awaits

    const to = elOf(toKey);
    const fromKey = activeKeyRef.current;
    const startAt = sourceType === 'online' ? peak.startSec || 0 : 0;

    const begin = () => {
      if (!xfadeRef.current.active || !to) return;
      try {
        to.currentTime = startAt;
      } catch {
        // not seekable yet; canplay path will have set it
      }
      to.muted = false;
      to.volume = 0;
      const p = to.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      rampVolumes(fromKey, toKey, durSec, () => finishCrossfade(toKey, peak, nextIndex));
    };

    if (to.readyState >= 2) {
      begin();
    } else {
      const once = () => {
        to.removeEventListener('canplay', once);
        begin();
      };
      to.addEventListener('canplay', once);
    }
  }

  // ----------------------------------------------------------------------------
  // One-time wiring: MediaSession + audio listeners on BOTH elements.
  // ----------------------------------------------------------------------------
  useEffect(() => {
    const store = usePlayerStore.getState;

    const teardown = setupMediaSession({
      onPlay: () => store().play(),
      onPause: () => store().pause(),
      onPrev: () => store().prev(),
      onNext: () => store().next(),
      onSeek: (sec) => store().seek(sec),
    });

    const a = aRef.current;
    const b = bRef.current;
    if (a) a.loop = false;
    if (b) b.loop = false;

    const isActive = (target) => target === elOf(activeKeyRef.current);

    // ONLINE active only: jump to the peak start once the stream can seek.
    const onCanPlaySeek = (e) => {
      if (!isActive(e.target)) return;
      const s = store();
      if (s.sourceType !== 'online') return;
      const { startSec } = boundsRef.current;
      const target = startSec + s.positionSec;
      if (Number.isFinite(target) && Math.abs(e.target.currentTime - target) > 0.25) {
        try {
          e.target.currentTime = target;
        } catch {
          // retried on a later canplay
        }
      }
    };

    const onTimeUpdate = (e) => {
      if (!isActive(e.target)) return; // ignore the fading-out / preload element
      const audio = e.target;
      const s = store();
      const { startSec, endSec } = boundsRef.current;

      if (s.sourceType === 'cached') {
        s.setPosition(audio.currentTime);
      } else {
        const pos = audio.currentTime - startSec;
        s.setPosition(pos > 0 ? pos : 0);
      }

      if (endedFiredRef.current) return;

      // Remaining time until this peak's end.
      let remaining;
      if (s.sourceType === 'cached') {
        const dur = Number.isFinite(audio.duration) ? audio.duration : endSec - startSec;
        remaining = dur - audio.currentTime;
      } else {
        remaining = endSec - audio.currentTime;
      }

      if (remaining <= 0) {
        endedFiredRef.current = true;
        s.handleEnded();
        return;
      }

      // Crossfade window: start the next peak early and blend.
      const xf = crossfadeSec();
      if (xf > 0 && remaining <= xf && !xfadeRef.current.active && s.mode !== 'loop-one') {
        beginCrossfade(xf);
      }
    };

    const onEnded = (e) => {
      if (!isActive(e.target)) return; // a fading-out element ending is ignored
      if (endedFiredRef.current) return;
      endedFiredRef.current = true;
      store().handleEnded();
    };

    const onPlayEvent = (e) => {
      if (isActive(e.target)) setPlaybackState('playing');
    };
    const onPauseEvent = (e) => {
      if (isActive(e.target)) setPlaybackState('paused');
    };

    for (const el of [a, b]) {
      if (!el) continue;
      el.addEventListener('loadedmetadata', onCanPlaySeek);
      el.addEventListener('canplay', onCanPlaySeek);
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('ended', onEnded);
      el.addEventListener('play', onPlayEvent);
      el.addEventListener('pause', onPauseEvent);
    }

    return () => {
      teardown();
      for (const el of [a, b]) {
        if (!el) continue;
        el.removeEventListener('loadedmetadata', onCanPlaySeek);
        el.removeEventListener('canplay', onCanPlaySeek);
        el.removeEventListener('timeupdate', onTimeUpdate);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('play', onPlayEvent);
        el.removeEventListener('pause', onPauseEvent);
      }
      revokeUrl('a');
      revokeUrl('b');
      setPlaybackState('none');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------------------
  // Load the active element when the current peak / source type changes.
  // ----------------------------------------------------------------------------
  const currentPeak = usePlayerStore((s) => s.currentPeak);
  const sourceType = usePlayerStore((s) => s.sourceType);
  const peakKey = currentPeak ? `${currentPeak.id}:${sourceType}` : null;

  useEffect(() => {
    if (!currentPeak) {
      for (const key of ['a', 'b']) {
        const el = elOf(key);
        if (el) {
          el.pause();
          el.removeAttribute('src');
          el.load();
        }
        revokeUrl(key);
        loadedRef.current[key] = null;
      }
      boundsRef.current = { startSec: 0, endSec: 0 };
      return;
    }

    // A crossfade already advanced the store and positioned the incoming element.
    if (skipReloadForRef.current === currentPeak.id) {
      skipReloadForRef.current = null;
      boundsRef.current = { startSec: currentPeak.startSec || 0, endSec: currentPeak.endSec || 0 };
      pushMediaMeta();
      return;
    }

    boundsRef.current = { startSec: currentPeak.startSec || 0, endSec: currentPeak.endSec || 0 };

    // Gapless swap: if the OTHER element already preloaded this exact peak, make
    // it the active output instead of reloading.
    const otherKey = otherKeyOf(activeKeyRef.current);
    const otherLoaded = loadedRef.current[otherKey];
    if (otherLoaded && otherLoaded.peakId === currentPeak.id && otherLoaded.sourceType === sourceType) {
      // The element we're promoting may be the in-flight crossfade target; stop
      // the ramp but keep its volume up (we set it explicitly below).
      stopRamp();
      const old = elOf(activeKeyRef.current);
      if (old) {
        old.pause();
        old.volume = 1;
      }
      activeKeyRef.current = otherKey;
      const el = elOf(otherKey);
      if (el) {
        el.muted = false;
        el.volume = 1;
      }
    } else {
      cancelCrossfade();
      loadInto(activeKeyRef.current, currentPeak, sourceType);
    }

    pushMediaMeta();
    // Position is handled by the seek effect (seekToken bumped by _loadCurrent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peakKey]);

  // ----------------------------------------------------------------------------
  // Play / pause intent (the first play() after a user gesture runs here).
  // ----------------------------------------------------------------------------
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  useEffect(() => {
    const audio = elOf(activeKeyRef.current);
    if (!audio || !currentPeak) return;
    if (isPlaying) {
      endedFiredRef.current = false;
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => usePlayerStore.getState().pause());
      }
    } else {
      audio.pause();
    }
  }, [isPlaying, peakKey, currentPeak]);

  // ----------------------------------------------------------------------------
  // Seek requests (new track, user seek, loop-one re-trigger).
  // ----------------------------------------------------------------------------
  const seekToken = usePlayerStore((s) => s.seekToken);
  useEffect(() => {
    const store = usePlayerStore.getState();
    const audio = elOf(activeKeyRef.current);
    if (!audio || !currentPeak) return;

    // Crossfade-driven advance already positioned the incoming element.
    if (skipSeekTokenRef.current === seekToken) {
      skipSeekTokenRef.current = -1;
      return;
    }

    // A genuine seek / track change cancels any in-flight crossfade.
    cancelCrossfade();
    endedFiredRef.current = false;

    const { positionSec, isPlaying: wantPlaying, sourceType: st } = store;
    const start = st === 'online' ? currentPeak.startSec || 0 : 0;
    const end =
      st === 'online'
        ? currentPeak.endSec || 0
        : Number.isFinite(audio.duration)
          ? audio.duration
          : Infinity;
    let target = start + (positionSec || 0);
    if (target < start) target = start;
    if (end > start && target > end) target = end;
    try {
      audio.currentTime = target;
    } catch {
      // not seekable yet; loadedmetadata/canplay retries to startSec
    }
    if (wantPlaying && audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => store.pause());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekToken]);

  // ----------------------------------------------------------------------------
  // Keep the lock-screen scrubber in step with live position.
  // ----------------------------------------------------------------------------
  const positionSec = usePlayerStore((s) => s.positionSec);
  useEffect(() => {
    if (!currentPeak) return;
    const len = Math.max(0, (currentPeak.endSec || 0) - (currentPeak.startSec || 0));
    setPositionState({ durationSec: len, positionSec });
  }, [positionSec, currentPeak]);

  // ----------------------------------------------------------------------------
  // Preload the NEXT peak into the OTHER element when it is CACHED (cheap, local)
  // so a hard-cut advance can swap in gaplessly. Skipped while a crossfade is
  // using the other element.
  // ----------------------------------------------------------------------------
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const loopPlaylist = usePlayerStore((s) => s.loopPlaylist);
  useEffect(() => {
    if (xfadeRef.current.active) return;
    const otherKey = otherKeyOf(activeKeyRef.current);
    const other = elOf(otherKey);
    if (!other) return;

    let nextId = queue[index + 1];
    if (nextId == null && loopPlaylist && queue.length > 1) nextId = queue[0];

    const clearOther = () => {
      other.pause();
      other.removeAttribute('src');
      other.load();
      revokeUrl(otherKey);
      loadedRef.current[otherKey] = null;
    };

    if (!nextId || nextId === queue[index]) {
      clearOther();
      return;
    }
    if (loadedRef.current[otherKey]?.peakId === nextId) return; // already preloaded

    let cancelled = false;
    (async () => {
      const has = await hasAudioBlob(nextId);
      if (cancelled) return;
      if (!has) {
        clearOther();
        return;
      }
      const nextPeak = await getPeak(nextId);
      if (cancelled || !nextPeak) return;
      await loadInto(otherKey, nextPeak, 'cached');
      const el = elOf(otherKey);
      if (el) el.muted = true; // stays silent until it's swapped in
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, index, loopPlaylist]);

  return (
    <>
      <audio ref={aRef} className="hidden" preload="auto" />
      <audio ref={bRef} className="hidden" preload="auto" />
    </>
  );
}
