"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Long titles in the mini player glide sideways (and pause at both ends) instead of being cut with "…".
// Only text that really overflows moves; with "reduce motion" it falls back to a plain ellipsis.
export default function Marquee({ children, className = "" }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const measure = () => {
      const b = box.current, i = inner.current;
      if (!b || !i) return;
      const over = i.scrollWidth - b.clientWidth;
      setShift(over > 4 ? over + 12 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [children]);

  const secs = Math.max(5, shift / 22 + 3);
  return (
    <span ref={box} className={`block overflow-hidden whitespace-nowrap ${shift === 0 ? "text-ellipsis" : ""} ${className}`}>
      <style>{"@keyframes tgsb-mq{0%,18%{transform:translateX(0)}82%,100%{transform:translateX(var(--mq))}}@media (prefers-reduced-motion:reduce){.tgsb-mq{animation:none!important}}"}</style>
      <span ref={inner} className={`inline-block ${shift ? "tgsb-mq" : ""}`}
        style={shift ? ({ ["--mq" as string]: `-${shift}px`, animation: `tgsb-mq ${secs}s ease-in-out infinite alternate` } as React.CSSProperties) : undefined}>
        {children}
      </span>
    </span>
  );
}
