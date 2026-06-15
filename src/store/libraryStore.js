// src/store/libraryStore.js
// Zustand store for the persistent library: playlists, peaks, songs, settings,
// plus transient search state. Every mutation writes through to IndexedDB
// (src/db) so the in-memory state and the DB never drift. The player store reads
// peak/playlist data from the DB directly, but this store owns all writes.

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db/index.js';

const RECENTS_CAP = 12;

/**
 * Prepend an id to a recents list, de-duplicating and capping length.
 * @param {string[]} list @param {string} id @returns {string[]}
 */
function pushRecent(list, id) {
  const next = [id, ...list.filter((x) => x !== id)];
  return next.slice(0, RECENTS_CAP);
}

export const useLibraryStore = create((set, get) => ({
  // ---- persisted, mirrored from IndexedDB ----
  playlists: [],          // Playlist[]
  peaksById: {},          // { [peakId]: Peak }
  songsById: {},          // { [videoId]: Song }
  settings: null,         // Settings (null until init())
  recentPeakIds: [],      // mirror of settings.recentPeakIds

  // ---- transient search state ----
  searchResults: [],      // Song[]
  searching: false,
  searchError: null,
  searchHistory: [],      // recent queries (most-recent first), mirrored from settings

  /**
   * Hydrate the store from IndexedDB and apply forward migrations. Call once at
   * app boot before rendering library UI.
   */
  async init() {
    await db.runMigrations();
    const [playlists, peaks, songs, settings] = await Promise.all([
      db.getAllPlaylists(),
      db.getAllPeaks(),
      db.getAllSongs(),
      db.getSettings(),
    ]);
    const peaksById = {};
    for (const p of peaks) peaksById[p.id] = p;
    const songsById = {};
    for (const s of songs) songsById[s.videoId] = s;
    set({
      playlists,
      peaksById,
      songsById,
      settings,
      recentPeakIds: settings.recentPeakIds || [],
      searchHistory: settings.searchHistory || [],
    });
  },

  /**
   * Run a song search, managing searching/searchError and storing results.
   *
   * PHASE 1: the audio-extraction backend has been removed, so this is inert —
   * it clears results and never hits the network. PHASE 3 replaces the body with
   * a direct YouTube Data API call (src/lib/youtube.js) using VITE_YOUTUBE_API_KEY,
   * keeping the same searching/searchError/searchResults contract and the
   * recordSearch(query) history hook below.
   */
  async search(q) {
    const query = (q || '').trim();
    set({ searchResults: [], searching: false, searchError: null });
    if (!query) return;
    // Intentionally a no-op until Phase 3 wires up the YouTube Data API.
  },

  /** Clear search results and error. */
  clearSearch() {
    set({ searchResults: [], searching: false, searchError: null });
  },

  /** Prepend a query to the recent-search history (dedup, cap 10) and persist. */
  recordSearch(query) {
    const q = (query || '').trim();
    if (!q) return;
    const next = [q, ...get().searchHistory.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10);
    set({ searchHistory: next });
    db.putSettings({ searchHistory: next });
  },

  /** Remove a single query from the recent-search history (persisted). */
  removeSearch(query) {
    const next = get().searchHistory.filter((x) => x !== query);
    set({ searchHistory: next });
    db.putSettings({ searchHistory: next });
  },

  /** Clear the entire recent-search history (persisted). */
  clearSearchHistory() {
    set({ searchHistory: [] });
    db.putSettings({ searchHistory: [] });
  },

  /** Number of peaks the library has for a given videoId (for the "N peaks" badge). */
  getPeakCountByVideoId(videoId) {
    const { peaksById } = get();
    let n = 0;
    for (const id in peaksById) {
      if (peaksById[id].videoId === videoId) n++;
    }
    return n;
  },

  /**
   * Create a new (empty) playlist and persist it.
   * @returns {Promise<object>} the created playlist
   */
  async createPlaylist(name) {
    const playlist = {
      id: uuidv4(),
      name: name || 'New Playlist',
      peakIds: [],
      createdAt: Date.now(),
    };
    await db.putPlaylist(playlist);
    set((s) => ({ playlists: [...s.playlists, playlist] }));
    return playlist;
  },

  /** Rename a playlist and persist. */
  async renamePlaylist(id, name) {
    const playlist = get().playlists.find((p) => p.id === id);
    if (!playlist) return;
    const updated = { ...playlist, name };
    await db.putPlaylist(updated);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? updated : p)) }));
  },

  /** Delete a playlist (peaks are left intact; they may live in other playlists). */
  async deletePlaylist(id) {
    await db.deletePlaylist(id);
    set((s) => {
      const patch = { playlists: s.playlists.filter((p) => p.id !== id) };
      if (s.settings?.lastPlaylistId === id) {
        patch.settings = { ...s.settings, lastPlaylistId: null };
      }
      return patch;
    });
    if (get().settings?.lastPlaylistId === null) {
      await db.putSettings({ lastPlaylistId: null });
    }
  },

  /**
   * Create OR update a peak (the Peak Editor's save). When `id` is present the
   * existing peak is updated in place; otherwise a new peak is created (uuid id,
   * createdAt) and appended to the target playlist. Always upserts the underlying
   * Song, records lastPlaylistId, and pushes the peak onto recents.
   * @param {{id?:string,videoId:string,title:string,startSec:number,endSec:number,song?:object}} input
   * @param {string} playlistId  target playlist (used on create; ignored on update)
   * @returns {Promise<object>} the saved peak
   */
  async savePeak({ id, videoId, title, startSec, endSec, song }, playlistId) {
    const isUpdate = Boolean(id);
    let peak;

    if (isUpdate) {
      const existing = get().peaksById[id];
      peak = {
        ...existing,
        id,
        videoId,
        title,
        startSec,
        endSec,
      };
    } else {
      peak = {
        id: uuidv4(),
        videoId,
        title,
        startSec,
        endSec,
        createdAt: Date.now(),
      };
    }

    await db.putPeak(peak);

    // Always upsert the Song so metadata survives even if not searched again.
    if (song) {
      await db.putSong(song);
    }

    // On create, append to the chosen playlist.
    let updatedPlaylist = null;
    if (!isUpdate && playlistId) {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (playlist && !playlist.peakIds.includes(peak.id)) {
        updatedPlaylist = { ...playlist, peakIds: [...playlist.peakIds, peak.id] };
        await db.putPlaylist(updatedPlaylist);
      }
    }

    // Persist lastPlaylistId + recents via settings.
    const nextRecents = pushRecent(get().recentPeakIds, peak.id);
    const nextSettings = await db.putSettings({
      lastPlaylistId: playlistId || get().settings?.lastPlaylistId || null,
      recentPeakIds: nextRecents,
    });

    set((s) => ({
      peaksById: { ...s.peaksById, [peak.id]: peak },
      songsById: song ? { ...s.songsById, [song.videoId]: song } : s.songsById,
      playlists: updatedPlaylist
        ? s.playlists.map((p) => (p.id === updatedPlaylist.id ? updatedPlaylist : p))
        : s.playlists,
      settings: nextSettings,
      recentPeakIds: nextRecents,
    }));

    return peak;
  },

  /**
   * Delete a peak everywhere: DB cascade (playlist refs) then mirror into state
   * (peaksById, playlists.peakIds, recents).
   */
  async deletePeak(id) {
    await db.deletePeak(id); // also removes id from all playlists
    set((s) => {
      const peaksById = { ...s.peaksById };
      delete peaksById[id];
      return {
        peaksById,
        playlists: s.playlists.map((p) =>
          p.peakIds.includes(id) ? { ...p, peakIds: p.peakIds.filter((x) => x !== id) } : p
        ),
        recentPeakIds: s.recentPeakIds.filter((x) => x !== id),
      };
    });
    // Keep persisted recents in sync.
    await db.putSettings({ recentPeakIds: get().recentPeakIds });
  },

  /** Add an existing peak to a playlist (no-op if already present). */
  async addPeakToPlaylist(peakId, playlistId) {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.peakIds.includes(peakId)) return;
    const updated = { ...playlist, peakIds: [...playlist.peakIds, peakId] };
    await db.putPlaylist(updated);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? updated : p)) }));
  },

  /** Remove a peak from a single playlist (the peak itself is untouched). */
  async removePeakFromPlaylist(peakId, playlistId) {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist || !playlist.peakIds.includes(peakId)) return;
    const updated = { ...playlist, peakIds: playlist.peakIds.filter((x) => x !== peakId) };
    await db.putPlaylist(updated);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? updated : p)) }));
  },

  /** Move a peak from one playlist to another. */
  async movePeakToPlaylist(peakId, fromId, toId) {
    if (fromId === toId) return;
    await get().removePeakFromPlaylist(peakId, fromId);
    await get().addPeakToPlaylist(peakId, toId);
  },

  /** Reorder a peak within a playlist (drag-to-reorder). */
  async reorderPlaylist(playlistId, fromIndex, toIndex) {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    const ids = [...playlist.peakIds];
    if (
      fromIndex < 0 ||
      fromIndex >= ids.length ||
      toIndex < 0 ||
      toIndex >= ids.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    const updated = { ...playlist, peakIds: ids };
    await db.putPlaylist(updated);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? updated : p)) }));
  },

  /** Ordered peaks for a playlist, resolved from peaksById (skips missing ids). */
  getPeaksForPlaylist(playlistId) {
    const { playlists, peaksById } = get();
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return [];
    return playlist.peakIds.map((id) => peaksById[id]).filter(Boolean);
  },

  /** Persist the default peak length (seconds) used for new suggestions. */
  async setDefaultPeakLength(sec) {
    const n = Math.max(3, Math.min(90, Math.round(Number(sec) || 0)));
    const next = await db.putSettings({ defaultPeakLengthSec: n });
    set({ settings: next });
  },

  /** Persist the crossfade duration (milliseconds) between peaks. */
  async setCrossfadeMs(ms) {
    const n = Math.max(0, Math.min(12000, Math.round(Number(ms) || 0)));
    const next = await db.putSettings({ crossfadeMs: n });
    set({ settings: next });
  },

  /**
   * First-run demo seed (build-spec Section 11, Phase 6). Runs at most once,
   * gated by settings.seeded, and ONLY when the library is empty (so it never
   * clobbers a real library or comes back after the user deletes the demo).
   * Seeds a small playlist of peaks on famously-stable videos so the app has
   * content on a fresh install instead of an empty home; they play online via
   * the YouTube IFrame player.
   * @returns {Promise<boolean>} whether a seed was written
   */
  async seedDemoIfEmpty() {
    const { settings, playlists } = get();
    if (settings?.seeded) return false;
    if (playlists.length > 0) {
      // Real data already exists — mark seeded so we never touch it later.
      const next = await db.putSettings({ seeded: true });
      set({ settings: next });
      return false;
    }

    const songs = [
      { videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationSec: 213, startSec: 43, endSec: 65 },
      { videoId: 'djV11Xbc914', title: 'Take On Me', artist: 'a-ha', durationSec: 225, startSec: 49, endSec: 71 },
      { videoId: 'y6120QOlsfU', title: 'Sandstorm', artist: 'Darude', durationSec: 227, startSec: 60, endSec: 82 },
    ];

    const peakIds = [];
    const peaksById = { ...get().peaksById };
    const songsById = { ...get().songsById };

    for (const s of songs) {
      const song = {
        videoId: s.videoId,
        title: s.title,
        artist: s.artist,
        durationSec: s.durationSec,
        thumbnailUrl: `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`,
      };
      await db.putSong(song);
      songsById[song.videoId] = song;

      const peak = {
        id: uuidv4(),
        videoId: s.videoId,
        title: s.title,
        startSec: s.startSec,
        endSec: s.endSec,
        createdAt: Date.now(),
      };
      await db.putPeak(peak);
      peaksById[peak.id] = peak;
      peakIds.push(peak.id);
    }

    const playlist = {
      id: uuidv4(),
      name: 'Demo · Peaks',
      peakIds,
      createdAt: Date.now(),
    };
    await db.putPlaylist(playlist);

    const next = await db.putSettings({ seeded: true, lastPlaylistId: playlist.id });
    set((st) => ({
      playlists: [...st.playlists, playlist],
      peaksById,
      songsById,
      settings: next,
    }));
    return true;
  },
}));
