// src/components/SettingsScreen.jsx
// Settings (build-spec Sections 5, 10, 11). One place for the personal knobs:
// default peak length, crossfade duration, and clearing search history. All
// values persist through the library store/IndexedDB.

import { useLibraryStore } from '../store/libraryStore.js';
import { ArrowLeft, Waves, Flame, Clock, Trash2, Sparkles } from './icons.jsx';

export default function SettingsScreen({ onBack }) {
  const settings = useLibraryStore((s) => s.settings);
  const searchHistory = useLibraryStore((s) => s.searchHistory);

  const defaultLen = settings?.defaultPeakLengthSec ?? 20;
  const crossfadeMs = settings?.crossfadeMs ?? 0;
  const chromaSync = settings?.chromaSync ?? true;

  const crossfadeSec = (crossfadeMs / 1000).toFixed(crossfadeMs % 1000 === 0 ? 0 : 1);

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
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        {/* Playback */}
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Playback
          </h2>

          {/* Default peak length */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-2">
              <Flame size={18} className="text-emerald-400" />
              <span className="flex-1 text-sm font-medium">Default peak length</span>
              <span className="font-mono text-sm tabular-nums text-emerald-300">{defaultLen}s</span>
            </div>
            <input
              type="range"
              min={5}
              max={60}
              step={1}
              value={defaultLen}
              onChange={(e) => useLibraryStore.getState().setDefaultPeakLength(Number(e.target.value))}
              className="mt-3 w-full accent-emerald-400"
              aria-label="Default peak length in seconds"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Length suggested when you capture a new peak.
            </p>
          </div>

          {/* Crossfade */}
          <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-2">
              <Waves size={18} className="text-emerald-400" />
              <span className="flex-1 text-sm font-medium">Crossfade</span>
              <span className="font-mono text-sm tabular-nums text-emerald-300">
                {crossfadeMs === 0 ? 'Off' : `${crossfadeSec}s`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={12000}
              step={500}
              value={crossfadeMs}
              onChange={(e) => useLibraryStore.getState().setCrossfadeMs(Number(e.target.value))}
              className="mt-3 w-full accent-emerald-400"
              aria-label="Crossfade duration in milliseconds"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Blend the end of each peak into the next.
            </p>
          </div>
        </section>

        {/* Appearance */}
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Appearance
          </h2>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-emerald-400">
                <Sparkles size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">ChromaSync</p>
                <p className="text-xs text-zinc-400">
                  Tint the player with a color drawn from the current artwork.
                </p>
              </div>
              {/* Toggle switch */}
              <button
                type="button"
                role="switch"
                aria-checked={chromaSync}
                aria-label="Toggle ChromaSync"
                onClick={() => useLibraryStore.getState().setChromaSync(!chromaSync)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  chromaSync ? 'bg-emerald-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    chromaSync ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Search history */}
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Search
          </h2>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400">
                <Clock size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Recent searches</p>
                <p className="text-xs text-zinc-400">
                  {searchHistory.length} saved
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => useLibraryStore.getState().clearSearchHistory()}
              disabled={searchHistory.length === 0}
              className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 text-sm font-medium text-zinc-300 transition active:scale-[0.99] disabled:opacity-40"
            >
              <Trash2 size={16} />
              Clear search history
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
