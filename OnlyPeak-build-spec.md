# OnlyPeak — Build Spec for Claude Code

> Hand this whole file to Claude Code. It describes what to build, the decisions already made, the data contracts, the screens, and a phased plan with acceptance criteria. Read the **Non-goals** and **Decision log** first so you don't relitigate settled choices.

---

## 0. Context for the agent

OnlyPeak is a **personal, single-user, Android-first** music app. The owner only wants to hear the best part of each song — "the peak" (the chorus, the drop, the hook) — not whole tracks. They build playlists of these peaks and play them back-to-back.

- It will **never be public**. One user, their own devices. Optimize for that, not for scale, auth, or multi-tenancy.
- Mobile-first, Android only (no iOS constraints to design around). Should install as a PWA.
- This is a **rewrite of the data and playback layer** of an existing React/Vite/Tailwind repo. Reuse the UI shell where useful (search bar, editor layout), but replace the YouTube Data API service and the old hidden-iframe player entirely.

The defining feature: a song's peak is **suggested automatically** from YouTube's "Most Replayed" heatmap, and the user can adjust it by ear.

---

## 1. Decision log (settled — do not relitigate)

- **Catalog source:** YouTube, accessed via `yt-dlp` on a small personal backend. No official YouTube Data API key in the client.
- **Playback:** HTML5 `<audio>` (or Web Audio API), **not** the YouTube iframe. This gives precise seeking, gapless playback, and proper Android background audio.
- **Peak suggestion:** from the Most Replayed heatmap (`yt-dlp` `heatmap` field). Suggested by default, adjustable by dragging in/out handles.
- **A song can hold multiple peaks.** The data model is peak-centric: a `Peak` references a song; one song may have many peaks.
- **Home = Library** (playlists + recent + search), with a **persistent mini-player** that resumes the last session. Not a dedicated now-playing landing.
- **In scope now (★):** offline caching of peak clips, multiple peaks per song, loop-one-peak mode.
- **Later:** crossfade control, dynamic accent color, first-run demo seed, paste-a-URL, search history.

---

## 2. Architecture overview

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Frontend (PWA)             │  HTTP   │  Backend (personal, local/VPS)│
│  React + Vite + Tailwind    │ <-----> │  Python + FastAPI + yt-dlp    │
│  HTML5 <audio> / Web Audio  │         │  + ffmpeg (for clipping)      │
│  IndexedDB (meta + blobs)   │         │                               │
│  MediaSession (lock screen) │         │  /search  /resolve            │
│                             │         │  /audio   /clip               │
└─────────────────────────────┘         └──────────────────────────────┘
                                                  │
                                                  ▼  yt-dlp extracts from
                                            ┌──────────────┐
                                            │   YouTube    │
                                            └──────────────┘
```

Why a backend is required (not optional): `yt-dlp` must run server-side, resolved stream URLs are short-lived and IP-bound, and browser CORS blocks fetching YouTube directly. The backend proxies/clips audio and extracts the heatmap.

---

## 3. Phase 0 — cleanup & security (do this first)

The existing repo committed a live YouTube Data API key in `.env`.

1. **Rotate the leaked key** in Google Cloud Console (treat it as compromised — it has been public).
2. The new architecture **does not use the YouTube Data API at all** (search goes through the backend), so remove the key and the `VITE_YOUTUBE_API_KEY` reference entirely.
3. Add `.env` to `.gitignore`, run `git rm --cached .env`, and purge it from git history (`git filter-repo` or BFG), since the repo history is public.
4. Remove leftover debug `console.log` calls (App, PlaylistItem).
5. Delete dead Vite boilerplate (`src/App.css`).
6. Set up the new project structure (Section 4).

---

## 4. Tech stack & project structure

**Frontend** (keep existing tooling, add a few libs):
- React 19 + Vite + Tailwind (already present).
- `vite-plugin-pwa` — installable PWA + service worker (needed for Android background audio + offline).
- `idb` — thin IndexedDB wrapper.
- `uuid` — already present.
- State: a **single playback store** (Zustand recommended, or one React context) that is the *sole* source of truth for what's playing. Do not let two components both track the current index (the old code had this bug).

**Backend:**
- Python 3.11+, FastAPI, `uvicorn`.
- `yt-dlp` (as a library, kept up to date — pin loosely and update often; it breaks when YouTube changes).
- `ffmpeg` on PATH (for `/clip`).

```
/onlypeak
  /backend
    main.py            # FastAPI app, routes
    youtube.py         # yt-dlp wrappers: search, resolve, stream, clip
    requirements.txt
  /src                 # frontend
    /components        # Screen + UI components
    /store             # playback store + library store
    /db                # IndexedDB schema + accessors (idb)
    /lib               # api client, peak math, mediaSession
    App.jsx, main.jsx
  vite.config.js       # + PWA plugin
```

---

## 5. Data model

Store metadata + audio blobs in **IndexedDB** (localStorage can't hold audio and is too small).

```ts
// The underlying YouTube video. Cached so we don't re-resolve constantly.
interface Song {
  videoId: string;
  title: string;
  artist: string;        // yt-dlp uploader / channel
  durationSec: number;
  thumbnailUrl: string;
}

// A clipped range of a song. One song may have MANY peaks.
interface Peak {
  id: string;            // uuid
  videoId: string;       // -> Song.videoId
  title: string;         // defaults to song title; user-editable
  startSec: number;
  endSec: number;
  createdAt: number;
  cached: boolean;       // true once the clip blob is stored offline
}

// Ordered list of peak ids. A peak may appear in multiple playlists.
interface Playlist {
  id: string;
  name: string;
  peakIds: string[];     // ordered
  createdAt: number;
}

interface Settings {
  defaultPeakLengthSec: number;  // default 20
  crossfadeMs: number;           // default 0 (hard cut); phase 6
  lastPlaylistId?: string;
}
```

**IndexedDB stores:** `songs` (key: videoId), `peaks` (key: id), `playlists` (key: id), `audioBlobs` (key: peakId → Blob), `settings` (single record).

Add a `schemaVersion` to settings and write a migration path, so future shape changes don't brick saved data (old repo had no versioning).

---

## 6. Backend API contract

All JSON unless noted. CORS: allow the app origin(s) only (localhost during dev, plus the deployed origin / LAN IP). No auth needed (personal).

### `GET /api/search?q=<query>&limit=15`
Uses `yt-dlp` `ytsearch{limit}:{query}`.
```json
[
  { "videoId": "abc123", "title": "Sunset Drive", "artist": "The Midnights",
    "durationSec": 204, "thumbnailUrl": "https://..." }
]
```

### `GET /api/resolve/<videoId>`
Runs `yt_dlp.YoutubeDL().extract_info(url, download=False)`. Return metadata + heatmap.
```json
{
  "videoId": "abc123",
  "title": "Sunset Drive",
  "artist": "The Midnights",
  "durationSec": 204,
  "thumbnailUrl": "https://...",
  "heatmap": [ { "startSec": 0, "endSec": 2, "value": 0.31 }, ... ]  // value 0..1, or null
}
```
- `heatmap` comes from the `heatmap` key in `extract_info` when present. If absent (low-engagement video), return `null` — the client falls back to a default window.
- Do **not** return raw googlevideo stream URLs to the client (they expire / are IP-bound). Audio is served via `/api/audio` instead.

### `GET /api/audio/<videoId>`
Proxy-streams the best audio-only format. Must support HTTP `Range` requests and send `Accept-Ranges: bytes` so the `<audio>` element can seek. Content-Type `audio/mp4` or `audio/webm`. Used for **online** playback.

### `GET /api/clip/<videoId>?start=<sec>&end=<sec>`
Uses `ffmpeg` to extract just `[start, end]` as a small file (`ffmpeg -ss <start> -to <end> -i <audiourl> -c:a aac out.m4a`, or stream copy if codec allows). Returns the clip as `audio/mp4`. Used for **offline caching** (client stores the blob in IndexedDB). Keep clips small (a peak is ~20s).

---

## 7. Peak math (shared helper)

```
suggestPeak(heatmap, durationSec, defaultLengthSec):
  if heatmap is null or empty:
    start = clamp(durationSec * 0.33, 0, durationSec - defaultLengthSec)
    return { startSec: start, endSec: start + defaultLengthSec }
  hottest = segment in heatmap with max value
  mid = (hottest.startSec + hottest.endSec) / 2
  half = defaultLengthSec / 2
  startSec = clamp(mid - half, 0, durationSec - defaultLengthSec)
  return { startSec, endSec: startSec + defaultLengthSec }
```
Guardrails everywhere: enforce `start < end`, `start >= 0`, `end <= durationSec`, and a min length (e.g. 3s) and max length (e.g. 60s).

---

## 8. Screens & components

### Library (home) — `LibraryScreen`
Top to bottom:
1. Pinned search bar (entry point for creating peaks). Phase 6: also accept a pasted YouTube URL (detect `youtube.com`/`youtu.be`, parse the videoId, skip straight to resolve).
2. "Jump back in" row: last-played playlist + a few recent peaks (one-tap resume).
3. The user's playlists (tap → PlaylistScreen).
4. Persistent **mini-player** docked at the bottom whenever audio is loaded (see PlayerEngine).

### Search results — within Library or a `SearchScreen`
Compact list rows: thumbnail, title, artist, duration. If the user already has peaks from a song, show a small "N peaks" badge. Tapping a row → PeakEditor for that video (resolve first).

### Peak Editor — `PeakEditor` (the heart of the app)
Opens after `/resolve`. **Opens already looping the suggested peak.**
- Song header: thumbnail, title, artist.
- Chip: "Suggested from most replayed" when heatmap was used.
- **Heatmap scrubber:** the timeline *is* the heatmap (bars or curve, height = replay intensity). Two draggable handles (IN / OUT) bracket the selected region; a playhead loops within it.
- Live **loop preview**: the selected region plays on repeat while editing, so the user tunes by ear.
- Controls: "Snap to hottest" (re-center selection on the heatmap max), −/+ nudge (±1s) for each handle, "set IN/OUT to current position" while playing, play/pause, loop toggle.
- Readout: `Peak  1:12 – 1:34 · 22s`.
- **Save:** small sheet → peak name (defaults to song title) + playlist picker (defaults to last-used, plus "+ New playlist"). Save **always creates a new Peak** (multiple peaks per song).
- **Edit reuses this exact component**, pre-loaded with an existing peak's in/out; saving updates that peak instead of creating one. Make create/edit one component (the old repo couldn't edit at all).

A reference mockup of this screen was produced during planning — match its layout: heatmap-as-scrubber, two handles bracketing the suggested region, transport row, and a "Save peak → [playlist]" bar.

### Playlist — `PlaylistScreen`
Ordered list of peaks. Each row: title, range, and overflow actions: Play, Edit, Move to playlist, Delete (swipe-to-delete on Android). Big **Play** (plays peaks back-to-back), shuffle, loop-playlist, drag-to-reorder.

### Now Playing — `NowPlayingScreen`
Expanded from the mini-player. Shows artwork, "Peak 2 of 7", the range, up-next, transport (prev / play-pause / next), and a **loop-one-peak** toggle. Wire all controls to MediaSession.

---

## 9. Playback engine — `PlayerStore` + `PlayerEngine`

**Single source of truth.** One store holds: `queue: peakId[]`, `index`, `isPlaying`, `positionSec`, `mode` ('playlist' | 'loop-one'). The mini-player and Now Playing both read/write this store. No component keeps its own separate index.

Playback rules:
- **Online:** `<audio src="/api/audio/:videoId">`, set `currentTime = peak.startSec`, on `timeupdate` advance when `currentTime >= peak.endSec`.
- **Offline / instant:** if `peak.cached`, create an object URL from the stored clip blob and play it; the clip is already trimmed, so the natural `ended` event advances the queue.
- **Advance logic:** at peak end → next index. Respect `mode`: `loop-one` repeats the current peak; `playlist` advances and stops (or loops) at the end per the loop-playlist toggle. (The old code had conflicting advance logic — there is exactly one advance path here.)
- **Gapless / preload:** preload the next peak (next clip blob, or a second `<audio>` element). For Phase 6 crossfade, use the Web Audio API with two buffer sources and GainNodes.
- **First play needs a user gesture** (Android autoplay policy): the very first `play()` must be triggered by a tap.

**MediaSession** (`lib/mediaSession.js`): set `navigator.mediaSession.metadata` (title, artist, artwork from thumbnail) on each peak change, and register `play`, `pause`, `previoustrack`, `nexttrack` action handlers that call the store. This gives Android lock-screen / notification controls.

---

## 10. Offline caching (★ in scope)

- On save (or via a "download" action on a peak), call `/api/clip/:videoId?start=&end=`, store the returned blob in IndexedDB `audioBlobs[peakId]`, set `peak.cached = true`.
- Cached peaks play instantly, work with no network, are gapless, and survive the source video being deleted later (link-rot protection).
- Add a per-playlist "make available offline" action that clips all its peaks.
- Show a small offline/cached indicator on cached peaks.

---

## 11. Feature scope

**Now:**
- Library home + persistent mini-player + resume.
- Search → resolve → Peak Editor (suggested-by-default heatmap) → save to playlist.
- Multiple peaks per song.
- Edit / delete / reorder peaks; multiple playlists; a peak in multiple playlists.
- Gapless back-to-back playback; MediaSession lock-screen controls.
- Offline clip caching. ★
- Loop-one-peak mode. ★
- Default peak length + min/max guardrails.

**Later (Phase 6):**
- Crossfade control (Web Audio).
- Dynamic accent color from thumbnail.
- First-run demo playlist seed.
- Paste-a-URL input + search history.

---

## 12. Gotchas & constraints

- **`yt-dlp` is a moving target** — it breaks when YouTube changes internals. Keep it updated; isolate all `yt-dlp` calls in `backend/youtube.py` so fixes are localized.
- **Personal use only.** Using `yt-dlp` against YouTube is against YouTube's ToS; this is acceptable here only because it's a private, single-user tool. Do not add public hosting, sharing, or multi-user features.
- **Stream URLs expire / are IP-bound** — always serve audio through `/api/audio` or cached clips, never hand raw googlevideo URLs to the browser.
- **`/api/audio` must support Range requests**, or seeking in `<audio>` will fail.
- **CORS** — backend must allow the frontend origin explicitly.
- **`ffmpeg` is required** for `/clip`.
- **Heatmap may be absent** for low-engagement videos — always handle `heatmap: null` (default window).
- **Android autoplay** — first `play()` must come from a user gesture.
- **PWA** — needed for installability and reliable background audio; configure `vite-plugin-pwa` with a manifest (name, icons, display: standalone) and a service worker.
- **IndexedDB quota** — cached clips are small but add a way to clear cache / uncache a playlist.

---

## 13. Build phases & acceptance criteria

**Phase 0 — Cleanup & scaffold.** Key rotated & removed from client/history; `.env` gitignored; debug logs and dead CSS gone; backend skeleton + frontend structure in place.

**Phase 1 — Backend search + resolve + audio.** `GET /api/search` returns results; `GET /api/resolve/:id` returns metadata + heatmap (or null); `GET /api/audio/:id` streams seekable audio. *Accept:* curl each endpoint and verify shapes; audio plays and seeks in a browser.

**Phase 2 — Frontend data layer + Library + Search.** IndexedDB schema + accessors; Library screen lists playlists; search calls the backend and shows results. *Accept:* search a song, see results; create/rename/delete a playlist persists across reload.

**Phase 3 — Peak Editor.** Resolve → editor opens looping the suggested peak; heatmap scrubber with draggable handles; snap/nudge/preview; save creates a Peak in a chosen playlist; reopening a peak edits it. *Accept:* a saved peak's range matches what was set; editing changes it; songs can hold ≥2 peaks.

**Phase 4 — Playback + mini-player + Now Playing + MediaSession.** Single PlayerStore; playlist plays back-to-back; mini-player + expand; lock-screen controls work on Android. *Accept:* a playlist plays through in order, prev/next work, lock-screen controls control playback, only one source of truth for the current index.

**Phase 5 — Offline caching.** Clip endpoint + blob storage; cached peaks play offline and gaplessly; cache indicators. *Accept:* enable airplane mode, a cached playlist still plays; transitions are gapless.

**Phase 6 — Polish (later).** Crossfade, accent color, first-run seed, paste-URL, search history.

---

## 14. Non-goals (do not build)

- User accounts, login, multi-user, or any public hosting.
- Spotify/Apple Music integration.
- AI peak suggestion beyond the heatmap.
- Social/sharing features.
- iOS-specific workarounds.

---

## 15. Suggested first command to the agent

> Start with Phase 0 and Phase 1: clean up the repo per Section 3, scaffold the FastAPI backend in `/backend`, and implement `/api/search`, `/api/resolve/:id`, and `/api/audio/:id` using `yt-dlp` and `ffmpeg`. Show me the endpoints working before touching the frontend.
