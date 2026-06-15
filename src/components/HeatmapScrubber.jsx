// src/components/HeatmapScrubber.jsx
// Flat-track timeline scrubber. Unlike a bar-height histogram, every cell is the
// same height (a flat track); replay intensity (when a heatmap is present) is
// encoded as COLOR BRIGHTNESS — bright = hot, dim = cold. Two draggable handles
// (IN / OUT) bracket the peak window, and a thin playhead tracks the preview.
//
// Pointer Events drive both touch and mouse with large invisible hit areas so
// the small visual handles stay easy to grab on Android. Every drag result runs
// through clampPeak so the selection can never violate the guardrails.
//
// Props:
//   durationSec  number
//   heatmap      HeatmapSegment[] | null   ({startSec,endSec,value})
//   startSec     number   (selection IN)
//   endSec       number   (selection OUT)
//   positionSec  number   (preview playhead)
//   onChange     ({startSec,endSec}) => void

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampPeak } from '../lib/peakMath.js';

// Number of flat cells across the track. The heatmap (if any) is resampled onto
// this fixed grid so the track stays even regardless of raw segment count.
const BAR_COUNT = 60;
const MIN_LEN = 3;
const MAX_LEN = 90;

/**
 * Resample a heatmap onto a fixed-width grid of normalized (0..1) values, or
 * null when there is no usable heatmap (the track then renders uniform cells).
 */
function useBars(heatmap, durationSec) {
  return useMemo(() => {
    if (!Array.isArray(heatmap) || heatmap.length === 0 || !durationSec) return null;
    let max = 0;
    for (const seg of heatmap) {
      const v = Number(seg?.value) || 0;
      if (v > max) max = v;
    }
    if (max <= 0) return null;

    const bars = new Array(BAR_COUNT).fill(0);
    for (let i = 0; i < BAR_COUNT; i++) {
      const mid = ((i + 0.5) / BAR_COUNT) * durationSec;
      let value = 0;
      for (const seg of heatmap) {
        if (mid >= seg.startSec && mid < seg.endSec) {
          value = Number(seg.value) || 0;
          break;
        }
      }
      bars[i] = value / max; // normalize 0..1
    }
    return bars;
  }, [heatmap, durationSec]);
}

export default function HeatmapScrubber({
  durationSec,
  heatmap,
  startSec,
  endSec,
  positionSec,
  onChange,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'in' | 'out' | null
  const bars = useBars(heatmap, durationSec);

  const dur = Math.max(0, Number(durationSec) || 0);
  const safeDur = dur > 0 ? dur : 1; // avoid divide-by-zero for percentage math

  const pct = (sec) => `${Math.min(100, Math.max(0, (sec / safeDur) * 100))}%`;

  const xToSec = useCallback(
    (clientX) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      return Math.min(dur, Math.max(0, ratio * dur));
    },
    [dur]
  );

  const applyDrag = useCallback(
    (which, sec) => {
      let s = startSec;
      let e = endSec;
      if (which === 'in') s = sec;
      else e = sec;
      onChange(clampPeak(s, e, dur, { minLen: MIN_LEN, maxLen: MAX_LEN }));
    },
    [startSec, endSec, dur, onChange]
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (ev) => {
      ev.preventDefault();
      applyDrag(dragging, xToSec(ev.clientX));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, applyDrag, xToSec]);

  const startHandle = (which) => (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already gone; ignore.
    }
    setDragging(which);
    applyDrag(which, xToSec(ev.clientX));
  };

  const onTrackPointerDown = (ev) => {
    if (dragging) return;
    const sec = xToSec(ev.clientX);
    const which = Math.abs(sec - startSec) <= Math.abs(sec - endSec) ? 'in' : 'out';
    startHandle(which)(ev);
  };

  const startPct = pct(startSec);
  const widthPct = `${Math.min(100, Math.max(0, ((endSec - startSec) / safeDur) * 100))}%`;
  const playheadVisible =
    typeof positionSec === 'number' && positionSec >= 0 && positionSec <= dur;

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative h-16 w-full touch-none overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80"
        role="group"
        aria-label="Peak timeline. Drag the in and out handles to set the peak."
      >
        {/* Flat cell field — uniform height, brightness encodes heat. */}
        <div className="absolute inset-x-0 inset-y-2 flex items-stretch gap-px px-1">
          {Array.from({ length: BAR_COUNT }).map((_, i) => {
            const barStart = (i / BAR_COUNT) * dur;
            const barEnd = ((i + 1) / BAR_COUNT) * dur;
            const inSel = barEnd > startSec && barStart < endSec;
            const v = bars ? bars[i] : null;
            let bg;
            if (v == null) {
              // No heatmap: uniform cells, selected ones brighter emerald.
              bg = inSel ? 'rgba(52, 211, 153, 0.55)' : 'rgba(63, 63, 70, 0.7)';
            } else if (inSel) {
              bg = `rgba(52, 211, 153, ${0.4 + v * 0.6})`; // emerald, 40–100%
            } else {
              bg = `rgba(161, 161, 170, ${0.1 + v * 0.18})`; // zinc, dimmer
            }
            return <div key={i} className="flex-1 rounded-sm" style={{ backgroundColor: bg }} />;
          })}
        </div>

        {/* Selection bracket. */}
        <div
          className="pointer-events-none absolute inset-y-0 rounded-sm border-x-2 border-emerald-400/60 bg-emerald-400/5"
          style={{ left: startPct, width: widthPct }}
        />

        {/* Playhead. */}
        {playheadVisible && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-white/90"
            style={{ left: pct(positionSec) }}
          />
        )}

        {/* IN handle — large invisible hit area, small visible grip. */}
        <button
          type="button"
          onPointerDown={startHandle('in')}
          aria-label="Peak start handle"
          className="absolute inset-y-0 z-10 flex w-10 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
          style={{ left: startPct }}
        >
          <span
            className={`h-10 w-1.5 rounded-full bg-emerald-400 shadow-md ${
              dragging === 'in' ? 'ring-2 ring-emerald-300/60' : ''
            }`}
          />
        </button>

        {/* OUT handle. */}
        <button
          type="button"
          onPointerDown={startHandle('out')}
          aria-label="Peak end handle"
          className="absolute inset-y-0 z-10 flex w-10 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
          style={{ left: `calc(${startPct} + ${widthPct})` }}
        >
          <span
            className={`h-10 w-1.5 rounded-full bg-emerald-400 shadow-md ${
              dragging === 'out' ? 'ring-2 ring-emerald-300/60' : ''
            }`}
          />
        </button>
      </div>
    </div>
  );
}
