// src/components/SearchBar.jsx
// Pinned search input — the entry point for creating peaks (Section 8, Library).
// Controlled by the parent (LibraryScreen owns the query text) so other surfaces
// — recent-search chips, paste-a-URL — can drive it. Submitting (Enter or the
// emerald button) calls onSubmit; the parent decides search vs. resolve-URL.

import { Search, X } from './icons.jsx';

/**
 * @param {{
 *   value: string,
 *   onChange: (next: string) => void,
 *   onSubmit: () => void,
 *   loading?: boolean,
 * }} props
 */
export default function SearchBar({ value, onChange, onSubmit, loading = false }) {
  function submit(e) {
    e?.preventDefault();
    onSubmit();
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className="flex items-center gap-2 bg-zinc-950 py-3"
    >
      <div className="flex flex-1 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-4 min-h-11 focus-within:border-emerald-500">
        <Search className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden="true" />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoCorrect="off"
          autoComplete="off"
          spellCheck="false"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search, or paste a YouTube link"
          aria-label="Search for a song or paste a YouTube link"
          className="min-w-0 flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-500 outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        aria-label="Search"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500 text-black transition hover:bg-emerald-400 disabled:opacity-50"
      >
        {loading ? (
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-black/30 border-t-black"
            aria-hidden="true"
          />
        ) : (
          <Search className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
