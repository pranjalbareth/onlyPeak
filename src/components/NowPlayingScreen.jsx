// src/components/NowPlayingScreen.jsx
// Full-screen Now Playing overlay (Section 8) expanded from the mini-player. Shown
// only when playerStore.expanded === true. Reads/writes the single playerStore —
// no local index. Up-next titles are resolved from the library store's peaksById.

import { usePlayerStore } from '../store/playerStore.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { formatRange, formatTime } from '../lib/peakMath.js';
import { useAccentColor } from '../lib/accentColor.js';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat1,
  Shuffle,
  Music,
} from './icons.jsx';

export default function NowPlayingScreen() {
  const expanded = usePlayerStore((s) => s.expanded);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const currentPeak = usePlayerStore((s) => s.currentPeak);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const mode = usePlayerStore((s) => s.mode);
  const shuffle = usePlayerStore((s) => s.shuffle);

  const peaksById = useLibraryStore((s) => s.peaksById);
  const chromaSync = useLibraryStore((s) => s.settings?.chromaSync ?? true);

  // Dynamic accent derived from the current artwork (ChromaSync). When disabled,
  // pass no url so the hook holds the emerald fallback.
  const accent = useAccentColor(chromaSync ? currentSong?.thumbnailUrl : null);

  if (!expanded) return null;

  const player = usePlayerStore.getState;

  const len = Math.max(0.0001, (currentPeak?.endSec || 0) - (currentPeak?.startSec || 0));
  const progress = Math.min(1, Math.max(0, (positionSec || 0) / len));

  const upNext = queue
    .slice(index + 1, index + 5)
    .map((id) => peaksById[id])
    .filter(Boolean);

  const loopOneActive = mode === 'loop-one';

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950 text-zinc-100"
      style={{ '--accent': accent }}
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-[max(env(safe-area-inset-top),1rem)]">
        {/* Header: collapse */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => player().setExpanded(false)}
            aria-label="Collapse now playing"
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-900"
          >
            <ChevronDown size={26} aria-hidden="true" />
          </button>
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {queue.length > 0 ? `Peak ${index + 1} of ${queue.length}` : 'Now Playing'}
          </span>
          <div className="h-11 w-11" aria-hidden="true" />
        </div>

        {/* Artwork */}
        <div className="mt-4 flex justify-center">
          <div
            className="aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
            style={{ boxShadow: '0 24px 70px -24px color-mix(in srgb, var(--accent) 55%, transparent)' }}
          >
            {currentSong?.thumbnailUrl ? (
              <img
                src={currentSong.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-600">
                <Music size={64} aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        {/* Title / artist / range */}
        <div className="mt-6 min-w-0">
          <h1 className="truncate text-xl font-semibold text-zinc-100">
            {currentPeak?.title || currentSong?.title || 'Untitled peak'}
          </h1>
          <p className="mt-0.5 truncate text-sm text-zinc-400">
            {currentSong?.artist || 'Unknown artist'}
          </p>
          {currentPeak && (
            <p className="mt-1 text-xs text-zinc-500">
              {formatRange(currentPeak.startSec, currentPeak.endSec)}
            </p>
          )}
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full transition-[width] duration-150 ease-linear"
              style={{ width: `${progress * 100}%`, backgroundColor: 'var(--accent)' }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-zinc-500">
            <span>{formatTime(positionSec)}</span>
            <span>{formatTime(len)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="mt-6 flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => player().prev()}
            aria-label="Previous peak"
            className="flex h-12 w-12 items-center justify-center rounded-full text-zinc-200 hover:bg-zinc-900"
          >
            <SkipBack size={28} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => player().toggle()}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex h-16 w-16 items-center justify-center rounded-full text-black shadow-lg active:scale-95"
            style={{
              backgroundColor: 'var(--accent)',
              boxShadow: '0 10px 30px -8px color-mix(in srgb, var(--accent) 45%, transparent)',
            }}
          >
            {isPlaying ? (
              <Pause size={30} aria-hidden="true" />
            ) : (
              <Play size={30} className="translate-x-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => player().next()}
            aria-label="Next peak"
            className="flex h-12 w-12 items-center justify-center rounded-full text-zinc-200 hover:bg-zinc-900"
          >
            <SkipForward size={28} aria-hidden="true" />
          </button>
        </div>

        {/* Secondary toggles: loop-one + shuffle */}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => player().toggleLoopOne()}
            aria-label="Loop this peak"
            aria-pressed={loopOneActive}
            className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
              loopOneActive
                ? 'bg-emerald-400/15 text-emerald-400'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Repeat1 size={18} aria-hidden="true" />
            Loop one
          </button>

          <button
            type="button"
            onClick={() => player().toggleShuffle()}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
              shuffle
                ? 'bg-emerald-400/15 text-emerald-400'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Shuffle size={18} aria-hidden="true" />
            Shuffle
          </button>
        </div>

        {/* Up next */}
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Up next
          </h2>
          {upNext.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">End of queue</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {upNext.map((peak, i) => (
                <li
                  key={peak.id}
                  className="flex items-center gap-3 rounded-xl px-2 py-2"
                >
                  <span className="w-5 shrink-0 text-center text-xs tabular-nums text-zinc-600">
                    {index + 2 + i}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">
                      {peak.title || 'Untitled peak'}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {formatRange(peak.startSec, peak.endSec)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
