// src/components/LibraryScreen.jsx
// Library home (Section 8). Top to bottom in the centered column:
//   1) a sticky search header (entry point for creating peaks),
//   2) search results (when searching / results present) with a dismiss action,
//   3) otherwise the library proper: a "Jump back in" row (last-played playlist
//      card + recent peak chips), the user's playlists as tappable cards, and a
//      "+ New playlist" affordance.
// This screen is the single home surface; the persistent mini-player is rendered
// elsewhere and docks over the bottom, so the scroll area reserves pb-28 for it.

import { useState, useRef, useEffect } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';
import { formatRange } from '../lib/peakMath.js';
import { ListMusic, Music, Plus, X, Check, Play, CloudOff } from './icons.jsx';
import SearchBar from './SearchBar.jsx';
import SearchResults from './SearchResults.jsx';

/**
 * Library home screen.
 * @param {{ onPickSong: (song: object) => void, onOpenPlaylist: (playlistId: string) => void }} props
 */
export default function LibraryScreen({ onPickSong, onOpenPlaylist }) {
  // Subscribe to the slices this screen renders so it reacts to library changes.
  const playlists = useLibraryStore((s) => s.playlists);
  const peaksById = useLibraryStore((s) => s.peaksById);
  const songsById = useLibraryStore((s) => s.songsById);
  const settings = useLibraryStore((s) => s.settings);
  const recentPeakIds = useLibraryStore((s) => s.recentPeakIds);
  const searchResults = useLibraryStore((s) => s.searchResults);
  const searching = useLibraryStore((s) => s.searching);
  const searchError = useLibraryStore((s) => s.searchError);

  const showingSearch = searching || searchResults.length > 0 || Boolean(searchError);

  return (
    <div className="mx-auto w-full max-w-md">
      {/* 1) Sticky search header. */}
      <header className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80 px-4 pt-4 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchBar onSearch={(q) => useLibraryStore.getState().search(q)} />
          </div>
          {showingSearch && (
            <button
              type="button"
              onClick={() => useLibraryStore.getState().clearSearch()}
              aria-label="Clear search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      <main className="px-4 pt-4 pb-28">
        {showingSearch ? (
          <SearchResults
            results={searchResults}
            loading={searching}
            error={searchError}
            onPick={onPickSong}
          />
        ) : (
          <LibraryBody
            playlists={playlists}
            peaksById={peaksById}
            songsById={songsById}
            settings={settings}
            recentPeakIds={recentPeakIds}
            onOpenPlaylist={onOpenPlaylist}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The library content (everything below the search header when not searching).
 */
function LibraryBody({ playlists, peaksById, songsById, settings, recentPeakIds, onOpenPlaylist }) {
  const lastPlaylistId = settings?.lastPlaylistId || null;
  const lastPlaylist = lastPlaylistId
    ? playlists.find((p) => p.id === lastPlaylistId)
    : null;

  // Resolve recent peaks (skip ids that no longer exist).
  const recentPeaks = recentPeakIds
    .map((id) => peaksById[id])
    .filter(Boolean)
    .slice(0, 8);

  const hasJumpBackIn = Boolean(lastPlaylist) || recentPeaks.length > 0;

  return (
    <div className="space-y-7">
      {hasJumpBackIn && (
        <section aria-labelledby="jump-back-in">
          <h2
            id="jump-back-in"
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400"
          >
            Jump back in
          </h2>

          {lastPlaylist && (
            <JumpBackPlaylistCard
              playlist={lastPlaylist}
              peakCount={lastPlaylist.peakIds.length}
              onOpen={() => onOpenPlaylist(lastPlaylist.id)}
            />
          )}

          {recentPeaks.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recentPeaks.map((peak) => (
                <RecentPeakChip
                  key={peak.id}
                  peak={peak}
                  song={songsById[peak.videoId]}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="your-playlists">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="your-playlists"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-400"
          >
            Your playlists
          </h2>
        </div>

        {playlists.length === 0 ? (
          <EmptyPlaylists />
        ) : (
          <ul className="space-y-2">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <PlaylistCard
                  playlist={playlist}
                  peakCount={playlist.peakIds.length}
                  onOpen={() => onOpenPlaylist(playlist.id)}
                />
              </li>
            ))}
          </ul>
        )}

        <NewPlaylistAffordance autoFocus={playlists.length === 0} />
      </section>
    </div>
  );
}

/**
 * The featured "resume" card for the last-played playlist. Tapping the body
 * opens the playlist; the trailing Play button resumes playback in place.
 */
function JumpBackPlaylistCard({ playlist, peakCount, onOpen }) {
  const empty = peakCount === 0;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 flex-1 items-center gap-3 text-left"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-emerald-400">
          <ListMusic className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-zinc-100">{playlist.name}</span>
          <span className="block truncate text-sm text-zinc-400">
            {peakCount} {peakCount === 1 ? 'peak' : 'peaks'} · Resume
          </span>
        </span>
      </button>
      <button
        type="button"
        disabled={empty}
        onClick={() => usePlayerStore.getState().playPlaylist(playlist.id)}
        aria-label={`Play ${playlist.name}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Play className="h-5 w-5 translate-x-px fill-current" />
      </button>
    </div>
  );
}

/**
 * A quick-resume chip for a recently played peak. One tap plays the peak now.
 */
function RecentPeakChip({ peak, song }) {
  const title = peak.title || song?.title || 'Peak';
  return (
    <button
      type="button"
      onClick={() => usePlayerStore.getState().playPeakNow(peak.id)}
      aria-label={`Play ${title}`}
      className="flex min-h-11 max-w-[14rem] shrink-0 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 py-2 pl-2 pr-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black">
        <Play className="h-4 w-4 translate-x-px fill-current" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="truncate text-sm font-medium text-zinc-100">{title}</span>
          {peak.cached && <CloudOff className="h-3 w-3 shrink-0 text-emerald-400" aria-label="Available offline" />}
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {formatRange(peak.startSec, peak.endSec)}
        </span>
      </span>
    </button>
  );
}

/**
 * A standard tappable playlist row (name + peak count).
 */
function PlaylistCard({ playlist, peakCount, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300">
        <ListMusic className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-zinc-100">{playlist.name}</span>
        <span className="block truncate text-sm text-zinc-400">
          {peakCount} {peakCount === 1 ? 'peak' : 'peaks'}
        </span>
      </span>
    </button>
  );
}

/**
 * Empty state for the "Your playlists" section.
 */
function EmptyPlaylists() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
        <Music className="h-6 w-6" />
      </span>
      <p className="font-medium text-zinc-200">No playlists yet</p>
      <p className="mt-1 text-sm text-zinc-500">
        Search for a song to capture its peak, or create a playlist to get started.
      </p>
    </div>
  );
}

/**
 * "+ New playlist" affordance. Collapsed it's a dashed button; tapping reveals an
 * inline name input that creates + persists the playlist via the library store.
 */
function NewPlaylistAffordance({ autoFocus = false }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const cancel = () => {
    setOpen(false);
    setName('');
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await useLibraryStore.getState().createPlaylist(trimmed);
      setName('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        autoFocus={autoFocus}
        className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-emerald-500/60 hover:text-emerald-400"
      >
        <Plus className="h-5 w-5" />
        New playlist
      </button>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') cancel();
        }}
        placeholder="Playlist name"
        maxLength={80}
        className="min-h-11 min-w-0 flex-1 rounded-xl bg-zinc-800 px-3 text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-emerald-500/50"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim() || busy}
        aria-label="Create playlist"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Check className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={cancel}
        aria-label="Cancel"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
