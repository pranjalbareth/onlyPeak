// src/components/PlayerEngine.jsx
// HEADLESS playback engine — bridges the playerStore (intent) to the YouTube
// IFrame Player API (side effects). Renders a single hidden YT.Player offscreen;
// no other component owns a player or keeps its own index.
//
// HOW IT MAPS TO THE STORE CONTRACT (see playerStore.js):
//   - currentPeak changes -> load that video into the player, trimmed natively
//     via loadVideoById({ videoId, startSeconds, endSeconds }) (cueVideoById when
//     the queue is only primed, i.e. isPlaying is false).
//   - isPlaying           -> playVideo() / pauseVideo().
//   - seekToken           -> seekTo(startSec + positionSec) (user seek, loop-one
//     re-trigger, prev-at-start restart). A fresh load already positions the
//     video, so the seek effect skips the token that load satisfied.
//   - position + end      -> a ~250ms poll reads getCurrentTime(): it reports the
//     within-peak position via setPosition() and, when playback reaches endSec,
//     calls handleEnded() exactly once (latched). The IFrame's endSeconds + the
//     ENDED state are backstops (they still fire when the tab is backgrounded and
//     timers are throttled). handleEnded() in the store decides loop-one vs
//     advance vs stop — this engine never branches on mode itself.
//
// Position semantics: getCurrentTime() is absolute video time, so the within-peak
// position reported to the store is getCurrentTime() - startSec (0-based), which
// is what the mini-player / Now Playing progress and the media-session scrubber
// expect (duration = peak length).
//
// AUTOPLAY: every play entry point in the app is a click handler that flips
// isPlaying, so the playVideo()/loadVideoById() call below runs inside the user
// gesture's activation window — required so mobile browsers don't block the first
// play. The player is created on mount so it's ready before the first tap.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '../store/playerStore.js';
import {
  setupMediaSession,
  updateMetadata,
  setPlaybackState,
  setPositionState,
} from '../lib/mediaSession.js';

const YT_SRC = 'https://www.youtube.com/iframe_api';
const POLL_MS = 250;
// Treat the peak as finished a hair early so the loop/advance is snappy and we
// don't briefly play past endSec while the poll catches up.
const END_EPSILON = 0.25;

// Load the IFrame Player API exactly once; resolve when window.YT.Player exists.
let ytApiPromise = null;
function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') {
        try {
          prev();
        } catch {
          /* ignore a prior callback throwing */
        }
      }
      resolve(window.YT);
    };
    if (!document.querySelector(`script[src="${YT_SRC}"]`)) {
      const s = document.createElement('script');
      s.src = YT_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

export default function PlayerEngine() {
  const hostRef = useRef(null); // div the YT.Player mounts into (replaced by its iframe)
  const playerRef = useRef(null); // the YT.Player instance
  const readyRef = useRef(false); // player created + onReady fired
  const pollRef = useRef(0); // setInterval id (0 when stopped)

  // Latch so a peak's end advances the queue at most once. Cleared on every fresh
  // load / seek / play.
  const endedFiredRef = useRef(false);
  // The seekToken value the most recent load already satisfied, so the seek
  // effect doesn't re-seek a freshly-loaded video to the same place.
  const loadedSeekTokenRef = useRef(-1);
  // Mobile-autoplay workaround: a programmatic playVideo() reaching the iframe via
  // postMessage doesn't carry the user gesture, so Chrome (esp. Android) blocks
  // starting audio. Muted playback is always allowed, so we force the FIRST play
  // muted and unmute the instant it actually reports PLAYING. Once that's
  // happened the origin is "engaged" and later plays start with sound directly.
  const audioUnlockedRef = useRef(false);

  function bounds() {
    const { currentPeak } = usePlayerStore.getState();
    return {
      startSec: currentPeak?.startSec || 0,
      endSec: currentPeak?.endSec || 0,
    };
  }

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = 0;
    }
  }

  function startPoll() {
    if (pollRef.current) return;
    pollRef.current = setInterval(tick, POLL_MS);
  }

  function tick() {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    let t;
    try {
      t = player.getCurrentTime();
    } catch {
      return;
    }
    if (!Number.isFinite(t)) return;
    const { startSec, endSec } = bounds();
    const store = usePlayerStore.getState();
    const pos = t - startSec;
    store.setPosition(pos > 0 ? pos : 0);

    if (endedFiredRef.current) return;
    if (endSec > startSec && t >= endSec - END_EPSILON) {
      endedFiredRef.current = true;
      store.handleEnded();
    }
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

  // Load (play) or cue (paused) the current peak into the player. The IFrame
  // trims to [startSeconds, endSeconds] natively.
  function syncCurrent() {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const { currentPeak, isPlaying, seekToken } = usePlayerStore.getState();

    if (!currentPeak) {
      try {
        player.stopVideo();
      } catch {
        /* player may be between states */
      }
      stopPoll();
      return;
    }

    const startSeconds = currentPeak.startSec || 0;
    const endSeconds = currentPeak.endSec || undefined;
    endedFiredRef.current = false;
    loadedSeekTokenRef.current = seekToken; // this load already positions the video

    try {
      if (isPlaying) {
        if (!audioUnlockedRef.current) player.mute(); // muted first play (see ref)
        player.loadVideoById({ videoId: currentPeak.videoId, startSeconds, endSeconds });
      } else {
        player.cueVideoById({ videoId: currentPeak.videoId, startSeconds, endSeconds });
      }
    } catch {
      /* loadVideoById can throw if called mid-init; onReady will re-sync */
    }
    pushMediaMeta();
  }

  // ----------------------------------------------------------------------------
  // One-time: media session + create the single hidden player.
  // ----------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const teardownMedia = setupMediaSession({
      onPlay: () => usePlayerStore.getState().play(),
      onPause: () => usePlayerStore.getState().pause(),
      onPrev: () => usePlayerStore.getState().prev(),
      onNext: () => usePlayerStore.getState().next(),
      onSeek: (sec) => usePlayerStore.getState().seek(sec),
    });

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        playerRef.current = new YT.Player(hostRef.current, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              // Fill the (hidden-behind-the-UI) host so the browser treats the
              // player as a real, visible video and will play it on mobile.
              const frame = playerRef.current?.getIframe?.();
              if (frame) {
                frame.style.width = '100%';
                frame.style.height = '100%';
                frame.style.border = '0';
              }
              // Apply whatever the store already wants (primed queue, or playing
              // if the user pressed play before the API finished loading). The
              // poll starts when the player actually reports PLAYING below.
              syncCurrent();
            },
            onStateChange: (e) => {
              const PS = window.YT.PlayerState;
              if (e.data === PS.PLAYING) {
                setPlaybackState('playing');
                startPoll();
                if (!audioUnlockedRef.current) {
                  // First play was forced muted to satisfy mobile autoplay; it's
                  // now actually playing, so restore sound.
                  try {
                    playerRef.current.unMute();
                    playerRef.current.setVolume(100);
                  } catch {
                    /* ignore */
                  }
                  audioUnlockedRef.current = true;
                }
              } else if (e.data === PS.PAUSED) {
                setPlaybackState('paused');
                stopPoll();
              } else if (e.data === PS.ENDED) {
                // Backstop: fires when endSeconds is reached even if the poll was
                // throttled (e.g. backgrounded tab). Latched against the poll.
                if (!endedFiredRef.current) {
                  endedFiredRef.current = true;
                  usePlayerStore.getState().handleEnded();
                }
              }
            },
          },
        });
      })
      .catch(() => {
        /* IFrame API failed to load (offline / blocked) — playback unavailable. */
      });

    return () => {
      cancelled = true;
      teardownMedia();
      stopPoll();
      setPlaybackState('none');
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------------------
  // Current peak changed (new track / cleared queue).
  // ----------------------------------------------------------------------------
  const currentPeak = usePlayerStore((s) => s.currentPeak);
  const peakKey = currentPeak ? currentPeak.id : null;
  useEffect(() => {
    if (!readyRef.current) return; // onReady performs the first sync
    syncCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peakKey]);

  // ----------------------------------------------------------------------------
  // Seek requests (user seek, loop-one re-trigger, prev-at-start restart).
  // ----------------------------------------------------------------------------
  const seekToken = usePlayerStore((s) => s.seekToken);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    // A fresh load already positioned the video to this token.
    if (seekToken === loadedSeekTokenRef.current) return;
    const { startSec } = bounds();
    const { positionSec, isPlaying } = usePlayerStore.getState();
    endedFiredRef.current = false;
    try {
      player.seekTo(startSec + (positionSec || 0), true);
      if (isPlaying) player.playVideo();
    } catch {
      /* ignore transient seek errors */
    }
  }, [seekToken]);

  // ----------------------------------------------------------------------------
  // Play / pause intent.
  // ----------------------------------------------------------------------------
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current || !currentPeak) return;
    try {
      if (isPlaying) {
        endedFiredRef.current = false;
        if (!audioUnlockedRef.current) player.mute(); // muted first play (see ref)
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch {
      /* ignore */
    }
    // The poll follows the player's real PLAYING/PAUSED state (see onStateChange),
    // so a buffering-window getCurrentTime() can't misfire end-detection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, peakKey]);

  // ----------------------------------------------------------------------------
  // Keep the lock-screen scrubber in step with live position.
  // ----------------------------------------------------------------------------
  const positionSec = usePlayerStore((s) => s.positionSec);
  useEffect(() => {
    if (!currentPeak) return;
    const len = Math.max(0, (currentPeak.endSec || 0) - (currentPeak.startSec || 0));
    setPositionState({ durationSec: len, positionSec });
  }, [positionSec, currentPeak]);

  // Render the player ON-SCREEN (mobile browsers won't play an offscreen /
  // display:none / zero-size YouTube player) but hidden BEHIND the app UI: a
  // body-level, full-viewport, pointer-events:none layer at z-index -1. Every app
  // screen has an opaque (bg-zinc-950) background that paints on top, so the video
  // is never visible while the browser still treats it as a real, playable video.
  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
    </div>,
    document.body
  );
}
