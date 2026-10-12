"use client";

import { useEffect, type ReactNode } from "react";

// In-page bottom sheet (full-width on phones, centred card on desktop) for the monitoring dialogs.
// Content is centred, the footer holds the buttons (they sit on the physical left), Esc / backdrop close it.
export default function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? "md:max-w-2xl" : "md:max-w-md"} max-h-[92vh] flex flex-col rounded-t-3xl md:rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl text-center min-w-0`}
      >
        <div className="flex items-start gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="text-base font-semibold leading-7 [overflow-wrap:anywhere]">{title}</h2>
            {subtitle != null && <p className="text-xs leading-6 text-[var(--color-text-dim)] mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="shrink-0 grid place-items-center w-11 h-11 rounded-xl border border-[var(--color-border)] text-[var(--color-text-dim)]"
          >
            ✕
          </button>
        </div>
        <div className="px-4 pb-4 pt-1 overflow-y-auto min-h-0 flex-1 [overflow-wrap:anywhere]">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t border-[var(--color-border)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
