"use client";

import { useEffect, useRef } from "react";

// Real audio spectrum (Web Audio AnalyserNode) on a canvas.
//   * log-spaced bands (50 Hz–14 kHz) mirrored around the centre, bass in the
//     middle — matches how pitch is heard, unlike a linear FFT that crams all
//     the action into the first few bars
//   * treble tilt + slow auto-gain so quiet and loud tracks both fill the height
//   * rounded capsules with peak caps that fall under gravity
//   * costs nothing when it can't be seen: the loop stops once the bars have
//     settled after pause, while the tab is hidden, and with reduced motion
// The audio element is routed through the analyser once (a MediaElementSource
// can only be created once per element); `enabled=false` never creates it.

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
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
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

const SIDE = 22; // bands per side → 44 bars total

export default function Spectrum({ audio, playing, enabled = true, height = 56, className = "", rgb = "255,255,255" }: {
  audio: React.RefObject<HTMLAudioElement | null>; playing: boolean; enabled?: boolean; height?: number; className?: string; rgb?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current; if (!cv || !enabled) return;
    const g = cv.getContext("2d"); if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const level = new Float32Array(SIDE), peak = new Float32Array(SIDE), vel = new Float32Array(SIDE);
    let agc = 0.5, raf = 0, last = 0, data: Uint8Array<ArrayBuffer> | null = null, edges: number[] | null = null;
    const size = () => { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(height * dpr); };
    size();
    const ro = new ResizeObserver(() => { size(); if (!raf) paint(); });
    ro.observe(cv);

    const bandEdges = (ch: Chain) => {
      const nyq = ch.ctx.sampleRate / 2, n = ch.analyser.frequencyBinCount;
      const lo = 50, hi = Math.min(14000, nyq * 0.95);
      return Array.from({ length: SIDE + 1 }, (_, i) => Math.min(n - 1, Math.max(1, Math.round((lo * Math.pow(hi / lo, i / SIDE) / nyq) * n))));
    };

    function paint() {
      const W = cv!.width, H = cv!.height, cx = W / 2, bw = W / (SIDE * 2), w = bw * 0.62, r = Math.min(w / 2, 5 * dpr);
      g!.clearRect(0, 0, W, H);
      // One shared vertical gradient and two batched paths: far cheaper than a
      // gradient + path per bar (this runs every frame).
      const grad = g!.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, `rgba(${rgb},.3)`); grad.addColorStop(1, `rgba(${rgb},.88)`);
      g!.fillStyle = grad;
      g!.beginPath();
      for (let i = 0; i < SIDE; i++) {
        const h = Math.max(2.5 * dpr, level[i]! * H);
        g!.roundRect(cx + i * bw + (bw - w) / 2, H - h, w, h, r);
        g!.roundRect(cx - (i + 1) * bw + (bw - w) / 2, H - h, w, h, r);
      }
      g!.fill();
      g!.fillStyle = `rgba(${rgb},.9)`;
      g!.beginPath();
      for (let i = 0; i < SIDE; i++) {
        if (level[i]! <= 0.06) continue;
        const py = H - Math.max(level[i]!, peak[i]!) * H - 4 * dpr;
        g!.roundRect(cx + i * bw + (bw - w) / 2, py, w, 2 * dpr, dpr);
        g!.roundRect(cx - (i + 1) * bw + (bw - w) / 2, py, w, 2 * dpr, dpr);
      }
      g!.fill();
    }

    const frame = (t: number) => {
      raf = 0;
      if (document.hidden) return;
      if (t - last < 26) { raf = requestAnimationFrame(frame); return; } // ~38 fps: smooth for bars, half the cost of 60
      last = t;
      const el = audio.current;
      const ch = playing && el ? chainFor(el) : null;
      if (ch && ch.ctx.state === "suspended") void ch.ctx.resume();
      let real = false;
      if (ch) {
        data ??= new Uint8Array(new ArrayBuffer(ch.analyser.frequencyBinCount));
        edges ??= bandEdges(ch);
        ch.analyser.getByteFrequencyData(data);
        real = data.some((v) => v > 0);
      }
      let frameMax = 0, moving = false;
      for (let i = 0; i < SIDE; i++) {
        let target = 0.03;
        if (playing) {
          if (real && data && edges) {
            const a = edges[i]!, b = Math.max(a + 1, edges[i + 1]!);
            let sum = 0; for (let k = a; k < b; k++) sum += data[k]!;
            const v = (sum / (b - a) / 255) * (0.6 + 1.1 * (i / SIDE)); // treble tilt
            frameMax = Math.max(frameMax, v); target = v;
          } else target = 0.12 + 0.3 * Math.abs(Math.sin(t / 420 + i * 0.55)) * Math.abs(Math.sin(t / 1100 + i * 0.3));
        }
        if (playing && real) target = Math.min(1, Math.pow(target / Math.max(agc, 0.3), 1.2));
        const cur = level[i]!;
        level[i] = cur + (target - cur) * (target > cur ? 0.55 : 0.14);
        if (level[i]! > peak[i]!) { peak[i] = level[i]!; vel[i] = 0; } else { vel[i] = vel[i]! + 0.0009; peak[i] = Math.max(level[i]!, peak[i]! - vel[i]!); }
        if (Math.abs(level[i]! - 0.03) > 0.012 || peak[i]! - level[i]! > 0.012) moving = true;
      }
      if (real) agc = Math.max(agc * 0.998, frameMax);
      paint();
      if (playing || moving) raf = requestAnimationFrame(frame);
    };

    if (reduce) { for (let i = 0; i < SIDE; i++) level[i] = 0.18 * (1 - i / (SIDE * 1.4)); paint(); }
    else raf = requestAnimationFrame(frame);
    const vis = () => { if (!document.hidden && !raf && !reduce) raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, [audio, playing, enabled, height, rgb]);

  return <canvas ref={ref} className={`w-full ${className}`} style={{ height, display: enabled ? undefined : "none" }} aria-hidden />;
}
