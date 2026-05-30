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
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 md:p-5 ${className}`}
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
      <div className="text-[10px] md:text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
        {label}
      </div>
      <div className="text-2xl md:text-3xl font-semibold mt-1.5 md:mt-2">
        {value}
      </div>
      {hint && (
        <div className="text-[11px] md:text-xs text-[var(--color-text-dim)] mt-1.5 md:mt-2">
          {hint}
        </div>
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
    <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-5 md:mb-6 gap-3 md:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-[var(--color-text-dim)] mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 md:mx-0 overflow-x-auto">
      <div className="min-w-full px-4 md:px-0">{children}</div>
    </div>
  );
}
