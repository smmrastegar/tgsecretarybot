"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

// Text that picks its own size: the biggest size (between max and min) that keeps it on ONE line; only a text that is too long
// even at the smallest size wraps, and then at the biggest size that fits in `lines` lines. Re-fits when the width changes.
export default function FitText({ children, max, min, lines = 2, className = "", style }: { children: ReactNode; max: number; min: number; lines?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.whiteSpace = "nowrap";
      for (let s = max; s >= min; s -= 0.5) {
        el.style.fontSize = `${s}px`;
        if (el.scrollWidth <= el.clientWidth + 0.5) return;
      }
      el.style.whiteSpace = "normal";
      for (let s = max - 2; s >= min; s -= 0.5) {
        el.style.fontSize = `${s}px`;
        if (el.scrollHeight <= s * 1.25 * lines + 2) return;
      }
      el.style.fontSize = `${min}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, max, min, lines]);

  return <div ref={ref} className={`${className}`} style={{ fontSize: max, lineHeight: 1.2, overflowWrap: "anywhere", ...style }}>{children}</div>;
}
