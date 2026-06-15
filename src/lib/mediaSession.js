// src/lib/mediaSession.js
// Pure wiring for the Android lock-screen / notification controls
// (navigator.mediaSession, Section 9). No store imports — the PlayerEngine
// passes callbacks in and pumps metadata/state out. Every entry point guards
// `'mediaSession' in navigator` so this is a safe no-op on unsupported browsers.

function supported() {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/**
 * Register lock-screen action handlers. Returns a teardown function that
 * unregisters them (pass each handler as null). Call teardown on unmount.
 * @param {{onPlay?:Function,onPause?:Function,onPrev?:Function,onNext?:Function,onSeek?:(sec:number)=>void}} handlers
 * @returns {() => void} teardown
 */
export function setupMediaSession({ onPlay, onPause, onPrev, onNext, onSeek } = {}) {
  if (!supported()) return () => {};
  const ms = navigator.mediaSession;

  const set = (action, handler) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // Some actions are unsupported on some browsers; ignore.
    }
  };

  set('play', onPlay ? () => onPlay() : null);
  set('pause', onPause ? () => onPause() : null);
  set('previoustrack', onPrev ? () => onPrev() : null);
  set('nexttrack', onNext ? () => onNext() : null);
  set(
    'seekto',
    onSeek
      ? (details) => {
          if (details && typeof details.seekTime === 'number') onSeek(details.seekTime);
        }
      : null
  );

  return () => {
    for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']) {
      set(action, null);
    }
  };
}

/**
 * Update the lock-screen metadata for the current peak. Artwork is provided at
 * a couple of sizes from the same thumbnail URL.
 * @param {{title?:string,artist?:string,artworkUrl?:string}} meta
 */
export function updateMetadata({ title, artist, artworkUrl } = {}) {
  if (!supported() || typeof MediaMetadata === 'undefined') return;
  const artwork = artworkUrl
    ? [
        { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
      ]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || '',
    artist: artist || '',
    artwork,
  });
}

/**
 * Reflect playback state on the lock screen.
 * @param {'playing'|'paused'|'none'} state
 */
export function setPlaybackState(state) {
  if (!supported()) return;
  navigator.mediaSession.playbackState = state;
}

/**
 * Report position for the lock-screen scrubber. Guarded: only sets state when
 * the values are finite and duration > 0 (otherwise the browser throws).
 * @param {{durationSec:number,positionSec:number,playbackRate?:number}} state
 */
export function setPositionState({ durationSec, positionSec, playbackRate = 1 } = {}) {
  if (!supported() || typeof navigator.mediaSession.setPositionState !== 'function') return;
  if (
    !Number.isFinite(durationSec) ||
    !Number.isFinite(positionSec) ||
    durationSec <= 0
  ) {
    return;
  }
  const position = Math.min(Math.max(0, positionSec), durationSec);
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      position,
      playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
    });
  } catch {
    // ignore invalid-state errors from rapid updates
  }
}
