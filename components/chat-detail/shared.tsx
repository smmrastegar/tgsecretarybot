"use client";

import type { ReactNode } from "react";
import type { Tone } from "./types";

// Small building blocks shared by the sections of the per-chat page. Card content is centred (the Section
// default), controls are >= 44px, helper text is >= 12px, and action rows sit on the physical left.

export const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

export function fmtFollowUpDuration(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${fa(minutes)} دقیقه`;
  }
  return `${fa(hours)} ساعت`;
}

// Form fields keep their text start-aligned (long free-text notes read badly centred); labels stay centred.
export const inputCls =
  "w-full min-h-11! text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-start disabled:opacity-50";
export const btnCls =
  "min-h-11! px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-sm inline-flex items-center justify-center gap-1.5 active:bg-[var(--color-surface)] disabled:opacity-50";
export const btnPrimaryCls =
  "min-h-11! px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-40";
export const btnDangerCls =
  "min-h-11! px-4 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm inline-flex items-center justify-center gap-1.5 active:bg-rose-500/25 disabled:opacity-50";

const CHIP: Record<Tone, string> = {
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border-[var(--color-border)]",
  success: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  warn: "bg-amber-900/40 text-amber-300 border-amber-800",
  danger: "bg-red-900/40 text-red-300 border-red-800",
  info: "bg-blue-900/40 text-blue-300 border-blue-800",
};

// Like Badge but 12px (Badge is 11px and shared).
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs ${CHIP[tone]}`}>{children}</span>;
}

// Toggle row: label + one-line explanation + 52px switch (knob fix as in the music SettingsSheet).
export function ToggleRow({ label, hint, checked, disabled, onChange }: {
  label: ReactNode; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="w-full min-h-14! flex items-center gap-3 py-2 text-center disabled:opacity-60">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block text-sm leading-6">{label}</span>
        {hint != null && <span className="block text-xs leading-5 text-[var(--color-text-dim)]">{hint}</span>}
      </span>
      <span aria-hidden className={`shrink-0 w-[52px] h-8 rounded-full relative transition-colors ${checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"}`}>
        <span className={`absolute top-1/2 -translate-y-1/2 left-1 w-6 h-6 rounded-full shadow transition-transform duration-200 ${checked ? "translate-x-5 bg-white" : "translate-x-0 bg-[var(--color-text-dim)]"}`} />
      </span>
    </button>
  );
}

export function ToggleList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--color-border)]">{children}</div>;
}

// A labelled form field (label centred above, control full width).
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1 leading-6">{label}</span>
      {hint != null && <span className="block text-xs leading-5 text-[var(--color-text-dim)] mb-1.5">{hint}</span>}
      {children}
    </label>
  );
}

// Groups of controls inside one Section, separated by hairlines.
export function Stack({ children }: { children: ReactNode }) {
  return <div className="[&>*+*]:mt-4 [&>*+*]:pt-4 [&>*+*]:border-t [&>*+*]:border-[var(--color-border)]">{children}</div>;
}

export function SubBlock({ title, hint, children }: { title?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {title != null && <div className={`text-sm font-semibold leading-6 ${hint == null ? "mb-3" : ""}`}>{title}</div>}
      {hint != null && <p className="text-xs leading-6 text-[var(--color-text-dim)] mt-0.5 mb-3">{hint}</p>}
      {children}
    </div>
  );
}

// Buttons always sit on the physical left, whatever else is in the row.
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2 [justify-content:left]">{children}</div>;
}

export function Note({ tone = "dim", children }: { tone?: "dim" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const c = { dim: "text-[var(--color-text-dim)]", ok: "text-emerald-400", warn: "text-amber-400", bad: "text-rose-300" }[tone];
  return <div className={`text-xs leading-6 mt-2 ${c}`} role="status">{children}</div>;
}
