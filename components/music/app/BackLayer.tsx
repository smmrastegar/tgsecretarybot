"use client";

import { useEffect, useRef } from "react";

// Android/browser Back should close the topmost overlay (sheet, full
// player, drill-down page) instead of leaving the player. Each mounted
// <BackLayer> owns one history entry; Back pops the newest layer.
// Entries left behind by programmatic closes are trimmed afterwards.

type Layer = { idx: number; close: () => void };
const layers: Layer[] = [];
let wired = false;
let trimQueued = false;

const depth = (): number => {
  const s = history.state as { pl?: number } | null;
  return typeof s?.pl === "number" ? s.pl : 0;
};
const live = () => layers.reduce((m, l) => Math.max(m, l.idx), 0);

function trim() {
  if (trimQueued) return;
  trimQueued = true;
  setTimeout(() => {
    trimQueued = false;
    const n = depth() - live();
    if (n > 0) history.go(-n);
  }, 0);
}

function wire() {
  if (wired) return;
  wired = true;
  window.addEventListener("popstate", () => {
    const d = depth();
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i]!.idx > d) layers.splice(i, 1)[0]!.close();
    }
    trim();
  });
}

export default function BackLayer({ onClose }: { onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    wire();
    const idx = depth() + 1;
    try { history.pushState({ ...(history.state ?? {}), pl: idx }, ""); } catch { return; }
    const layer: Layer = { idx, close: () => closeRef.current() };
    layers.push(layer);
    return () => {
      const i = layers.indexOf(layer);
      if (i < 0) return; // already closed via Back
      layers.splice(i, 1);
      trim();
    };
  }, []);
  return null;
}
