"use client";

import { useRef, useState } from "react";
import { fmt } from "./shared";

// Seek bar modelled on Spotify / Apple Music: a 44 px touch target around a
// slim track that thickens while held, a buffered segment, a floating time
// bubble while dragging, elapsed + remaining readouts, and an ARIA slider
// with keyboard support. While dragging, playback keeps going and the bar
// follows the finger; the seek is committed on release.
export default function SeekBar({ pos, dur, buffered, onSeek }: { pos: number; dur: number; buffered: number; onSeek: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const max = dur > 0 ? dur : 0;
  const shown = drag ?? Math.min(pos, max);
  const pct = max > 0 ? (shown / max) * 100 : 0;
  const bufPct = max > 0 ? Math.min(100, (buffered / max) * 100) : 0;
  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.min(max, Math.max(0, ((clientX - r.left) / r.width) * max));
  };
  const down = (e: React.PointerEvent) => {
    if (max <= 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(at(e.clientX));
  };
  const move = (e: React.PointerEvent) => { if (drag != null) setDrag(at(e.clientX)); };
  const up = (e: React.PointerEvent) => { if (drag == null) return; onSeek(at(e.clientX)); setDrag(null); };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onSeek(Math.min(max, pos + step)); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onSeek(Math.max(0, pos - step)); }
    else if (e.key === "Home") { e.preventDefault(); onSeek(0); }
    else if (e.key === "End") { e.preventDefault(); onSeek(Math.max(0, max - 1)); }
  };
  const active = drag != null;
  return (
    <div className="select-none">
      <div ref={box} role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(shown)} aria-valuetext={`${fmt(shown)} of ${fmt(max)}`}
        className="relative h-11 -mx-1 px-1 flex items-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ac))] rounded-lg"
        style={{ touchAction: "pan-y" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
        <div className="relative w-full rounded-full bg-[var(--s2)] transition-[height] duration-150" style={{ height: active ? 8 : 4 }}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--dim3)] opacity-60" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-[rgb(var(--ac))]" style={{ width: `${pct}%` }} />
          <div className="absolute top-1/2 rounded-full bg-[rgb(var(--ac))] shadow-[0_1px_6px_rgba(0,0,0,.45)] transition-transform duration-150"
            style={{ left: `${pct}%`, width: 14, height: 14, transform: `translate(-50%, -50%) scale(${active ? 1.45 : 1})` }} />
          {active && (
            <div className="absolute -top-9 px-2 py-0.5 rounded-md bg-[var(--bg2)] border border-[var(--bd)] text-xs font-semibold tabular-nums shadow-lg" style={{ left: `clamp(24px, ${pct}%, calc(100% - 24px))`, transform: "translateX(-50%)" }}>{fmt(shown)}</div>
          )}
        </div>
      </div>
      <div className="flex justify-between text-xs text-[var(--dim)] tabular-nums -mt-1"><span>{fmt(shown)}</span><span>-{fmt(Math.max(0, max - shown))}</span></div>
    </div>
  );
}
