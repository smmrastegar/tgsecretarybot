import type { ReactNode } from "react";

// Types, constants and small UI tokens shared by the rule editor (app/rules/[id]) pieces.

export type Rule = {
  id: number;
  name: string;
  description: string;
  forwardFormat: string | null;
  forwardHeader: string | null;
  requestTrigger: string | null;
  requestWindowSeconds: number | null;
  sourceChatIds: number[] | null;
  excludeSourceChatIds: number[] | null;
  sourceThreadIds: number[] | null;
  matchPattern: string | null;
  matchAllFromSource: boolean;
  showRulePrefix: boolean;
  formatAsOtp: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Recipient = {
  ruleId: number;
  recipientChatId: number;
  recipientLabel: string | null;
  paused: boolean;
  createdAt: string;
};

export type Example = {
  id: number;
  text: string;
  label: string | null;
  purpose?: "rule_match" | "gate_match";
  createdAt: string;
};

export type Match = {
  id: number;
  ruleId: number;
  messageLogId: number;
  formattedText: string | null;
  forwardedTo: number[];
  forwardErrors: Record<string, string> | null;
  matchedAt: string;
  messageText: string;
  senderName: string;
  chatId: number;
};

export type TestResult = {
  messageLogId: number;
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  originalText: string;
  matched: boolean;
  formattedText: string | null;
  createdAt: string;
};

export const WINDOW_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "⚠️ بدون gate — ارسال فوری" },
  { value: 60, label: "۱ دقیقه" },
  { value: 120, label: "۲ دقیقه" },
  { value: 300, label: "۵ دقیقه" },
  { value: 3600, label: "۱ ساعت" },
];

export const HEADER_VARS: Array<{ token: string; label: string }> = [
  { token: "{sender}", label: "نام فرستنده — مثلاً نام باتی که پیام رو فرستاده" },
  { token: "{chat}", label: "نام چت مبدأ" },
  { token: "{rule}", label: "نام همین قانون" },
  { token: "{date}", label: "تاریخ" },
  { token: "{time}", label: "ساعت" },
  { token: "{dest}", label: "نام مقصد — برچسبِ گیرنده" },
];

export const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

/** "۵ دقیقه‌ای" / "۱ ساعته" for the gate window. */
export const windowLabel = (sec: number) => (sec === 3600 ? "۱ ساعته" : `${fa(Math.round(sec / 60))} دقیقه‌ای`);

// Form controls. Fields are text-start on purpose: typed text (Persian / English / ids) reads wrongly when centred.
export const inputCls = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 disabled:opacity-50";
export const btnPrimary = "min-h-11 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50";
export const btnGhost = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-50";
export const btnAmber = "min-h-11 px-4 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-sm hover:bg-amber-500/20 disabled:opacity-50";
export const btnDanger = "min-h-11 px-4 rounded-xl border border-red-700 text-red-300 text-sm hover:bg-red-900/30 disabled:opacity-50";

/** A labelled form field: centred title + hint, full-width control below. */
export function Field({ label, hint, children }: { label?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {label && <div className="text-sm font-medium">{label}</div>}
      {hint && <p className="text-xs text-[var(--color-text-dim)] leading-6">{hint}</p>}
      {children}
    </div>
  );
}

/** A checkbox row with a 44px touch target. */
export function CheckRow({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={`flex items-start gap-3 min-h-11 py-1 text-xs leading-6 cursor-pointer text-start ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="mt-1.5 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/** A 12px status chip (the shared Badge is 11px). */
export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  const c = {
    neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
    ok: "bg-emerald-500/15 text-emerald-300",
    warn: "bg-amber-500/15 text-amber-200",
    bad: "bg-rose-500/15 text-rose-300",
    info: "bg-sky-500/15 text-sky-300",
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium tabular-nums ${c}`}>{children}</span>;
}

/** A status / result line (green, red or neutral) that wraps long text. */
export function Note({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "bad" | "warn"; children: ReactNode }) {
  const c = {
    neutral: "bg-[var(--color-surface-2)] text-[var(--color-text)]",
    ok: "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200",
    bad: "bg-rose-500/10 border border-rose-500/30 text-rose-200",
    warn: "bg-amber-500/10 border border-amber-500/30 text-amber-200",
  }[tone];
  return <div className={`text-xs leading-6 p-3 rounded-xl whitespace-pre-line [overflow-wrap:anywhere] ${c}`}>{children}</div>;
}
