"use client";

import { useState, type ReactNode } from "react";

// One collapsible panel of the music admin page: a 56 px touch row (icon, title, one-line summary,
// optional badge, chevron) that opens to its content. Collapsed by default so the page stays short.
export default function Section({ icon, title, summary, badge, defaultOpen = false, open, onOpenChange, children, className = "" }: {
  icon: ReactNode; title: string; summary?: ReactNode; badge?: ReactNode;
  defaultOpen?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void; children: ReactNode; className?: string;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const toggle = () => { const n = !isOpen; if (open === undefined) setInner(n); onOpenChange?.(n); };
  return (
    <section className={`mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden ${className}`}>
      <button type="button" data-section-toggle onClick={toggle} aria-expanded={isOpen}
        className="w-full min-h-14 flex items-center gap-3 px-4 py-2.5 text-start active:bg-[var(--color-surface-2)]">
        <span aria-hidden className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--color-surface-2)] text-lg shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {summary != null && <span className="block text-[11px] text-[var(--color-text-dim)] truncate">{summary}</span>}
        </span>
        {badge != null && <span className="shrink-0">{badge}</span>}
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-[var(--color-text-dim)] transition-transform ${isOpen ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {isOpen && <div className="px-4 pb-4 pt-3 border-t border-[var(--color-border)] min-w-0 [overflow-wrap:anywhere]">{children}</div>}
    </section>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const c = { neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]", ok: "bg-emerald-500/15 text-emerald-300", warn: "bg-amber-500/15 text-amber-200", bad: "bg-rose-500/15 text-rose-300" }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums ${c}`}>{children}</span>;
}
