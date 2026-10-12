import type { ReactNode } from "react";

// Small status pill used by the overview / urgent / messages pages. Unlike Card's Badge it never drops
// below 12px, so it stays readable on a phone.
const TONE = {
  danger: "bg-rose-500/15 text-rose-300",
  warn: "bg-amber-500/15 text-amber-200",
  info: "bg-sky-500/15 text-sky-300",
  ok: "bg-emerald-500/15 text-emerald-300",
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
};

export type ChipTone = keyof typeof TONE;

export default function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}
