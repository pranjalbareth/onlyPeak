// src/components/PeakEditor.jsx
// The heart of OnlyPeak: create AND edit a peak in one component (Section 8).
//
// On mount it pauses the global player and starts looping the working window in
// a VISIBLE YouTube IFrame preview player. The IFrame also supplies durationSec
// (getDuration) and title/artist (getVideoData) when the video came from a
// pasted URL or a search result that lacked them — so both entry paths work
// without a backend.
//
// Props:
//   video  { videoId, title, artist, durationSec, thumbnailUrl, heatmap }
//   peak   optional Peak -> EDIT mode (preloads its start/end/title)
//   onClose() -> void
//   onSaved(savedPeak) -> void

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';
import { loadYTApi } from '../lib/ytIframe.js';
import {
  suggestPeak,
  clampPeak,
  hottestSegment,
  formatRange,
} from '../lib/peakMath.js';
import {
  ArrowLeft,
  Play,
  Pause,
  Repeat,
  Flame,
  Plus,
  Check,
  X,
} from './icons.jsx';
import HeatmapScrubber from './HeatmapScrubber.jsx';

const MIN_LEN = 3;
const MAX_LEN = 90;
const NUDGE = 1; // seconds per −/+ nudge
const POLL_MS = 150; // preview position poll / loop enforcement

export default function PeakEditor({ video, peak, onClose, onSaved }) {
  const isEdit = Boolean(peak);
  const heatmap = video?.heatmap ?? null;

  const playlists = useLibraryStore((s) => s.playlists);
  const settings = useLibraryStore((s) => s.settings);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const savePeak = useLibraryStore((s) => s.savePeak);

  const defaultLen = settings?.defaultPeakLengthSec ?? 20;

  // durationSec is state: it starts from the passed video (0 for URL paste) and
  // is filled in from the IFrame's getDuration() once the player is ready.
  const [durationSec, setDurationSec] = useState(Math.max(0, Number(video?.durationSec) || 0));
  // Title/artist may also be backfilled from the player (URL paste).
  const [meta, setMeta] = useState({ title: video?.title || '', artist: video?.artist || '' });

  // Whether the initial selection came from the heatmap (drives the chip).
  const usedHeatmap = useMemo(() => Boolean(hottestSegment(heatmap)), [heatmap]);

  // ---- selection state (the peak window) ----
  const [sel, setSel] = useState(() => {
    if (isEdit) {
      return clampPeak(peak.startSec, peak.endSec, durationSec, { minLen: MIN_LEN, maxLen: MAX_LEN });
    }
    const s = suggestPeak(heatmap, durationSec, defaultLen);
    return clampPeak(s.startSec, s.endSec, durationSec, { minLen: MIN_LEN, maxLen: MAX_LEN });
  });
  const { startSec, endSec } = sel;

  // Live refs so the poll callback always sees the latest window.
  const startRef = useRef(startSec);
  const endRef = useRef(endSec);
  startRef.current = startSec;
  endRef.current = endSec;

  // Once the user touches the window, stop auto-re-suggesting when duration loads.
  const autoSuggestRef = useRef(!isEdit);

  const setWindow = useCallback(
    (next) => {
      autoSuggestRef.current = false;
      setSel(clampPeak(next.startSec, next.endSec, durationSec, { minLen: MIN_LEN, maxLen: MAX_LEN }));
    },
    [durationSec]
  );

  // When duration becomes known (0 -> real) and the user hasn't tuned yet,
  // recompute the suggested window so it fits the real song length.
  useEffect(() => {
    if (isEdit || !autoSuggestRef.current || durationSec <= 0) return;
    const s = suggestPeak(heatmap, durationSec, defaultLen);
    setSel(clampPeak(s.startSec, s.endSec, durationSec, { minLen: MIN_LEN, maxLen: MAX_LEN }));
  }, [durationSec, isEdit, heatmap, defaultLen]);

  // ---- YouTube IFrame preview ----
  const playerDivRef = useRef(null);
  const ytRef = useRef(null);
  const readyRef = useRef(false);
  const pollRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(startSec);

  // Pause the global player as soon as the editor opens.
  useEffect(() => {
    usePlayerStore.getState().pause();
  }, []);

  // Create the preview player once and run the loop poll.
  useEffect(() => {
    let cancelled = false;
    loadYTApi().then((YT) => {
      if (cancelled || !playerDivRef.current) return;
      ytRef.current = new YT.Player(playerDivRef.current, {
        width: '100%',
        height: '100%',
        videoId: video.videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady(e) {
            if (cancelled) return;
            readyRef.current = true;
            // Backfill duration + metadata from the player.
            try {
              const d = e.target.getDuration?.();
              if (Number.isFinite(d) && d > 0) setDurationSec(d);
            } catch { /* ignore */ }
            try {
              const vd = e.target.getVideoData?.();
              if (vd && (vd.title || vd.author)) {
                setMeta((m) => ({
                  title: m.title || vd.title || '',
                  artist: m.artist || vd.author || '',
                }));
                if (!isEdit) setName((n) => (n ? n : vd.title || ''));
              }
            } catch { /* ignore */ }
            try {
              e.target.seekTo(startRef.current, true);
              e.target.playVideo();
            } catch { /* ignore */ }
          },
          onStateChange(e) {
            if (cancelled) return;
            setIsPlaying(e.data === 1); // 1 = PLAYING
          },
        },
      });
    });

    pollRef.current = setInterval(() => {
      const player = ytRef.current;
      if (!player || !readyRef.current) return;
      try {
        const ct = player.getCurrentTime();
        if (ct >= endRef.current || ct < startRef.current - 0.5) {
          player.seekTo(startRef.current, true);
          setPositionSec(startRef.current);
        } else {
          setPositionSec(ct);
        }
      } catch { /* player not ready */ }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
      try { ytRef.current?.destroy(); } catch { /* ignore */ }
      ytRef.current = null;
      readyRef.current = false;
    };
  }, [video.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // If IN/OUT move outside the current playhead, re-anchor to IN.
  useEffect(() => {
    const player = ytRef.current;
    if (!player || !readyRef.current) return;
    try {
      const ct = player.getCurrentTime();
      if (ct < startSec || ct >= endSec) {
        player.seekTo(startSec, true);
        setPositionSec(startSec);
      }
    } catch { /* ignore */ }
  }, [startSec, endSec]);

  const togglePreview = () => {
    const player = ytRef.current;
    if (!player || !readyRef.current) return;
    try {
      if (player.getPlayerState() === 1) {
        player.pauseVideo();
      } else {
        const ct = player.getCurrentTime();
        if (ct < startRef.current || ct >= endRef.current) player.seekTo(startRef.current, true);
        player.playVideo();
      }
    } catch { /* ignore */ }
  };

  // ---- control row actions ----
  const snapToHottest = () => {
    const s = suggestPeak(heatmap, durationSec, Math.round(endSec - startSec) || defaultLen);
    setWindow(s);
  };
  const nudgeIn = (delta) => setWindow({ startSec: startSec + delta, endSec });
  const nudgeOut = (delta) => setWindow({ startSec, endSec: endSec + delta });
  const setInToPlayhead = () => setWindow({ startSec: positionSec, endSec });
  const setOutToPlayhead = () => setWindow({ startSec, endSec: positionSec });

  // ---- save sheet ----
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState(isEdit ? peak.title : video.title || '');
  const [playlistId, setPlaylistId] = useState(settings?.lastPlaylistId || playlists[0]?.id || '');
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (isEdit) return;
    if (!playlistId && (settings?.lastPlaylistId || playlists[0]?.id)) {
      setPlaylistId(settings?.lastPlaylistId || playlists[0]?.id || '');
    }
  }, [settings?.lastPlaylistId, playlists, playlistId, isEdit]);

  const addNewPlaylist = async () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    const pl = await createPlaylist(trimmed);
    setPlaylistId(pl.id);
    setNewPlaylistName('');
    setNewPlaylistOpen(false);
  };

  const canSave = isEdit || Boolean(playlistId);

  const doSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await savePeak(
        {
          id: isEdit ? peak.id : undefined,
          videoId: video.videoId,
          title: (name || meta.title || 'Untitled peak').trim(),
          startSec,
          endSec,
          song: {
            videoId: video.videoId,
            title: meta.title || video.title || '',
            artist: meta.artist || video.artist || '',
            durationSec,
            thumbnailUrl: video.thumbnailUrl,
          },
        },
        playlistId
      );
      try { ytRef.current?.pauseVideo(); } catch { /* ignore */ }
      onSaved?.(saved);
    } catch (err) {
      setSaveError(err.message || String(err));
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-md flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-2 bg-zinc-950/90 px-3 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-800"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-base font-semibold">{isEdit ? 'Edit peak' : 'New peak'}</h1>
        </div>

        <div className="flex flex-col gap-4 px-4 pb-40 pt-2">
          {/* Song header */}
          <div className="flex items-center gap-3">
            {video.thumbnailUrl ? (
              <img src={video.thumbnailUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-xl bg-zinc-800" />
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{meta.title || 'Loading…'}</p>
              <p className="truncate text-sm text-zinc-400">{meta.artist}</p>
            </div>
          </div>

          {/* YouTube IFrame preview */}
          <div
            className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
            style={{ aspectRatio: '16 / 9' }}
          >
            <div ref={playerDivRef} style={{ width: '100%', height: '100%' }} />
          </div>

          {/* Transport row */}
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={togglePreview}
              aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400 text-black hover:bg-emerald-300"
            >
              {isPlaying ? <Pause size={26} /> : <Play size={26} className="translate-x-0.5" />}
            </button>
            <div className="flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-2 text-xs text-emerald-300">
              <Repeat size={16} />
              Looping peak
            </div>
          </div>

          {/* Suggested-from-heatmap chip */}
          {usedHeatmap && !isEdit && (
            <div className="flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300">
              <Flame size={14} />
              Suggested from most replayed
            </div>
          )}

          {/* Heatmap scrubber (flat track) */}
          <HeatmapScrubber
            durationSec={durationSec}
            heatmap={heatmap}
            startSec={startSec}
            endSec={endSec}
            positionSec={positionSec}
            onChange={setWindow}
          />

          {/* Readout */}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-zinc-400">Peak window</span>
            <span className="font-mono text-base font-semibold text-emerald-300">
              {formatRange(startSec, endSec)}
            </span>
          </div>

          {/* Snap to hottest */}
          {usedHeatmap && (
            <button
              type="button"
              onClick={snapToHottest}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-sm font-medium hover:bg-zinc-800"
            >
              <Flame size={16} className="text-emerald-400" />
              Snap to hottest
            </button>
          )}

          {/* IN / OUT control grid */}
          <div className="grid grid-cols-2 gap-3">
            <HandleControl label="IN" onMinus={() => nudgeIn(-NUDGE)} onPlus={() => nudgeIn(NUDGE)} onSet={setInToPlayhead} />
            <HandleControl label="OUT" onMinus={() => nudgeOut(-NUDGE)} onPlus={() => nudgeOut(NUDGE)} onSet={setOutToPlayhead} />
          </div>
        </div>

        {/* Bottom save bar */}
        <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-zinc-800 bg-zinc-950/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-400 text-base font-semibold text-black hover:bg-emerald-300"
          >
            <Check size={20} />
            {isEdit ? 'Save changes' : 'Save peak'}
          </button>
        </div>

        {/* Save sheet */}
        {sheetOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <button type="button" aria-label="Dismiss" onClick={() => !saving && setSheetOpen(false)} className="absolute inset-0 bg-black/60" />
            <div className="relative w-full max-w-md rounded-t-2xl border-t border-zinc-800 bg-zinc-900 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">{isEdit ? 'Save changes' : 'Save peak'}</h2>
                <button type="button" onClick={() => !saving && setSheetOpen(false)} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800">
                  <X size={20} />
                </button>
              </div>

              <label className="mb-1 block text-xs font-medium text-zinc-400">Peak name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={meta.title}
                className="mb-4 min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-400"
              />

              <div className="mb-4 rounded-xl bg-zinc-950 px-3 py-2 font-mono text-sm text-emerald-300">
                {formatRange(startSec, endSec)}
              </div>

              {!isEdit && (
                <>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">Add to playlist</label>
                  <div className="mb-2 flex max-h-44 flex-col gap-2 overflow-y-auto">
                    {playlists.length === 0 && !newPlaylistOpen && (
                      <p className="py-2 text-sm text-zinc-500">No playlists yet — create one.</p>
                    )}
                    {playlists.map((pl) => {
                      const active = pl.id === playlistId;
                      return (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => setPlaylistId(pl.id)}
                          className={`flex min-h-11 items-center justify-between rounded-xl border px-3 text-left text-sm ${
                            active
                              ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                              : 'border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-800'
                          }`}
                        >
                          <span className="truncate">{pl.name}</span>
                          {active && <Check size={18} className="shrink-0 text-emerald-400" />}
                        </button>
                      );
                    })}
                  </div>

                  {newPlaylistOpen ? (
                    <div className="mb-3 flex items-center gap-2">
                      <input
                        value={newPlaylistName}
                        onChange={(e) => setNewPlaylistName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addNewPlaylist()}
                        autoFocus
                        placeholder="Playlist name"
                        className="min-h-11 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-emerald-400"
                      />
                      <button type="button" onClick={addNewPlaylist} aria-label="Create playlist" className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400 text-black hover:bg-emerald-300">
                        <Check size={20} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNewPlaylistOpen(true)}
                      className="mb-3 flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-medium text-emerald-300 hover:text-emerald-200"
                    >
                      <Plus size={18} />
                      New playlist
                    </button>
                  )}
                </>
              )}

              {saveError && <p className="mb-3 text-sm text-red-400" role="alert">{saveError}</p>}

              <button
                type="button"
                onClick={doSave}
                disabled={!canSave || saving}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-400 text-base font-semibold text-black hover:bg-emerald-300 disabled:opacity-50"
              >
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save peak'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A single IN/OUT handle control: label, −/+ nudges (±1s), and "Set" to playhead.
 */
function HandleControl({ label, onMinus, onPlus, onSet }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
      <span className="text-xs font-semibold tracking-wide text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onMinus} aria-label={`${label} minus one second`} className="flex h-11 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-lg font-semibold leading-none hover:bg-zinc-700">
          −
        </button>
        <button type="button" onClick={onPlus} aria-label={`${label} plus one second`} className="flex h-11 flex-1 items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700">
          <Plus size={18} />
        </button>
      </div>
      <button type="button" onClick={onSet} className="flex min-h-11 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium hover:bg-zinc-700">
        Set {label}
      </button>
    </div>
  );
}
