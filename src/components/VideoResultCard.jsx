// src/components/VideoResultCard.jsx
// Compact search-result row (Section 8). Whole row is tappable and calls onPick
// with the song so the parent can resolve + open the Peak Editor. Shows an
// emerald "N peaks" pill when the library already has peaks for this video,
// subscribing to libraryStore so the badge updates live as peaks are saved.

import { useLibraryStore } from '../store/libraryStore.js';
import { formatTime } from '../lib/peakMath.js';
import { Music } from './icons.jsx';

/**
 * @param {{ song: object, onPick: (song: object) => void }} props
 */
export default function VideoResultCard({ song, onPick }) {
  // Subscribe to the peak map so the badge re-renders when peaks change.
  const peakCount = useLibraryStore((s) => s.getPeakCountByVideoId(song.videoId));

  return (
    <button
      type="button"
      onClick={() => onPick(song)}
      className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 pr-3 text-left min-h-11 transition active:bg-zinc-800"
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
        {song.thumbnailUrl ? (
          <img
            src={song.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-16 w-16 object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-zinc-600">
            <Music className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-medium leading-tight text-zinc-100">
          {song.title}
        </p>
        <p className="mt-0.5 truncate text-sm text-zinc-400">{song.artist}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            {formatTime(song.durationSec)}
          </span>
          {peakCount > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
              {peakCount} {peakCount === 1 ? 'peak' : 'peaks'}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
