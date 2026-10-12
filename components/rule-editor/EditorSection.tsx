"use client";

import { useState, type ReactNode } from "react";

// Same look as components/ui/Section.tsx (56px header: icon, title, one-line summary, badge, chevron), but the
// body stays MOUNTED while collapsed (hidden). The editor's staged example lists and half-typed drafts live in
// the children's own state, so unmounting on collapse would silently throw them away.
export default function EditorSection({ icon, title, summary, badge, defaultOpen = false, children }: {
  icon: ReactNode; title: string; summary?: ReactNode; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <button type="button" data-section-toggle onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full min-h-14 flex items-center gap-3 px-4 py-2.5 text-start active:bg-[var(--color-surface-2)]">
        <span aria-hidden className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--color-surface-2)] text-lg shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 text-center">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {summary != null && <span className="block text-xs text-[var(--color-text-dim)] truncate">{summary}</span>}
        </span>
        {badge != null && <span className="shrink-0">{badge}</span>}
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-[var(--color-text-dim)] transition-transform ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div hidden={!open} className="px-4 pb-4 pt-3 border-t border-[var(--color-border)] min-w-0 [overflow-wrap:anywhere] text-center">{children}</div>
    </section>
  );
}
