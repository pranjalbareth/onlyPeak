// src/components/PlaylistScreen.jsx
// Playlist detail screen (Section 8). Shows a playlist's ordered peaks with a big
// Play, shuffle / loop-playlist toggles, a "make available offline" action, and a
// per-row overflow menu (Play / Edit / Move / Delete). Pointer-based drag-to-
// reorder rewrites order through the library store. This component is read-only
// over playback state — all playback goes through the player store, which is the
// single source of truth for the current index.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';
import { formatRange } from '../lib/peakMath.js';
import {
  ArrowLeft,
  Play,
  Shuffle,
  Repeat,
  Download,
  CloudOff,
  GripVertical,
  MoreVertical,
  Edit,
  Trash2,
  Check,
  X,
  ListMusic,
  Music,
} from './icons.jsx';

export default function PlaylistScreen({ playlistId, onBack, onEditPeak }) {
  // Subscribe to the slices that drive this screen so it re-renders on any change.
  const playlists = useLibraryStore((s) => s.playlists);
  const peaksById = useLibraryStore((s) => s.peaksById);

  const playlist = useMemo(
    () => playlists.find((p) => p.id === playlistId) || null,
    [playlists, playlistId]
  );

  // Derive the ordered peaks from the subscribed slices (re-runs on changes).
  const peaks = useMemo(() => {
    if (!playlist) return [];
    return playlist.peakIds.map((id) => peaksById[id]).filter(Boolean);
  }, [playlist, peaksById]);

  // Player-state reflection for the toggles.
  const shuffle = usePlayerStore((s) => s.shuffle);
  const loopPlaylist = usePlayerStore((s) => s.loopPlaylist);

  // ---- inline rename ----
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (renaming && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [renaming]);

  function startRename() {
    setNameDraft(playlist?.name || '');
    setRenaming(true);
  }

  async function commitRename() {
    const name = nameDraft.trim();
    if (name && playlist && name !== playlist.name) {
      await useLibraryStore.getState().renamePlaylist(playlist.id, name);
    }
    setRenaming(false);
  }

  function cancelRename() {
    setRenaming(false);
  }

  // ---- offline caching ----
  const [caching, setCaching] = useState(false);
  const [cacheMsg, setCacheMsg] = useState(null);

  async function makeOffline() {
    if (caching || peaks.length === 0) return;
    setCaching(true);
    setCacheMsg(null);
    try {
      const { cached, failed } = await useLibraryStore.getState().cachePlaylist(playlistId);
      setCacheMsg(
        failed.length === 0
          ? `Saved ${cached.length} for offline`
          : `Saved ${cached.length}, ${failed.length} failed`
      );
    } catch (err) {
      setCacheMsg(err.message || 'Caching failed');
    } finally {
      setCaching(false);
    }
  }

  // ---- per-peak offline download / remove ----
  const [downloadingId, setDownloadingId] = useState(null);

  async function downloadPeak(peakId) {
    closeMenus();
    if (downloadingId) return;
    setDownloadingId(peakId);
    setCacheMsg(null);
    try {
      await useLibraryStore.getState().cachePeak(peakId);
      setCacheMsg('Saved for offline');
    } catch (err) {
      setCacheMsg(err.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  }

  async function removeDownload(peakId) {
    closeMenus();
    await useLibraryStore.getState().uncachePeak(peakId);
    setCacheMsg('Removed download');
  }

  // ---- overflow menu (which row's menu is open) ----
  const [openMenuId, setOpenMenuId] = useState(null);
  // Row id currently showing the "move to playlist" sub-list.
  const [moveForId, setMoveForId] = useState(null);

  function closeMenus() {
    setOpenMenuId(null);
    setMoveForId(null);
  }

  // ---- drag-to-reorder (pointer based) ----
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const rowRefs = useRef([]);
  const dragState = useRef({ active: false, from: null });

  function rowIndexFromPoint(clientY) {
    const els = rowRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return els.filter(Boolean).length - 1;
  }

  function onHandlePointerDown(e, index) {
    // Only respond to primary button / touch / pen.
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    closeMenus();
    dragState.current = { active: true, from: index };
    setDragIndex(index);
    setOverIndex(index);

    const handleMove = (ev) => {
      if (!dragState.current.active) return;
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      setOverIndex(rowIndexFromPoint(y));
    };
    const handleUp = async () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      const { from } = dragState.current;
      dragState.current = { active: false, from: null };
      const to = overIndexRef.current;
      setDragIndex(null);
      setOverIndex(null);
      if (from != null && to != null && from !== to) {
        await useLibraryStore.getState().reorderPlaylist(playlistId, from, to);
        await usePlayerStore.getState().reconcileActivePlaylist();
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }

  // Keep a ref mirror of overIndex so the pointerup handler reads the latest value.
  const overIndexRef = useRef(null);
  useEffect(() => {
    overIndexRef.current = overIndex;
  }, [overIndex]);

  // ---- playback actions ----
  function playAll() {
    usePlayerStore.getState().playPlaylist(playlistId, 0);
  }
  function playFrom(index) {
    closeMenus();
    usePlayerStore.getState().playPlaylist(playlistId, index);
  }

  // ---- row menu actions ----
  function editPeak(peak) {
    closeMenus();
    onEditPeak?.(peak);
  }
  async function removeFromThis(peakId) {
    closeMenus();
    await useLibraryStore.getState().removePeakFromPlaylist(peakId, playlistId);
    await usePlayerStore.getState().reconcileActivePlaylist();
  }
  async function deletePeak(peakId) {
    closeMenus();
    await useLibraryStore.getState().deletePeak(peakId);
    await usePlayerStore.getState().reconcileActivePlaylist();
  }
  async function moveTo(peakId, toId) {
    closeMenus();
    await useLibraryStore.getState().movePeakToPlaylist(peakId, playlistId, toId);
    await usePlayerStore.getState().reconcileActivePlaylist();
  }

  const otherPlaylists = useMemo(
    () => playlists.filter((p) => p.id !== playlistId),
    [playlists, playlistId]
  );

  if (!playlist) {
    return (
      <div className="min-h-dvh bg-zinc-950 text-zinc-100">
        <div className="mx-auto w-full max-w-md px-4 pt-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-900"
          >
            <ArrowLeft size={22} />
          </button>
          <p className="mt-8 text-center text-zinc-400">Playlist not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-md px-4 pb-28 pt-3">
        {/* Top bar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-900"
          >
            <ArrowLeft size={22} />
          </button>
        </div>

        {/* Header */}
        <div className="mt-2">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                ref={nameInputRef}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') cancelRename();
                }}
                className="min-h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xl font-bold text-zinc-100 outline-none focus:border-emerald-500"
                aria-label="Playlist name"
              />
              <button
                type="button"
                onClick={commitRename}
                aria-label="Save name"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-emerald-500 text-black"
              >
                <Check size={20} />
              </button>
              <button
                type="button"
                onClick={cancelRename}
                aria-label="Cancel rename"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-900"
              >
                <X size={20} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startRename}
              className="flex w-full items-center gap-2 text-left"
              aria-label="Rename playlist"
            >
              <h1 className="flex-1 truncate text-2xl font-bold text-zinc-100">{playlist.name}</h1>
              <Edit size={18} className="shrink-0 text-zinc-500" />
            </button>
          )}
          <p className="mt-1 text-sm text-zinc-400">
            {peaks.length} {peaks.length === 1 ? 'peak' : 'peaks'}
          </p>
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={playAll}
            disabled={peaks.length === 0}
            aria-label="Play playlist"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:opacity-40"
          >
            <Play size={26} className="ml-0.5 fill-current" />
          </button>

          <button
            type="button"
            onClick={() => usePlayerStore.getState().toggleShuffle()}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border transition ${
              shuffle
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400'
            }`}
          >
            <Shuffle size={20} />
          </button>

          <button
            type="button"
            onClick={() => usePlayerStore.getState().toggleLoopPlaylist()}
            aria-label="Loop playlist"
            aria-pressed={loopPlaylist}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border transition ${
              loopPlaylist
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400'
            }`}
          >
            <Repeat size={20} />
          </button>

          <button
            type="button"
            onClick={makeOffline}
            disabled={caching || peaks.length === 0}
            aria-label="Make available offline"
            className="ml-auto flex min-h-11 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-4 text-sm text-zinc-300 transition active:scale-95 disabled:opacity-40"
          >
            <Download size={18} className={caching ? 'animate-pulse text-emerald-400' : ''} />
            <span>{caching ? 'Saving…' : 'Offline'}</span>
          </button>
        </div>

        {cacheMsg && (
          <p className="mt-2 text-xs text-emerald-400" role="status">
            {cacheMsg}
          </p>
        )}

        {/* Peak list */}
        {peaks.length === 0 ? (
          <div className="mt-12 flex flex-col items-center gap-3 text-center text-zinc-500">
            <ListMusic size={40} className="text-zinc-700" />
            <p>No peaks yet. Add peaks from a song to build this playlist.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {peaks.map((peak, index) => {
              const isDragging = dragIndex === index;
              const isDropTarget =
                dragIndex != null && overIndex === index && overIndex !== dragIndex;
              return (
                <li
                  key={peak.id}
                  ref={(el) => (rowRefs.current[index] = el)}
                  className={`relative flex items-center gap-2 rounded-2xl border bg-zinc-900 p-2 transition ${
                    isDragging
                      ? 'border-emerald-500/50 opacity-60'
                      : isDropTarget
                        ? 'border-emerald-500/60'
                        : 'border-zinc-800'
                  }`}
                >
                  {/* Drag handle */}
                  <button
                    type="button"
                    aria-label="Reorder peak"
                    onPointerDown={(e) => onHandlePointerDown(e, index)}
                    className="flex min-h-11 min-w-11 cursor-grab touch-none items-center justify-center text-zinc-500 active:cursor-grabbing"
                  >
                    <GripVertical size={20} />
                  </button>

                  {/* Body — tap to play from here */}
                  <button
                    type="button"
                    onClick={() => playFrom(index)}
                    className="flex min-w-0 flex-1 flex-col items-start py-1 text-left"
                  >
                    <span className="w-full truncate text-sm font-medium text-zinc-100">
                      {peak.title}
                    </span>
                    <span className="mt-0.5 truncate text-xs text-zinc-400">
                      {formatRange(peak.startSec, peak.endSec)}
                    </span>
                  </button>

                  {/* Cached indicator */}
                  <span
                    className="flex min-h-11 min-w-9 items-center justify-center"
                    aria-label={peak.cached ? 'Available offline' : 'Streaming only'}
                    title={peak.cached ? 'Available offline' : 'Streaming only'}
                  >
                    {downloadingId === peak.id ? (
                      <Download size={16} className="animate-pulse text-emerald-400" />
                    ) : peak.cached ? (
                      <Download size={16} className="text-emerald-400" />
                    ) : (
                      <CloudOff size={16} className="text-zinc-600" />
                    )}
                  </span>

                  {/* Overflow menu */}
                  <button
                    type="button"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === peak.id}
                    onClick={() => {
                      setMoveForId(null);
                      setOpenMenuId((cur) => (cur === peak.id ? null : peak.id));
                    }}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800"
                  >
                    <MoreVertical size={20} />
                  </button>

                  {openMenuId === peak.id && (
                    <>
                      {/* Click-away backdrop */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={closeMenus}
                        aria-hidden="true"
                      />
                      <div
                        role="menu"
                        className="absolute right-2 top-12 z-50 w-52 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 py-1 shadow-xl shadow-black/40"
                      >
                        {moveForId === peak.id ? (
                          <div className="max-h-64 overflow-y-auto">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => setMoveForId(null)}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-400 hover:bg-zinc-800"
                            >
                              <ArrowLeft size={16} />
                              Move to…
                            </button>
                            {otherPlaylists.length === 0 ? (
                              <p className="px-3 py-2.5 text-xs text-zinc-500">
                                No other playlists.
                              </p>
                            ) : (
                              otherPlaylists.map((pl) => (
                                <button
                                  key={pl.id}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => moveTo(peak.id, pl.id)}
                                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                                >
                                  <Music size={16} className="shrink-0 text-zinc-500" />
                                  <span className="truncate">{pl.name}</span>
                                </button>
                              ))
                            )}
                          </div>
                        ) : (
                          <>
                            <MenuItem
                              icon={<Play size={16} />}
                              label="Play"
                              onClick={() => playFrom(index)}
                            />
                            <MenuItem
                              icon={<Edit size={16} />}
                              label="Edit"
                              onClick={() => editPeak(peak)}
                            />
                            {peak.cached ? (
                              <MenuItem
                                icon={<CloudOff size={16} />}
                                label="Remove download"
                                onClick={() => removeDownload(peak.id)}
                              />
                            ) : (
                              <MenuItem
                                icon={<Download size={16} />}
                                label={downloadingId === peak.id ? 'Downloading…' : 'Download for offline'}
                                onClick={() => downloadPeak(peak.id)}
                              />
                            )}
                            <MenuItem
                              icon={<ListMusic size={16} />}
                              label="Move to playlist"
                              onClick={() => setMoveForId(peak.id)}
                            />
                            <MenuItem
                              icon={<X size={16} />}
                              label="Remove from playlist"
                              onClick={() => removeFromThis(peak.id)}
                            />
                            <div className="my-1 border-t border-zinc-800" />
                            <MenuItem
                              icon={<Trash2 size={16} />}
                              label="Delete peak"
                              destructive
                              onClick={() => deletePeak(peak.id)}
                            />
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, destructive }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-zinc-800 ${
        destructive ? 'text-red-400' : 'text-zinc-200'
      }`}
    >
      <span className={`shrink-0 ${destructive ? 'text-red-400' : 'text-zinc-500'}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
