"use client";

import Section, { Pill } from "@/components/ui/Section";
import { BTN, BTN_AMBER, BTN_OK, Tile, Usd, fa, type BudgetState, type Summary } from "./shared";

// The logical HikerAPI budget: spent / approved / cap, quick "approve more" buttons and the window summary.
export default function BudgetSection({
  budget,
  summary,
  loading,
  failed,
  approving,
  open,
  onOpenChange,
  onSettings,
  onRefresh,
  onApprove,
}: {
  budget: BudgetState | null;
  summary: Summary | null;
  loading: boolean;
  failed: boolean;
  approving: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSettings: () => void;
  onRefresh: () => void;
  onApprove: (opts?: { absolute?: number; extendBudget?: boolean; budgetUsd?: number }) => void;
}) {
  const title = budget?.budgetExceeded
    ? "سقف بودجه HikerAPI تمام شد"
    : budget?.needsApproval
      ? "نیاز به تایید برای ادامه‌ی هزینه"
      : "بودجه HikerAPI (لاجیکال)";
  const flagged = Boolean(budget?.budgetExceeded || budget?.needsApproval);

  // Quick multi-step jumps: targets in multiples of step from the current approved amount up to the cap.
  const jumps: number[] = [];
  if (budget) {
    for (let n = 2; n <= 5 && budget.approvedUsd + budget.stepUsd * n <= budget.budgetUsd + 0.0001; n++) {
      jumps.push(n);
    }
  }

  return (
    <Section
      icon={budget?.budgetExceeded ? "🛑" : budget?.needsApproval ? "⏸" : "💵"}
      title={title}
      summary={
        budget ? (
          <>
            خرج‌شده <Usd v={budget.spentUsd} /> از <Usd v={budget.budgetUsd} />
          </>
        ) : failed ? (
          "خطا در دریافت بودجه"
        ) : (
          "در حال بارگذاری…"
        )
      }
      badge={flagged || failed ? <Pill tone={budget?.budgetExceeded || failed ? "bad" : "warn"}>!</Pill> : undefined}
      open={open}
      onOpenChange={onOpenChange}
      className="!mb-0"
    >
      {budget ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="خرج‌شده">
              <Usd v={budget.spentUsd} d={2} />
            </Tile>
            <Tile label="مجاز تا">
              <Usd v={budget.approvedUsd} />
            </Tile>
            <Tile label="سقف کلی">
              <Usd v={budget.budgetUsd} />
            </Tile>
          </div>
          <div className="text-xs text-[var(--color-text-dim)]">
            checkpoint هر <Usd v={budget.stepUsd} />
          </div>

          <div className="h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden relative" dir="ltr">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-600/60"
              style={{ width: `${Math.min(100, (budget.approvedUsd / budget.budgetUsd) * 100)}%` }}
              title={`مجاز: $${budget.approvedUsd.toFixed(2)}`}
            />
            <div
              className={`absolute inset-y-0 left-0 ${
                budget.budgetExceeded
                  ? "bg-red-500"
                  : budget.needsApproval
                    ? "bg-amber-500"
                    : "bg-[var(--color-accent)]"
              }`}
              style={{ width: `${Math.min(100, (budget.spentUsd / budget.budgetUsd) * 100)}%` }}
              title={`خرج: $${budget.spentUsd.toFixed(2)}`}
            />
          </div>

          {(budget.needsApproval || budget.budgetExceeded) && (
            <p className="text-xs leading-6 text-amber-200">
              {budget.budgetExceeded
                ? `سقف کل $${fa(budget.budgetUsd.toFixed(2))} پر شد. cron متوقفه — با دکمه «+$${fa(budget.stepUsd.toFixed(0))} + سقف» یه slice دیگه باز کن.`
                : `خرج رسید به سقف مجاز $${fa(budget.approvedUsd.toFixed(2))}. تا تخصیص ندی، cron و refresh ۴۰۲ می‌گیرن.`}
            </p>
          )}

          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  ["⏰ ساعت اخیر", summary.lastHour],
                  ["📅 ۲۴ ساعت", summary.today],
                  ["🗓 ۷ روز", summary.last7d],
                  ["🗓 ۳۰ روز", summary.last30d],
                  ["Σ کل", summary.allTime],
                ] as const
              ).map(([label, w], i) => (
                <div
                  key={label}
                  className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-2 py-2 min-w-0 ${
                    i === 4 ? "col-span-2 sm:col-span-1" : ""
                  }`}
                >
                  <div className="text-xs text-[var(--color-text-dim)] truncate">{label}</div>
                  <div className="text-sm font-semibold">
                    <Usd v={w.costUsd} d={4} />
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] tabular-nums">
                    {fa(w.calls.toLocaleString("en"))} call
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-dim)] mb-2">⚡ تخصیص پیش‌فرض</div>
            <div className="grid grid-cols-2 gap-2">
              {/* Single +step button — always available, even before spend hits the cap, so the owner can
                  pre-allocate. */}
              <button
                type="button"
                onClick={() => onApprove()}
                disabled={approving || budget.approvedUsd + 0.0001 >= budget.budgetUsd}
                className={`${BTN_OK} col-span-2`}
                title={`الان مجاز تا $${budget.approvedUsd.toFixed(2)} — بزن می‌ره +$${budget.stepUsd.toFixed(2)}`}
              >
                + <Usd v={budget.stepUsd} /> تخصیص
              </button>
              {jumps.map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() =>
                    onApprove({
                      absolute: Math.min(budget.budgetUsd, budget.approvedUsd + budget.stepUsd * n),
                    })
                  }
                  disabled={approving}
                  className={BTN}
                  title={`بپر تا $${(budget.approvedUsd + budget.stepUsd * n).toFixed(2)}`}
                >
                  +{fa(n)}×
                </button>
              ))}
              {budget.approvedUsd + 0.0001 < budget.budgetUsd && (
                <button
                  type="button"
                  onClick={() => onApprove({ absolute: budget.budgetUsd })}
                  disabled={approving}
                  className={BTN}
                  title={`تا سقف کل $${budget.budgetUsd.toFixed(2)}`}
                >
                  ⬆ سقف
                </button>
              )}
              {/* Extend cap by step and approve it in one click — rolls $50 → $60 → $70 … without leaving
                  the page. */}
              <button
                type="button"
                onClick={() =>
                  onApprove({
                    extendBudget: true,
                    absolute: budget.budgetUsd + budget.stepUsd,
                  })
                }
                disabled={approving}
                className={`${BTN_AMBER} col-span-2`}
                title={`سقف رو $${budget.stepUsd.toFixed(2)} بالا ببر + تخصیص رو هم تا اونجا ببر`}
              >
                🔓 +<Usd v={budget.stepUsd} /> + سقف
              </button>
            </div>
          </div>
        </div>
      ) : failed ? (
        <p className="text-sm text-red-300">خطا در دریافت بودجه.</p>
      ) : (
        <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 [justify-content:left]">
        <button type="button" onClick={onSettings} disabled={!budget} className={BTN}>
          ⚙️ تنظیمات
        </button>
        <button type="button" onClick={onRefresh} disabled={loading} className={failed ? BTN_AMBER : BTN}>
          {loading ? "…" : failed ? "تلاش دوباره" : "🔄 بروزرسانی"}
        </button>
      </div>
    </Section>
  );
}
