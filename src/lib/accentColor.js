// src/lib/accentColor.js
// Derive a dynamic accent color from a song's thumbnail (build-spec Section 11,
// Phase 6). Tiny offscreen-canvas sampler — no external dependency.
//
// We downscale the image to a small canvas, then pick the most *vibrant* sampled
// pixel (high saturation, mid lightness) instead of a flat average (which tends
// to come out muddy grey). The result is nudged into a legible band so it always
// reads well on the near-black UI. A cross-origin draw can taint the canvas; on
// ANY failure we resolve null and callers fall back to the default accent.

import { useEffect, useState } from 'react';

const DEFAULT_ACCENT = '#34d399'; // emerald-400, the app's base accent
const cache = new Map(); // url -> hex | null (memoize; thumbnails repeat a lot)

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

const toHex = (n) => n.toString(16).padStart(2, '0');

/** Pick the most vibrant pixel from RGBA canvas data and make it UI-legible. */
function pickVibrant(data) {
  let best = null;
  let bestScore = -1;
  let avg = [0, 0, 0];
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue; // skip transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    avg[0] += r;
    avg[1] += g;
    avg[2] += b;
    count++;
    const [, s, l] = rgbToHsl(r, g, b);
    // Reward saturation; penalize near-black / near-white where hue is unstable.
    const score = s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score > bestScore) {
      bestScore = score;
      best = [r, g, b];
    }
  }

  if (!count) return DEFAULT_ACCENT;
  // Too washed-out to find any vibrancy -> use the average instead.
  if (!best || bestScore < 0.05) {
    best = [avg[0] / count, avg[1] / count, avg[2] / count];
  }

  let [h, s, l] = rgbToHsl(best[0], best[1], best[2]);
  s = Math.max(0.5, s); // ensure it isn't grey
  l = Math.min(0.7, Math.max(0.45, l)); // keep it bright but not glaring
  const [r, g, b] = hslToRgb(h, s, l);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Resolve a hex accent color for an image URL (memoized). Never rejects: returns
 * null on any failure (CORS taint, load error, missing URL).
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export function getAccentColor(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const hex = pickVibrant(data);
        cache.set(url, hex);
        resolve(hex);
      } catch {
        cache.set(url, null); // tainted canvas / read blocked
        resolve(null);
      }
    };
    img.onerror = () => {
      cache.set(url, null);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * React hook: returns an accent hex for `url`, falling back to `fallback` until
 * (or unless) extraction succeeds.
 * @param {string} url
 * @param {string} [fallback]
 * @returns {string}
 */
export function useAccentColor(url, fallback = DEFAULT_ACCENT) {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    let active = true;
    setColor(fallback);
    getAccentColor(url).then((c) => {
      if (active && c) setColor(c);
    });
    return () => {
      active = false;
    };
  }, [url, fallback]);
  return color;
}

export { DEFAULT_ACCENT };
