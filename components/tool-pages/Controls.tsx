"use client";

import { useState, type ReactNode } from "react";

// Small building blocks shared by the "tool" pages (emails, webhooks, code feeds, SMS block rules, link
// downloaders, secretary relays). Only those pages use this file; the generic pieces live in components/ui.

export const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Control styles: every control is >= 40 px tall and >= 14 px text (16 px on touch screens, via globals.css).
export const inputCls = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2";
export const btnPrimary = "whitespace-nowrap min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50";
export const btnGhost = "whitespace-nowrap min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
export const btnDanger = "whitespace-nowrap min-h-10 px-4 rounded-xl border border-rose-500/40 text-rose-300 text-sm active:bg-rose-500/10 hover:bg-rose-500/10 disabled:opacity-50";
export const cardCls = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center min-w-0 [overflow-wrap:anywhere]";

/** A label above a form control. Form rows are start-aligned on purpose (a centred label over a full-width input reads worse). */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-start">
      <span className="block text-xs mb-1 text-[var(--color-text-dim)]">{label}</span>
      {children}
      {hint != null && <span className="block text-xs mt-1 leading-5 text-[var(--color-text-dim)]">{hint}</span>}
    </label>
  );
}

/** A labelled on/off row (>= 44 px tall) for a boolean setting. Start-aligned like the other form rows. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 min-h-11 py-1.5 text-start cursor-pointer ${disabled ? "opacity-50" : ""}`}>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs leading-5 text-[var(--color-text-dim)]">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="relative shrink-0 w-11 h-6 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] transition-colors peer-checked:bg-emerald-500/80 peer-checked:border-transparent peer-focus-visible:ring-2 ring-[var(--color-accent)] after:content-[''] after:absolute after:top-0.5 after:start-0.5 after:w-4.5 after:h-4.5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5" />
    </label>
  );
}

/** Tab-like segmented choice; each segment is a full-width-ish 44 px button. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }> }) {
  return (
    <div role="tablist" className="flex gap-1 p-1 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className={`flex-1 min-h-10 px-3 rounded-xl text-sm font-medium transition-colors ${value === o.id ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-dim)]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LoadingBox({ text = "در حال بارگذاری…" }: { text?: string }) {
  return <div className="rounded-2xl border border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-dim)]">{text}</div>;
}

/** Loading failed: say so and offer "تلاش دوباره". */
export function ErrorBox({ text = "بارگذاری ناموفق بود.", onRetry }: { text?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-6 text-center">
      <div className="text-sm text-rose-200 leading-6">{text}</div>
      <div className="mt-3 flex justify-center"><button type="button" onClick={onRetry} className={btnGhost}>تلاش دوباره</button></div>
    </div>
  );
}

/** Centred one-line summary under the page title: counts as soft pills. */
export function SummaryBar({ items }: { items: Array<{ text: string; tone?: "neutral" | "ok" | "warn" | "bad" }> }) {
  const tone = { neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]", ok: "bg-emerald-500/15 text-emerald-300", warn: "bg-amber-500/15 text-amber-200", bad: "bg-rose-500/15 text-rose-300" };
  return (
    <div className="mb-4 flex flex-wrap justify-center gap-2">
      {items.map((i) => <span key={i.text} className={`px-3 py-1 rounded-full text-xs font-medium ${tone[i.tone ?? "neutral"]}`}>{i.text}</span>)}
    </div>
  );
}

// navigator.clipboard is undefined on http:// origins and in some in-app browsers, so fall back to the
// textarea trick rather than silently doing nothing when the user taps copy.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Copy button that flips to "✓" for a moment. `primary` makes it the card's main action. */
export function CopyBtn({ value, label, doneLabel = "✓ کپی شد", primary = false, disabled = false, className = "" }: { value: string; label: string; doneLabel?: string; primary?: boolean; disabled?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" disabled={disabled}
      onClick={async () => { if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1600); } }}
      className={`${done ? "min-h-10 px-4 rounded-xl border border-emerald-600 text-emerald-300 bg-emerald-900/30 text-sm" : primary ? `${btnPrimary} min-h-10` : btnGhost} ${className}`}>
      {done ? doneLabel : label}
    </button>
  );
}

/** A one-line, LTR, truncated box for a URL/token. Selecting it selects the whole value. */
export function UrlBox({ value }: { value: string }) {
  return <code dir="ltr" className="block min-w-0 truncate select-all text-xs text-start rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5">{value || "…"}</code>;
}
