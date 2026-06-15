// src/components/HeatmapScrubber.jsx
// The timeline IS the heatmap. Vertical bars span [0, durationSec], each bar's
// height encoding replay intensity (heatmap value, normalized 0..1). Two
// draggable handles (IN / OUT) bracket the selection; the region between them is
// highlighted emerald and a thin playhead line tracks the looping preview.
//
// Pointer Events drive both touch and mouse with large invisible hit areas so
// the small visual handles stay easy to grab on Android. Every drag result is
// run through clampPeak so the selection can never violate the guardrails.
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

// Number of bars to render across the track when we have a heatmap. The heatmap
// is resampled onto this fixed grid so the bar field stays dense and even
// regardless of how many raw segments the backend returned.
const BAR_COUNT = 56;
const MIN_LEN = 3;
const MAX_LEN = 90;

/**
 * Resample a heatmap onto a fixed-width grid of normalized (0..1) values.
 * Returns an array of BAR_COUNT numbers, or null when there is no usable heatmap
 * (caller then renders a flat neutral track).
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
      const t0 = (i / BAR_COUNT) * durationSec;
      const t1 = ((i + 1) / BAR_COUNT) * durationSec;
      const mid = (t0 + t1) / 2;
      // Pick the heatmap segment covering this bar's midpoint (fallback: nearest).
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
  // Which handle is being dragged: 'in' | 'out' | null.
  const [dragging, setDragging] = useState(null);
  const bars = useBars(heatmap, durationSec);

  const dur = Math.max(0, Number(durationSec) || 0);
  const safeDur = dur > 0 ? dur : 1; // avoid divide-by-zero for percentage math

  const pct = (sec) => `${Math.min(100, Math.max(0, (sec / safeDur) * 100))}%`;

  // Convert a clientX into a time in [0, dur] using the track's box.
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

  // Apply a drag of one handle and emit a guardrailed selection.
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

  // Pointer handlers are bound to window during a drag so the gesture keeps
  // tracking even if the finger/cursor leaves the (short) track height.
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
    // Capture so we receive the full gesture; window listeners do the tracking.
    try {
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already gone; ignore.
    }
    setDragging(which);
    applyDrag(which, xToSec(ev.clientX));
  };

  // Tap on the track body: move the nearer handle to the tapped point.
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
        className="relative h-28 w-full touch-none overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
        role="group"
        aria-label="Heatmap timeline. Drag the in and out handles to set the peak."
      >
        {/* Bar field (heatmap) or a flat neutral track when no heatmap. */}
        <div className="absolute inset-0 flex items-end gap-px px-1 pb-px">
          {bars
            ? bars.map((v, i) => {
                const barStart = (i / BAR_COUNT) * dur;
                const barEnd = ((i + 1) / BAR_COUNT) * dur;
                const inSel = barEnd > startSec && barStart < endSec;
                const h = Math.max(6, Math.round(v * 100));
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm transition-colors ${
                      inSel ? 'bg-emerald-400' : 'bg-zinc-700'
                    }`}
                    style={{ height: `${h}%` }}
                  />
                );
              })
            : (
              // Flat neutral track when the heatmap is unavailable.
              <div className="absolute inset-x-2 bottom-1/2 h-1 translate-y-1/2 rounded-full bg-zinc-700" />
            )}
        </div>

        {/* Dim the unselected regions so the bracket reads clearly. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-zinc-950/60"
          style={{ width: startPct }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-zinc-950/60"
          style={{ left: `calc(${startPct} + ${widthPct})` }}
        />

        {/* Selected region outline. */}
        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-emerald-400/70 bg-emerald-400/5"
          style={{ left: startPct, width: widthPct }}
        />

        {/* Playhead (preview position). */}
        {playheadVisible && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-zinc-100"
            style={{ left: pct(positionSec) }}
          />
        )}

        {/* IN handle — large invisible hit area, small visible grip. */}
        <button
          type="button"
          onPointerDown={startHandle('in')}
          aria-label="Peak start handle"
          className="absolute inset-y-0 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
          style={{ left: startPct }}
        >
          <span
            className={`h-16 w-1.5 rounded-full bg-emerald-400 ${
              dragging === 'in' ? 'ring-2 ring-emerald-300/60' : ''
            }`}
          />
        </button>

        {/* OUT handle. */}
        <button
          type="button"
          onPointerDown={startHandle('out')}
          aria-label="Peak end handle"
          className="absolute inset-y-0 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
          style={{ left: `calc(${startPct} + ${widthPct})` }}
        >
          <span
            className={`h-16 w-1.5 rounded-full bg-emerald-400 ${
              dragging === 'out' ? 'ring-2 ring-emerald-300/60' : ''
            }`}
          />
        </button>
      </div>
    </div>
  );
}
