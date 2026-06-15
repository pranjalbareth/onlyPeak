// src/App.jsx
// State-based screen router for OnlyPeak (no react-router). Three primary screens
// — 'library' | 'editor' | 'playlist' — are switched purely by local state. The
// Now Playing screen is an OVERLAY driven by usePlayerStore.expanded, not a
// routed screen. The MiniPlayer and the headless PlayerEngine render globally on
// every screen so playback and the dock survive navigation.
//
// Flows:
//   LibraryScreen.onPickSong(song)  -> open PeakEditor (create) for that video
//   LibraryScreen.onOpenPlaylist(id)-> PlaylistScreen
//   PlaylistScreen.onEditPeak(peak) -> open PeakEditor (edit) for that peak
//   PeakEditor.onSaved / onClose    -> return to the previous screen
//
// On mount we hydrate the library store, then (if a last playlist exists) prime
// the player queue PAUSED so the mini-player can resume the last session.

import { useCallback, useEffect, useState } from 'react';
import { useLibraryStore } from './store/libraryStore.js';
import { usePlayerStore } from './store/playerStore.js';

import LibraryScreen from './components/LibraryScreen.jsx';
import PlaylistScreen from './components/PlaylistScreen.jsx';
import PeakEditor from './components/PeakEditor.jsx';
import MiniPlayer from './components/MiniPlayer.jsx';
import NowPlayingScreen from './components/NowPlayingScreen.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import PlayerEngine from './components/PlayerEngine.jsx';

/**
 * Build the Peak Editor's `video` shape from a song-like record (a search result
 * or a stored Song). No network: durationSec defaults to 0 (the editor's IFrame
 * preview fills it in via getDuration when missing) and heatmap is null, so the
 * scrubber renders its flat neutral track.
 */
function toVideo(src) {
  const videoId = src.videoId;
  return {
    videoId,
    title: src.title || '',
    artist: src.artist || '',
    durationSec: Number(src.durationSec) || 0,
    thumbnailUrl: src.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    heatmap: null,
  };
}

export default function App() {
  // Which primary screen is showing + the params each screen needs.
  const [screen, setScreen] = useState('library'); // 'library' | 'editor' | 'playlist' | 'settings'
  const [selectedVideo, setSelectedVideo] = useState(null); // resolved video for create mode
  const [editingPeak, setEditingPeak] = useState(null); // Peak for edit mode (null = create)
  const [currentPlaylistId, setCurrentPlaylistId] = useState(null);

  // Remember where to return after the editor closes.
  const [returnScreen, setReturnScreen] = useState('library');

  // Now Playing overlay visibility (single source of truth lives in the store).
  const expanded = usePlayerStore((s) => s.expanded);

  // ---- boot: hydrate the library + prime the last session into the dock ----
  useEffect(() => {
    // Ask the browser to keep our IndexedDB (playlists + peaks) from being
    // evicted. Best-effort: feature-detected and ignored where unavailable.
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }

    let cancelled = false;
    (async () => {
      await useLibraryStore.getState().init();
      if (cancelled) return;
      // First-run: seed a small demo playlist so the home isn't empty (no-op on
      // an existing library, only ever runs once).
      await useLibraryStore.getState().seedDemoIfEmpty();
      if (cancelled) return;
      const lib = useLibraryStore.getState();
      const lastId = lib.settings?.lastPlaylistId || null;
      if (lastId) {
        const peakIds = lib.getPeaksForPlaylist(lastId).map((p) => p.id);
        if (peakIds.length > 0) {
          await usePlayerStore.getState().primeQueue(peakIds, 0, lastId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- navigation handlers ----

  // Search result picked -> open the editor in create mode for that video.
  const handlePickSong = useCallback((song) => {
    setSelectedVideo(toVideo(song));
    setEditingPeak(null);
    setReturnScreen('library');
    setScreen('editor');
  }, []);

  // Open a playlist detail screen.
  const handleOpenPlaylist = useCallback((playlistId) => {
    setCurrentPlaylistId(playlistId);
    setScreen('playlist');
  }, []);

  // Edit an existing peak -> open the editor in edit mode using the stored Song.
  const handleEditPeak = useCallback((peak) => {
    const song = useLibraryStore.getState().songsById[peak.videoId];
    setSelectedVideo(toVideo({ ...song, videoId: peak.videoId, title: song?.title ?? peak.title }));
    setEditingPeak(peak);
    setReturnScreen('playlist');
    setScreen('editor');
  }, []);

  // Leave the editor (saved or cancelled) -> go back where we came from.
  const closeEditor = useCallback(() => {
    setSelectedVideo(null);
    setEditingPeak(null);
    setScreen(returnScreen);
  }, [returnScreen]);

  const backToLibrary = useCallback(() => {
    setCurrentPlaylistId(null);
    setScreen('library');
  }, []);

  const openSettings = useCallback(() => setScreen('settings'), []);

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      {screen === 'library' && (
        <LibraryScreen
          onPickSong={handlePickSong}
          onOpenPlaylist={handleOpenPlaylist}
          onOpenSettings={openSettings}
        />
      )}

      {screen === 'settings' && <SettingsScreen onBack={backToLibrary} />}

      {screen === 'playlist' && (
        <PlaylistScreen
          playlistId={currentPlaylistId}
          onBack={backToLibrary}
          onEditPeak={handleEditPeak}
        />
      )}

      {screen === 'editor' && selectedVideo && (
        <PeakEditor
          video={selectedVideo}
          peak={editingPeak || undefined}
          onClose={closeEditor}
          onSaved={closeEditor}
        />
      )}

      {/* Persistent dock + Now Playing overlay + headless engine (global).
          The editor has its own preview player and pauses global playback, so the
          mini-player is hidden there — otherwise it overlaps the Save bar. */}
      {screen !== 'editor' && <MiniPlayer />}
      {expanded && <NowPlayingScreen />}
      <PlayerEngine />
    </div>
  );
}
