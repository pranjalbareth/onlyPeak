// src/store/playerStore.js
// THE SINGLE SOURCE OF TRUTH for playback (Section 9).
//
// This store holds *intent* (queue, index, isPlaying, mode, flags) plus the
// *derived current* (currentPeak, currentSong, sourceType). It does NOT own the
// real <audio> element. A separate PlayerEngine component (built later) owns the
// <audio>, subscribes to this store, and:
//   - seeks to peak.startSec on load,
//   - reports playback position back via setPosition(sec),
//   - calls handleEnded() when a peak finishes,
//   - re-seeks whenever seekToken changes (the engine watches seekToken, not
//     positionSec, so a seek to the same second still fires).
// NO other component keeps its own index — mini-player and Now Playing both
// read/write here.
//
// ADVANCE PATHS:
//   - handleEnded()  is the ONE automatic advance path (peak played to its end).
//   - next()/prev()  are MANUAL navigation; next() shares _goTo() with handleEnded.
// There is exactly one place that moves to a neighbouring index per trigger.

import { create } from 'zustand';
import { getPeak, getSong, hasAudioBlob, putSettings } from '../db/index.js';
import { useLibraryStore } from './libraryStore.js';

/**
 * Fisher–Yates shuffle of a copy of `arr`.
 */
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const usePlayerStore = create((set, get) => ({
  // ---- intent ----
  queue: [],            // peakId[]
  index: 0,
  isPlaying: false,
  positionSec: 0,
  mode: 'playlist',     // 'playlist' | 'loop-one'
  loopPlaylist: false,
  shuffle: false,
  expanded: false,      // mini-player expanded into Now Playing
  activePlaylistId: null, // the playlist the queue was built from (null for ad-hoc queues)

  // ---- derived current (resolved by _loadCurrent) ----
  currentPeak: null,
  currentSong: null,
  sourceType: 'online', // 'online' | 'cached'

  // ---- engine handshake ----
  // seekToken increments whenever playback should jump (new track, seek, or
  // loop-one re-trigger). The PlayerEngine watches this to know when to re-seek.
  seekToken: 0,

  /**
   * Start playing a saved playlist. Loads its ordered peakIds (from the library
   * store, falling back to nothing if unknown), sets the index, marks playing,
   * and resolves the current peak.
   */
  async playPlaylist(playlistId, startIndex = 0) {
    const peakIds = useLibraryStore.getState().getPeaksForPlaylist(playlistId).map((p) => p.id);
    let order = peakIds;
    let index = startIndex;
    if (get().shuffle && peakIds.length > 1) {
      // Keep the chosen start peak first, shuffle the rest.
      const first = peakIds[startIndex];
      const rest = shuffled(peakIds.filter((_, i) => i !== startIndex));
      order = [first, ...rest];
      index = 0;
    }
    set({ queue: order, index, isPlaying: true, activePlaylistId: playlistId });
    await get()._loadCurrent();
  },

  /** Play an explicit list of peakIds starting at startIndex (ad-hoc queue). */
  async playQueue(peakIds, startIndex = 0) {
    set({ queue: [...peakIds], index: startIndex, isPlaying: true, activePlaylistId: null });
    await get()._loadCurrent();
  },

  /** Play a single peak immediately as a one-item queue. */
  async playPeakNow(peakId) {
    set({ queue: [peakId], index: 0, isPlaying: true, activePlaylistId: null });
    await get()._loadCurrent();
  },

  /**
   * Load a queue + current peak WITHOUT starting playback — used to restore the
   * last session into the mini-player so the user can tap to resume. Pass the
   * source playlistId so later edits to that playlist reconcile the queue.
   */
  async primeQueue(peakIds, index = 0, playlistId = null) {
    set({ queue: [...peakIds], index, isPlaying: false, activePlaylistId: playlistId });
    await get()._loadCurrent();
  },

  /**
   * Reconcile the live queue after the library mutated (peak deleted, removed,
   * moved, or reordered). Rebuilds from the active playlist's current order (or,
   * for an ad-hoc queue, drops peaks that no longer exist), preserving the
   * currently-playing peak by id. If the current peak vanished, clamps to a valid
   * index and reloads; if nothing remains, stops. Keeps the player as the single
   * source of truth instead of letting it point at stale/deleted ids.
   */
  async reconcileActivePlaylist() {
    const { activePlaylistId, queue, index } = get();
    const currentId = queue[index];

    let newQueue;
    if (activePlaylistId) {
      newQueue = useLibraryStore.getState().getPeaksForPlaylist(activePlaylistId).map((p) => p.id);
    } else {
      const { peaksById } = useLibraryStore.getState();
      newQueue = queue.filter((id) => peaksById[id]);
    }

    // No structural change to the queue contents/order -> nothing to do.
    if (newQueue.length === queue.length && newQueue.every((id, i) => id === queue[i])) {
      return;
    }

    if (newQueue.length === 0) {
      set({ queue: [], index: 0, isPlaying: false, currentPeak: null, currentSong: null, positionSec: 0 });
      return;
    }

    const foundIndex = currentId ? newQueue.indexOf(currentId) : -1;
    if (foundIndex === -1) {
      // The currently-playing peak was removed: clamp to a still-valid index and
      // reload that peak (it becomes the new current).
      const newIndex = Math.min(index, newQueue.length - 1);
      set({ queue: newQueue, index: newIndex });
      await get()._loadCurrent();
      return;
    }
    // Current peak survived (e.g. reorder): just resync order + its index, no reload.
    set({ queue: newQueue, index: foundIndex });
  },

  /**
   * Resolve currentPeak/currentSong for the active index, pick the source type
   * (cached blob vs online stream), reset position, and push to recents. Bumps
   * seekToken so the engine seeks the new track to its start.
   * Internal — callers set queue/index first.
   */
  async _loadCurrent() {
    const { queue, index } = get();
    const peakId = queue[index];
    if (!peakId) {
      set({ currentPeak: null, currentSong: null, positionSec: 0 });
      return;
    }
    const peak = await getPeak(peakId);
    const song = peak ? await getSong(peak.videoId) : null;
    const cached = peak ? await hasAudioBlob(peakId) : false;
    set((s) => ({
      currentPeak: peak || null,
      currentSong: song || null,
      sourceType: cached ? 'cached' : 'online',
      positionSec: 0,
      seekToken: s.seekToken + 1,
    }));
    // Record into recents (de-duplicated + persisted by the library store).
    if (peak) {
      const lib = useLibraryStore.getState();
      const next = [peakId, ...lib.recentPeakIds.filter((x) => x !== peakId)].slice(0, 12);
      useLibraryStore.setState({ recentPeakIds: next });
      // Persist without blocking playback.
      putSettings({ recentPeakIds: next });
    }
  },

  /** Set intent to playing (engine reacts and calls the real audio.play()). */
  play() {
    set({ isPlaying: true });
  },

  /** Set intent to paused. */
  pause() {
    set({ isPlaying: false });
  },

  /** Flip play/pause intent. */
  toggle() {
    set((s) => ({ isPlaying: !s.isPlaying }));
  },

  /**
   * Internal: jump to an absolute queue index, resolve it, and keep the current
   * isPlaying intent. Shared by next() and handleEnded() so advancing behaves
   * identically whether manual or automatic.
   */
  async _goTo(index) {
    set({ index });
    await get()._loadCurrent();
  },

  /**
   * MANUAL next. Advances one index; past the end it either loops to 0 (when
   * loopPlaylist) or stays on the last item and pauses. Does not respect
   * loop-one (that only governs automatic end-of-peak behaviour).
   */
  async next() {
    const { index, queue, loopPlaylist } = get();
    const last = queue.length - 1;
    if (index < last) {
      await get()._goTo(index + 1);
    } else if (loopPlaylist && queue.length > 0) {
      await get()._goTo(0);
    } else {
      set({ isPlaying: false });
    }
  },

  /** MANUAL prev. Steps back one index, floored at 0. */
  async prev() {
    const { index } = get();
    if (index > 0) {
      await get()._goTo(index - 1);
    } else {
      // Already at the first peak: restart it from the top.
      set((s) => ({ positionSec: 0, seekToken: s.seekToken + 1 }));
    }
  },

  /**
   * THE SINGLE AUTOMATIC ADVANCE PATH — called by the engine when a peak reaches
   * its end (timeupdate >= endSec for online, natural 'ended' for cached clips).
   *   - mode 'loop-one': re-trigger the SAME peak (reset position + bump seekToken).
   *   - otherwise: advance via _goTo if there's a next index; else loop to 0 when
   *     loopPlaylist, else pause at the end.
   * Shares _goTo() with next(); this is the only place automatic advancing lives.
   */
  async handleEnded() {
    const { mode, index, queue, loopPlaylist } = get();
    if (mode === 'loop-one') {
      set((s) => ({ positionSec: 0, seekToken: s.seekToken + 1, isPlaying: true }));
      return;
    }
    const last = queue.length - 1;
    if (index < last) {
      await get()._goTo(index + 1);
    } else if (loopPlaylist && queue.length > 0) {
      await get()._goTo(0);
    } else {
      set({ isPlaying: false });
    }
  },

  /** Set playback mode directly. @param {'playlist'|'loop-one'} m */
  setMode(m) {
    set({ mode: m });
  },

  /** Toggle loop-one ('playlist' <-> 'loop-one'). */
  toggleLoopOne() {
    set((s) => ({ mode: s.mode === 'loop-one' ? 'playlist' : 'loop-one' }));
  },

  /** Toggle whether the queue loops back to the start after the last peak. */
  toggleLoopPlaylist() {
    set((s) => ({ loopPlaylist: !s.loopPlaylist }));
  },

  /**
   * Toggle shuffle. When turning on, shuffle the remaining queue order while
   * keeping the currently-playing peak first (index resets to 0). The flag also
   * governs future playPlaylist() calls.
   */
  toggleShuffle() {
    set((s) => {
      const turningOn = !s.shuffle;
      if (!turningOn || s.queue.length <= 1) {
        return { shuffle: turningOn };
      }
      const currentId = s.queue[s.index];
      const rest = shuffled(s.queue.filter((_, i) => i !== s.index));
      return { shuffle: true, queue: [currentId, ...rest], index: 0 };
    });
  },

  /**
   * User seek within the current peak. Sets position and bumps seekToken so the
   * engine performs the actual audio.currentTime jump.
   */
  seek(sec) {
    set((s) => ({ positionSec: sec, seekToken: s.seekToken + 1 }));
  },

  /**
   * Engine reports the live playback position. Pure state update — does NOT bump
   * seekToken (so it never causes the engine to re-seek).
   */
  setPosition(sec) {
    set({ positionSec: sec });
  },

  /** Expand/collapse the mini-player into the Now Playing screen. */
  setExpanded(b) {
    set({ expanded: b });
  },
}));
