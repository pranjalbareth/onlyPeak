// src/components/SearchResults.jsx
// Renders the result list with its loading / error / empty states (Section 8).
// Stateless: it never resolves a song — picking a row bubbles up via onPick so
// the parent can run /resolve and open the Peak Editor.

import VideoResultCard from './VideoResultCard.jsx';
import { Search } from './icons.jsx';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 pr-3">
      <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-zinc-800" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-12 animate-pulse rounded bg-zinc-800" />
      </div>
    </div>
  );
}

/**
 * @param {{
 *   results: object[],
 *   loading?: boolean,
 *   error?: string | null,
 *   onPick: (song: object) => void,
 * }} props
 */
export default function SearchResults({ results = [], loading = false, error = null, onPick }) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Searching">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center"
      >
        <p className="font-medium text-zinc-100">Search failed</p>
        <p className="mt-1 text-sm text-zinc-400">{error}</p>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-zinc-500">
        <Search className="h-8 w-8" aria-hidden="true" />
        <p className="text-sm">Search for a song to clip its peak</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {results.map((song) => (
        <li key={song.videoId}>
          <VideoResultCard song={song} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}
