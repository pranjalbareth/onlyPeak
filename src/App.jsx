// src/App.jsx
// State-based screen router for OnlyPeak (no react-router). Three primary screens
// — 'library' | 'editor' | 'playlist' — are switched purely by local state. The
// Now Playing screen is an OVERLAY driven by usePlayerStore.expanded, not a
// routed screen. The MiniPlayer and the headless PlayerEngine render globally on
// every screen so playback and the dock survive navigation.
//
// Flows:
//   LibraryScreen.onPickSong(song)  -> resolve the song, open PeakEditor (create)
//   LibraryScreen.onOpenPlaylist(id)-> PlaylistScreen
//   PlaylistScreen.onEditPeak(peak) -> resolve the song, open PeakEditor (edit)
//   PeakEditor.onSaved / onClose    -> return to the previous screen
//
// On mount we hydrate the library store, then (if a last playlist exists) prime
// the player queue PAUSED so the mini-player can resume the last session.

import { useCallback, useEffect, useState } from 'react';
import { useLibraryStore } from './store/libraryStore.js';
import { usePlayerStore } from './store/playerStore.js';
import * as api from './lib/api.js';

import LibraryScreen from './components/LibraryScreen.jsx';
import PlaylistScreen from './components/PlaylistScreen.jsx';
import PeakEditor from './components/PeakEditor.jsx';
import MiniPlayer from './components/MiniPlayer.jsx';
import NowPlayingScreen from './components/NowPlayingScreen.jsx';
import PlayerEngine from './components/PlayerEngine.jsx';
import { X } from './components/icons.jsx';

export default function App() {
  // Which primary screen is showing + the params each screen needs.
  const [screen, setScreen] = useState('library'); // 'library' | 'editor' | 'playlist'
  const [selectedVideo, setSelectedVideo] = useState(null); // resolved video for create mode
  const [editingPeak, setEditingPeak] = useState(null); // Peak for edit mode (null = create)
  const [currentPlaylistId, setCurrentPlaylistId] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);

  // Remember where to return after the editor closes.
  const [returnScreen, setReturnScreen] = useState('library');

  // Now Playing overlay visibility (single source of truth lives in the store).
  const expanded = usePlayerStore((s) => s.expanded);

  // ---- boot: hydrate the library + prime the last session into the dock ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await useLibraryStore.getState().init();
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

  // Search result picked -> resolve metadata + heatmap, then open the editor.
  const handlePickSong = useCallback(async (song) => {
    setResolving(true);
    setResolveError(null);
    try {
      const video = await api.resolveSong(song.videoId);
      setSelectedVideo(video);
      setEditingPeak(null);
      setReturnScreen('library');
      setScreen('editor');
    } catch (err) {
      setResolveError(err?.message || 'Could not load that song. Try again.');
    } finally {
      setResolving(false);
    }
  }, []);

  // Open a playlist detail screen.
  const handleOpenPlaylist = useCallback((playlistId) => {
    setCurrentPlaylistId(playlistId);
    setScreen('playlist');
  }, []);

  // Edit an existing peak -> resolve its song, then open the editor in edit mode.
  const handleEditPeak = useCallback(async (peak) => {
    setResolving(true);
    setResolveError(null);
    try {
      const video = await api.resolveSong(peak.videoId);
      setSelectedVideo(video);
      setEditingPeak(peak);
      setReturnScreen('playlist');
      setScreen('editor');
    } catch (err) {
      setResolveError(err?.message || 'Could not load that song. Try again.');
    } finally {
      setResolving(false);
    }
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

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      {screen === 'library' && (
        <LibraryScreen onPickSong={handlePickSong} onOpenPlaylist={handleOpenPlaylist} />
      )}

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

      {/* Full-screen "resolving…" veil while /resolve is in flight. */}
      {resolving && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 text-zinc-300">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
            <span className="text-sm">Loading song…</span>
          </div>
        </div>
      )}

      {/* Resolve error toast (auto-dismissable). */}
      {resolveError && (
        <div className="fixed inset-x-0 bottom-24 z-[70] mx-auto flex w-full max-w-md justify-center px-4">
          <div
            role="alert"
            className="flex w-full items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 shadow-lg shadow-black/40"
          >
            <span className="min-w-0 flex-1">{resolveError}</span>
            <button
              type="button"
              onClick={() => setResolveError(null)}
              aria-label="Dismiss"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-200 hover:bg-red-500/20"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Persistent dock + Now Playing overlay + headless engine (global). */}
      <MiniPlayer />
      {expanded && <NowPlayingScreen />}
      <PlayerEngine />
    </div>
  );
}
