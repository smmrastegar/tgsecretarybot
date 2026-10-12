import type { ReactNode } from "react";

/** A list with nothing in it yet: say so, and offer the next step. Centred card, action on the left. */
export default function EmptyState({ icon = "∅", title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center">
      <div aria-hidden className="text-3xl opacity-60">{icon}</div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      {hint && <p className="mt-1 text-xs text-[var(--color-text-dim)] leading-6">{hint}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
