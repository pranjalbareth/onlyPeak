// src/lib/api.js
// Backend HTTP client (Section 6). All calls go to the personal FastAPI backend;
// the base URL comes from VITE_API_BASE_URL (empty string => same-origin).
//
// Stream/clip helpers return URLs (for <audio src> / fetch); fetchClipBlob
// downloads a trimmed clip for offline caching. Non-2xx responses throw an
// Error whose message is the server body (or a generic status line).

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/**
 * Join the API base with a path. `p` should start with '/'.
 * @param {string} p
 * @returns {string}
 */
export function apiUrl(p) {
  return API_BASE + p;
}

/**
 * Throw an Error built from a failed Response, using the response body as the
 * message when available.
 * @param {Response} res
 */
async function throwForResponse(res) {
  let message = `Request failed: ${res.status} ${res.statusText}`;
  try {
    const body = await res.text();
    if (body) message = body;
  } catch {
    // ignore body read failure; keep the status-line message
  }
  throw new Error(message);
}

/**
 * GET /api/search?q=&limit= — search the catalog.
 * @param {string} q
 * @param {number} [limit=15]
 * @returns {Promise<Array<{videoId:string,title:string,artist:string,durationSec:number,thumbnailUrl:string}>>}
 */
export async function searchSongs(q, limit = 15) {
  const url = apiUrl(`/api/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`);
  const res = await fetch(url);
  if (!res.ok) await throwForResponse(res);
  return res.json();
}

/**
 * GET /api/resolve/:videoId — metadata + Most Replayed heatmap (heatmap may be null).
 * @param {string} videoId
 * @returns {Promise<{videoId:string,title:string,artist:string,durationSec:number,thumbnailUrl:string,heatmap:Array|null}>}
 */
export async function resolveSong(videoId) {
  const url = apiUrl(`/api/resolve/${encodeURIComponent(videoId)}`);
  const res = await fetch(url);
  if (!res.ok) await throwForResponse(res);
  return res.json();
}

/**
 * URL for the full seekable audio stream (online playback). Range-capable on
 * the backend. Use as <audio src>.
 * @param {string} videoId
 * @returns {string}
 */
export function audioUrl(videoId) {
  return apiUrl(`/api/audio/${encodeURIComponent(videoId)}`);
}

/**
 * URL for a server-trimmed clip of [startSec, endSec]. Use for caching/preview.
 * @param {string} videoId
 * @param {number} startSec
 * @param {number} endSec
 * @returns {string}
 */
export function clipUrl(videoId, startSec, endSec) {
  return apiUrl(
    `/api/clip/${encodeURIComponent(videoId)}?start=${encodeURIComponent(startSec)}&end=${encodeURIComponent(endSec)}`
  );
}

/**
 * Download a trimmed clip as a Blob for offline storage in IndexedDB.
 * @param {string} videoId
 * @param {number} startSec
 * @param {number} endSec
 * @returns {Promise<Blob>}
 */
export async function fetchClipBlob(videoId, startSec, endSec) {
  const res = await fetch(clipUrl(videoId, startSec, endSec));
  if (!res.ok) await throwForResponse(res);
  return res.blob();
}
