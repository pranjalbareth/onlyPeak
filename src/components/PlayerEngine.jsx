// src/components/PlayerEngine.jsx
// HEADLESS playback engine (Section 9). Owns the ONE real <audio> element and is
// the single bridge between the playerStore (intent) and the browser's audio.
//
// The store is the source of truth for WHAT plays; this component performs the
// side effects: choosing the source (cached blob vs online stream), seeking to
// the peak's startSec, reporting live position back, advancing at the peak end,
// and wiring the Android lock-screen (MediaSession) controls.
//
// Online streams are the full song, so we seek to startSec on load and watch
// timeupdate to fire handleEnded() at endSec. Cached clips are already trimmed,
// so they play from 0 and their natural 'ended' event advances the queue.
//
// A second hidden <audio> preloads the next peak (only when it is cached and we
// therefore have its blob locally) so back-to-back transitions are gapless.

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore.js';
import { getPeak, getAudioBlob, hasAudioBlob } from '../db/index.js';
import { audioUrl } from '../lib/api.js';
import {
  setupMediaSession,
  updateMetadata,
  setPlaybackState,
  setPositionState,
} from '../lib/mediaSession.js';

export default function PlayerEngine() {
  const audioRef = useRef(null);
  const preloadRef = useRef(null);

  // Object URL currently assigned to the primary <audio> (revoked on swap).
  const objectUrlRef = useRef(null);
  // Object URL held by the preload element + the peakId it belongs to.
  const preloadUrlRef = useRef(null);
  const preloadPeakIdRef = useRef(null);

  // Live mirror of the active peak's [startSec, endSec] for the timeupdate
  // handler (which is registered once and must read fresh bounds).
  const boundsRef = useRef({ startSec: 0, endSec: 0 });

  // Latch so a peak's end advances the queue at most ONCE. timeupdate fires ~4x/s
  // and _loadCurrent is async, so without this the old stream keeps firing
  // handleEnded() during the load window and skips several peaks. Cleared on any
  // re-seek (new track / loop-one re-trigger / user seek) and on resume.
  const endedFiredRef = useRef(false);

  // ----------------------------------------------------------------------------
  // One-time wiring: MediaSession action handlers + audio event listeners.
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

    const audio = audioRef.current;
    if (!audio) return teardown;
    audio.loop = false;

    // ONLINE only: jump to the peak start once the stream is ready to seek.
    const seekToStart = () => {
      const { sourceType } = store();
      if (sourceType !== 'online') return;
      const { startSec } = boundsRef.current;
      const target = startSec + store().positionSec;
      if (Number.isFinite(target) && Math.abs(audio.currentTime - target) > 0.25) {
        try {
          audio.currentTime = target;
        } catch {
          // currentTime not settable yet; a later canplay/loadedmetadata retries.
        }
      }
    };

    const onTimeUpdate = () => {
      const { sourceType } = store();
      const { startSec, endSec } = boundsRef.current;
      if (sourceType === 'cached') {
        // Trimmed clip: position is just currentTime; 'ended' handles advance.
        store().setPosition(audio.currentTime);
        return;
      }
      const pos = audio.currentTime - startSec;
      store().setPosition(pos > 0 ? pos : 0);
      if (endSec > startSec && audio.currentTime >= endSec && !endedFiredRef.current) {
        endedFiredRef.current = true;
        store().handleEnded();
      }
    };

    const onEnded = () => {
      // For cached (already-trimmed) clips the natural end advances the queue.
      // For online streams we normally advance via timeupdate >= endSec, but if
      // a stream genuinely ends first (endSec beyond real duration) advance too.
      if (endedFiredRef.current) return;
      endedFiredRef.current = true;
      store().handleEnded();
    };

    const onPlayEvent = () => setPlaybackState('playing');
    const onPauseEvent = () => setPlaybackState('paused');

    audio.addEventListener('loadedmetadata', seekToStart);
    audio.addEventListener('canplay', seekToStart);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlayEvent);
    audio.addEventListener('pause', onPauseEvent);

    return () => {
      teardown();
      audio.removeEventListener('loadedmetadata', seekToStart);
      audio.removeEventListener('canplay', seekToStart);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlayEvent);
      audio.removeEventListener('pause', onPauseEvent);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (preloadUrlRef.current) {
        URL.revokeObjectURL(preloadUrlRef.current);
        preloadUrlRef.current = null;
      }
      setPlaybackState('none');
    };
  }, []);

  // ----------------------------------------------------------------------------
  // Load source when the current peak (id) or source type changes.
  // ----------------------------------------------------------------------------
  const currentPeak = usePlayerStore((s) => s.currentPeak);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const sourceType = usePlayerStore((s) => s.sourceType);
  const peakKey = currentPeak ? `${currentPeak.id}:${sourceType}` : null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentPeak) {
      audio.removeAttribute('src');
      audio.load();
      boundsRef.current = { startSec: 0, endSec: 0 };
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      return;
    }

    boundsRef.current = {
      startSec: currentPeak.startSec || 0,
      endSec: currentPeak.endSec || 0,
    };

    let cancelled = false;

    const applySource = async () => {
      // Revoke any previous blob URL before assigning a new source.
      const revokePrev = () => {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      };

      if (sourceType === 'cached') {
        // Reuse the preloaded blob URL if it already points at this peak.
        if (preloadPeakIdRef.current === currentPeak.id && preloadUrlRef.current) {
          revokePrev();
          const url = preloadUrlRef.current;
          objectUrlRef.current = url;
          preloadUrlRef.current = null;
          preloadPeakIdRef.current = null;
          audio.src = url;
          audio.load();
          return;
        }
        const blob = await getAudioBlob(currentPeak.id);
        if (cancelled) return;
        if (blob) {
          revokePrev();
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          audio.src = url;
          audio.load();
          return;
        }
        // Fall back to online if the blob vanished.
      }

      revokePrev();
      audio.src = audioUrl(currentPeak.videoId);
      audio.load();
    };

    applySource();

    // MediaSession metadata + initial position window for this peak.
    updateMetadata({
      title: currentPeak.title,
      artist: currentSong?.artist,
      artworkUrl: currentSong?.thumbnailUrl,
    });
    const len = Math.max(0, (currentPeak.endSec || 0) - (currentPeak.startSec || 0));
    setPositionState({ durationSec: len, positionSec: 0 });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peakKey]);

  // ----------------------------------------------------------------------------
  // React to play/pause intent. The first play() after a user gesture runs here,
  // inside the user-activation window. play() rejection -> reflect paused state.
  // ----------------------------------------------------------------------------
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentPeak) return;
    if (isPlaying) {
      // Resuming counts as a fresh start, so re-arm the end latch (e.g. after a
      // playlist stopped at its last peak's end and the user presses play).
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
  // React to seek requests (new track, user seek, loop-one re-trigger). The
  // store bumps seekToken; we jump to startSec + positionSec, clamped to range.
  // ----------------------------------------------------------------------------
  const seekToken = usePlayerStore((s) => s.seekToken);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentPeak) return;
    // A re-seek means we're at a fresh position, so re-arm the end latch.
    endedFiredRef.current = false;
    const { positionSec, isPlaying: wantPlaying } = usePlayerStore.getState();
    const start = sourceType === 'online' ? currentPeak.startSec || 0 : 0;
    const end =
      sourceType === 'online'
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
      // Not seekable yet; loadedmetadata/canplay will retry to startSec.
    }
    // A cached clip in loop-one mode reaches its natural 'ended' (which PAUSES the
    // element); handleEnded re-seeks to 0 via this token but isPlaying was already
    // true, so the play/pause effect doesn't re-run. Restart playback here.
    if (wantPlaying && audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => usePlayerStore.getState().pause());
      }
    }
  }, [seekToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----------------------------------------------------------------------------
  // Keep the lock-screen scrubber position in step with live position.
  // ----------------------------------------------------------------------------
  const positionSec = usePlayerStore((s) => s.positionSec);
  useEffect(() => {
    if (!currentPeak) return;
    const len = Math.max(0, (currentPeak.endSec || 0) - (currentPeak.startSec || 0));
    setPositionState({ durationSec: len, positionSec });
  }, [positionSec, currentPeak]);

  // ----------------------------------------------------------------------------
  // Preload the NEXT peak when it is cached (we have the blob locally, so this is
  // cheap and enables gapless transitions). Online next-peaks aren't preloaded
  // to avoid a second concurrent stream.
  // ----------------------------------------------------------------------------
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  useEffect(() => {
    const pre = preloadRef.current;
    if (!pre) return;
    const nextId = queue[index + 1];

    const clearPreload = () => {
      pre.removeAttribute('src');
      pre.load();
      if (preloadUrlRef.current) {
        URL.revokeObjectURL(preloadUrlRef.current);
        preloadUrlRef.current = null;
      }
      preloadPeakIdRef.current = null;
    };

    if (!nextId) {
      clearPreload();
      return;
    }
    if (preloadPeakIdRef.current === nextId) return; // already preloaded

    let cancelled = false;
    (async () => {
      const has = await hasAudioBlob(nextId);
      if (cancelled || !has) {
        if (!cancelled) clearPreload();
        return;
      }
      const nextPeak = await getPeak(nextId);
      const blob = await getAudioBlob(nextId);
      if (cancelled || !nextPeak || !blob) return;
      if (preloadUrlRef.current) URL.revokeObjectURL(preloadUrlRef.current);
      const url = URL.createObjectURL(blob);
      preloadUrlRef.current = url;
      preloadPeakIdRef.current = nextId;
      pre.src = url;
      pre.load();
    })();

    return () => {
      cancelled = true;
    };
  }, [queue, index]);

  return (
    <>
      <audio ref={audioRef} className="hidden" preload="auto" />
      <audio ref={preloadRef} className="hidden" preload="auto" muted />
    </>
  );
}
