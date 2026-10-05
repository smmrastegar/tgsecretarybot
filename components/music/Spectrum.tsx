"use client";

import { useEffect, useRef } from "react";

// Real audio spectrum (Web Audio AnalyserNode) drawn on a canvas in a
// neutral translucent colour. The audio element is routed through the
// analyser once (createMediaElementSource may only be called once per
// element). If anything about Web Audio fails, it falls back to a soft
// animated bar field so the player never looks dead.

type Chain = { ctx: AudioContext; analyser: AnalyserNode };
const chains = new WeakMap<HTMLAudioElement, Chain | "failed">();

function chainFor(el: HTMLAudioElement): Chain | null {
  const have = chains.get(el);
  if (have === "failed") return null;
  if (have) return have;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    const c = { ctx, analyser };
    chains.set(el, c);
    return c;
  } catch {
    chains.set(el, "failed");
    return null;
  }
}

export default function Spectrum({ audio, playing, bars = 32, height = 56, className = "", rgb = "255,255,255" }: {
  audio: React.RefObject<HTMLAudioElement | null>; playing: boolean; bars?: number; height?: number; className?: string; rgb?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const level = useRef<number[]>(Array(bars).fill(0));

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(height * dpr); };
    resize();
    const g = cv.getContext("2d"); if (!g) return;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const draw = (t: number) => {
      const el = audio.current;
      const ch = playing && el ? chainFor(el) : null;
      if (ch && ch.ctx.state === "suspended") void ch.ctx.resume();
      g.clearRect(0, 0, cv.width, cv.height);
      let real = false;
      if (ch) {
        data ??= new Uint8Array(new ArrayBuffer(ch.analyser.frequencyBinCount));
        ch.analyser.getByteFrequencyData(data);
        real = data.some((v) => v > 0);
      }
      const usable = data ? Math.floor(data.length * 0.75) : 0; // top bins are mostly empty
      const bw = cv.width / bars;
      for (let i = 0; i < bars; i++) {
        let target: number;
        if (!playing) target = 0.04;
        else if (real && data) {
          const a = Math.floor((i / bars) * usable), b = Math.max(a + 1, Math.floor(((i + 1) / bars) * usable));
          let sum = 0; for (let k = a; k < b; k++) sum += data[k]!;
          target = Math.pow(sum / (b - a) / 255, 1.15);
        } else target = 0.15 + 0.35 * Math.abs(Math.sin(t / 380 + i * 0.7)) * Math.abs(Math.sin(t / 900 + i));
        const cur = level.current[i] ?? 0;
        level.current[i] = cur + (target - cur) * (target > cur ? 0.5 : 0.12);
        const h = Math.max(3 * dpr, level.current[i]! * cv.height);
        const x = i * bw + bw * 0.18, w = bw * 0.64;
        const grad = g.createLinearGradient(0, cv.height - h, 0, cv.height);
        // Neutral and translucent: fades out toward the top so it sits on
        // any artwork without a coloured slab.
        grad.addColorStop(0, `rgba(${rgb},0)`);
        grad.addColorStop(0.5, `rgba(${rgb},.35)`);
        grad.addColorStop(1, `rgba(${rgb},.75)`);
        g.fillStyle = grad;
        g.beginPath();
        g.roundRect(x, cv.height - h, w, h, Math.min(w / 2, 6 * dpr));
        g.fill();
      }
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener("resize", resize); };
  }, [audio, playing, bars, height, rgb]);

  return <canvas ref={ref} className={`w-full ${className}`} style={{ height }} aria-hidden />;
}
