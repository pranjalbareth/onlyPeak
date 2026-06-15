// src/lib/peakMath.js
// Pure peak math (Section 7). No imports, no side effects — every function is a
// deterministic transform of its inputs, so it is trivially unit-testable and
// shared by the editor, stores, and UI readouts.
//
// Heatmap segment shape: { startSec: number, endSec: number, value: number }
// where value is replay intensity in 0..1 (yt-dlp `heatmap` field).

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Return the single hottest (max `value`) heatmap segment, or null if the
 * heatmap is null/empty/not an array.
 * @param {Array<{startSec:number,endSec:number,value:number}>|null} heatmap
 * @returns {{startSec:number,endSec:number,value:number}|null}
 */
export function hottestSegment(heatmap) {
  if (!Array.isArray(heatmap) || heatmap.length === 0) return null;
  let best = heatmap[0];
  for (let i = 1; i < heatmap.length; i++) {
    if ((heatmap[i]?.value ?? -Infinity) > (best?.value ?? -Infinity)) {
      best = heatmap[i];
    }
  }
  return best ?? null;
}

/**
 * Suggest a peak window from the Most Replayed heatmap (Section 7 algorithm).
 * - No/empty heatmap: window starts at durationSec * 0.33, clamped so it fits.
 * - Otherwise: center a defaultLengthSec window on the midpoint of the hottest
 *   segment, clamped so it fits within [0, durationSec].
 * @param {Array|null} heatmap
 * @param {number} durationSec
 * @param {number} [defaultLengthSec=20]
 * @returns {{startSec:number,endSec:number}}
 */
export function suggestPeak(heatmap, durationSec, defaultLengthSec = 20) {
  const dur = Math.max(0, durationSec || 0);
  // If the song is shorter than the default window, the whole song is the peak.
  const length = Math.min(defaultLengthSec, dur) || defaultLengthSec;
  const maxStart = Math.max(0, dur - length);

  const hottest = hottestSegment(heatmap);
  if (!hottest) {
    const start = clamp(dur * 0.33, 0, maxStart);
    return { startSec: start, endSec: start + length };
  }

  const mid = (hottest.startSec + hottest.endSec) / 2;
  const half = length / 2;
  const startSec = clamp(mid - half, 0, maxStart);
  return { startSec, endSec: startSec + length };
}

/**
 * Enforce all peak guardrails: start >= 0, end <= durationSec, start < end, and
 * the [minLen, maxLen] length bounds. When start and end collide, the window is
 * grown to minLen, preferring to extend the end but falling back to the start if
 * there is no room at the end.
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} durationSec
 * @param {{minLen?:number,maxLen?:number}} [opts]
 * @returns {{startSec:number,endSec:number}}
 */
export function clampPeak(startSec, endSec, durationSec, { minLen = 3, maxLen = 60 } = {}) {
  const dur = Math.max(0, durationSec || 0);
  // Effective bounds: a song shorter than minLen can't honor minLen literally.
  const effMin = Math.min(minLen, dur) || minLen;

  let start = clamp(Number(startSec) || 0, 0, dur);
  let end = clamp(Number(endSec) || 0, 0, dur);

  // Ensure ordering.
  if (end < start) [start, end] = [end, start];

  let len = end - start;

  // Enforce max length first (trim the end).
  if (len > maxLen) {
    end = start + maxLen;
    if (end > dur) {
      end = dur;
      start = Math.max(0, end - maxLen);
    }
    len = end - start;
  }

  // Enforce min length: grow the end, then the start if the end has no room.
  if (len < effMin) {
    end = start + effMin;
    if (end > dur) {
      end = dur;
      start = Math.max(0, end - effMin);
    }
  }

  return { startSec: start, endSec: end };
}

/**
 * Format seconds as "m:ss" (e.g. 72 -> "1:12"). Negative/NaN clamps to "0:00".
 * @param {number} sec
 * @returns {string}
 */
export function formatTime(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format a peak range as "1:12 – 1:34 · 22s" (en-dash separator, rounded length).
 * @param {number} startSec
 * @param {number} endSec
 * @returns {string}
 */
export function formatRange(startSec, endSec) {
  const start = Math.max(0, Number(startSec) || 0);
  const end = Math.max(0, Number(endSec) || 0);
  const lenSec = Math.max(0, Math.round(end - start));
  return `${formatTime(start)} – ${formatTime(end)} · ${lenSec}s`;
}
