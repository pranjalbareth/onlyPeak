// src/components/MiniPlayer.jsx
// Persistent mini-player docked at the bottom of the content column (design-system
// mini-player rules). Reads/writes the single playerStore — it keeps no index of
// its own. Hidden whenever the queue is empty. Tapping the body expands into the
// Now Playing screen; the play/pause and next buttons stopPropagation so they
// don't also trigger the expand.

import { usePlayerStore } from '../store/playerStore.js';
import { formatRange } from '../lib/peakMath.js';
import { Play, Pause, SkipForward, Music } from './icons.jsx';

export default function MiniPlayer() {
  const queue = usePlayerStore((s) => s.queue);
  const currentPeak = usePlayerStore((s) => s.currentPeak);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const expanded = usePlayerStore((s) => s.expanded);

  // Nothing loaded -> no dock. Also stay hidden while Now Playing is open.
  if (queue.length === 0 || !currentPeak || expanded) return null;

  const len = Math.max(0.0001, (currentPeak.endSec || 0) - (currentPeak.startSec || 0));
  const progress = Math.min(1, Math.max(0, (positionSec || 0) / len));

  const onToggle = (e) => {
    e.stopPropagation();
    usePlayerStore.getState().toggle();
  };
  const onNext = (e) => {
    e.stopPropagation();
    usePlayerStore.getState().next();
  };
  const onExpand = () => usePlayerStore.getState().setExpanded(true);

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 pb-[env(safe-area-inset-bottom)]">
      <div
        role="button"
        tabIndex={0}
        onClick={onExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onExpand();
          }
        }}
        aria-label="Open now playing"
        className="mx-2 mb-2 cursor-pointer overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-lg shadow-black/40"
      >
        <div className="flex items-center gap-3 px-3 py-2">
          {/* Thumbnail */}
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
            {currentSong?.thumbnailUrl ? (
              <img
                src={currentSong.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500">
                <Music size={20} aria-hidden="true" />
              </div>
            )}
          </div>

          {/* Title + range */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-zinc-100">
              {currentPeak.title || currentSong?.title || 'Untitled peak'}
            </div>
            <div className="truncate text-xs text-zinc-400">
              {formatRange(currentPeak.startSec, currentPeak.endSec)}
            </div>
          </div>

          {/* Play / pause */}
          <button
            type="button"
            onClick={onToggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-100 hover:bg-zinc-800"
          >
            {isPlaying ? (
              <Pause size={22} aria-hidden="true" />
            ) : (
              <Play size={22} aria-hidden="true" />
            )}
          </button>

          {/* Next */}
          <button
            type="button"
            onClick={onNext}
            aria-label="Next peak"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-100 hover:bg-zinc-800"
          >
            <SkipForward size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Thin emerald progress bar */}
        <div className="h-0.5 w-full bg-zinc-800">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-150 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
