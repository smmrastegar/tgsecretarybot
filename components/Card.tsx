import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
        {label}
      </div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
      {hint && (
        <div className="text-xs text-[var(--color-text-dim)] mt-2">{hint}</div>
      )}
    </Card>
  );
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-[var(--color-text-dim)] mt-1">{subtitle}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warn" | "danger" | "info";
}) {
  const toneClass = {
    neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
    success: "bg-emerald-900/40 text-emerald-300 border border-emerald-800",
    warn: "bg-amber-900/40 text-amber-300 border border-amber-800",
    danger: "bg-red-900/40 text-red-300 border border-red-800",
    info: "bg-blue-900/40 text-blue-300 border border-blue-800",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}
