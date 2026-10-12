"use client";

import { useEffect, useState } from "react";
import Section from "@/components/ui/Section";
import { Field, ToggleRow } from "@/components/chat-detail/shared";
import Sheet from "./Sheet";
import {
  BTN,
  BTN_AMBER,
  BTN_OK,
  BTN_PRIMARY,
  FIELD,
  Usd,
  fa,
  type Bucket,
  type BudgetState,
  type HikerCall,
  type Summary,
} from "./shared";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fa-IR");
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("fa-IR");

// A row of bars (one per bucket), tallest = max cost of the series.
function Bars({
  title,
  buckets,
  color,
  gap,
  label,
}: {
  title: string;
  buckets: Bucket[];
  color: string;
  gap: string;
  label: (b: Bucket) => string;
}) {
  const max = Math.max(0.001, ...buckets.map((b) => b.costUsd));
  return (
    <div>
      <div className="text-sm font-medium mb-2">{title}</div>
      {buckets.length === 0 ? (
        <p className="text-xs text-[var(--color-text-dim)]">هنوز callی ثبت نشده</p>
      ) : (
        <>
          <div className={`flex items-end ${gap} h-20`} dir="ltr">
            {buckets.map((b) => (
              <div
                key={b.at}
                title={`${label(b)} · ${b.calls} call · $${b.costUsd.toFixed(4)}`}
                className={`flex-1 ${color} rounded-t-sm min-h-[2px]`}
                style={{ height: `${Math.max(4, (b.costUsd / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-dim)]">
            بیشینه: <Usd v={max} d={4} />
          </div>
        </>
      )}
    </div>
  );
}

// Budget settings: cap / step / fallback cost per call, the exact spend table, projections, charts and the
// latest HikerAPI calls. The save logic is unchanged from the old dialog.
export default function BudgetSettingsSheet(props: {
  budget: BudgetState;
  summary: Summary | null;
  hourly: Bucket[];
  daily: Bucket[];
  weekly: Bucket[];
  monthly: Bucket[];
  recent: HikerCall[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onApproveAbsolute: (v: number) => Promise<void>;
}) {
  const { budget, summary, hourly, daily, weekly, monthly, recent, onClose, onSaved, onApproveAbsolute } = props;
  const [budgetUsd, setBudgetUsd] = useState(String(budget.budgetUsd));
  const [stepUsd, setStepUsd] = useState(String(budget.stepUsd));
  const [costPerCallUsd, setCostPerCallUsd] = useState(String(budget.costPerCallUsd));
  const [optimize, setOptimize] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/settings");
      if (r.ok) {
        const j = (await r.json()) as {
          values?: Record<string, string>;
        };
        const v = j.values?.hikerOptimizeChangeDetection;
        if (v != null) {
          setOptimize(v.toLowerCase() !== "false");
        }
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      // budget + step are per-tenant now (Commit 2 moved them out of
      // global settings into the tenants table). Route them through
      // the approve endpoint, which already knows how to write them.
      const budgetNum = Number(budgetUsd);
      const stepNum = Number(stepUsd);
      if (Number.isFinite(budgetNum) || Number.isFinite(stepNum)) {
        await fetch("/api/monitored/budget/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            budgetUsd: Number.isFinite(budgetNum) ? budgetNum : undefined,
            stepUsd: Number.isFinite(stepNum) ? stepNum : undefined,
            // Don't bump approved — just adjust caps + step. Pass
            // current approved through unchanged.
            approvedUsd: budget.approvedUsd,
          }),
        });
      }
      // cost per call + optimize toggle are still global estimates,
      // shared across tenants.
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hikerCostPerCallUsd: costPerCallUsd,
          hikerOptimizeChangeDetection: String(optimize),
        }),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  // Projections from observed rates: extrapolate the 24h spend out to
  // a month, and the 7-day spend out to a month, so the owner can
  // eyeball "at this rate how long does \$50 last".
  const projDailyToMonth = summary ? summary.today.costUsd * 30 : null;
  const projWeeklyToMonth = summary ? (summary.last7d.costUsd / 7) * 30 : null;
  const daysToBudget = (() => {
    if (!summary || !budget) return null;
    const ratePerDay = summary.last7d.costUsd / 7;
    if (ratePerDay <= 0) return null;
    const remaining = budget.budgetUsd - budget.spentUsd;
    if (remaining <= 0) return 0;
    return remaining / ratePerDay;
  })();

  return (
    <Sheet
      wide
      title="⚙️ تنظیمات بودجه HikerAPI"
      subtitle="HikerAPI خودش $ نشون نمی‌ده — ما هر call رو با هزینه تخمینی محلی جمع می‌زنیم. سقف کل + هر چند $ یه‌بار از تو می‌پرسه ادامه بدیم یا نه."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY}>
            {saving ? "ذخیره…" : "💾 ذخیره"}
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            بستن
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="سقف کلی ($)">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={budgetUsd}
              onChange={(e) => setBudgetUsd(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="فاصله‌ی تایید ($)">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={stepUsd}
              onChange={(e) => setStepUsd(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="هزینه fallback / call ($)">
            <input
              type="number"
              inputMode="decimal"
              step="0.0001"
              value={costPerCallUsd}
              onChange={(e) => setCostPerCallUsd(e.target.value)}
              className={FIELD}
            />
          </Field>
        </div>

        <ToggleRow
          label="🎯 optimize تشخیص"
          hint="قبل از fetch پست‌ها، فقط user-info ارزون می‌گیره (~$0.001). اگه media_count عوض نشده، fetch پست/ریلز/منشن رو اصلاً نمی‌زنه. (ذخیره‌ی ۷۵-۹۰٪)"
          checked={optimize}
          onChange={setOptimize}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onApproveAbsolute(Number(budgetUsd))}
            className={BTN_OK}
            title="تا سقف کلی auto-approve کن"
          >
            ✅ تایید کل سقف
          </button>
          <button
            type="button"
            onClick={() => onApproveAbsolute(budget.spentUsd)}
            className={BTN_AMBER}
            title="مجاز رو به همین خرج فعلی برگردون = pause فوری"
          >
            ⏸ pause الان
          </button>
        </div>

        {summary && (
          <Section icon="📊" title="خلاصه دقیق" summary="هزینه و تعداد call به تفکیک بازه" className="!mb-0">
            <div className="flex flex-col gap-2">
              {(
                [
                  ["⏰ ۱ ساعت اخیر", summary.lastHour],
                  ["📅 ۲۴ ساعت اخیر", summary.today],
                  ["🗓 ۷ روز اخیر", summary.last7d],
                  ["🗓 ۳۰ روز اخیر", summary.last30d],
                  ["Σ همه‌ی زمان", summary.allTime],
                ] as const
              ).map(([label, w]) => (
                <div
                  key={label}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2 flex items-center justify-between gap-3"
                >
                  {/* tabular row: label + counts at the start, the amount at the end */}
                  <div className="min-w-0 text-start">
                    <div className="text-sm">{label}</div>
                    <div className="text-xs text-[var(--color-text-dim)] tabular-nums">
                      {fa(w.calls.toLocaleString("en"))} call · میانگین{" "}
                      {w.calls > 0 ? <Usd v={w.costUsd / w.calls} d={5} /> : "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold">
                    <Usd v={w.costUsd} d={4} />
                  </div>
                </div>
              ))}
              {(projDailyToMonth != null || projWeeklyToMonth != null) && (
                <div className="mt-1 pt-2 border-t border-[var(--color-border)] text-xs leading-6 text-[var(--color-text-dim)] flex flex-col gap-1">
                  <div>
                    📈 پیش‌بینی ماهانه (با نرخ ۲۴ ساعت اخیر):{" "}
                    <strong className="text-[var(--color-text)]">
                      <Usd v={projDailyToMonth ?? 0} />
                    </strong>
                  </div>
                  <div>
                    📈 پیش‌بینی ماهانه (با نرخ ۷ روز اخیر):{" "}
                    <strong className="text-[var(--color-text)]">
                      <Usd v={projWeeklyToMonth ?? 0} />
                    </strong>
                  </div>
                  {daysToBudget != null && Number.isFinite(daysToBudget) && (
                    <div>
                      ⏳ با این نرخ، باقیمانده‌ی <Usd v={budget.budgetUsd - budget.spentUsd} /> کافیه برای{" "}
                      <strong className="text-[var(--color-text)]">
                        {daysToBudget < 1
                          ? `${fa(Math.round(daysToBudget * 24))} ساعت`
                          : daysToBudget > 365
                            ? "بیش از یک سال"
                            : `${fa(Math.round(daysToBudget))} روز`}
                      </strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        <Section icon="📉" title="نمودار هزینه" summary="ساعتی · روزانه · هفتگی · ماهانه" className="!mb-0">
          <div className="flex flex-col gap-5">
            <Bars
              title="⏰ ساعتی (۲۴ ساعت اخیر)"
              buckets={hourly}
              color="bg-[var(--color-accent)]/70"
              gap="gap-0.5"
              label={(b) => fmtDateTime(b.at)}
            />
            <Bars
              title="📅 روزانه (۱۴ روز اخیر)"
              buckets={daily}
              color="bg-[var(--color-accent)]/70"
              gap="gap-1"
              label={(b) => fmtDate(b.at)}
            />
            <Bars
              title="🗓 هفتگی (۱۲ هفته اخیر)"
              buckets={weekly}
              color="bg-emerald-600/70"
              gap="gap-1"
              label={(b) => `هفته‌ی ${fmtDate(b.at)}`}
            />
            <Bars
              title="🗓 ماهانه (۶ ماه اخیر)"
              buckets={monthly}
              color="bg-amber-500/70"
              gap="gap-1.5"
              label={(b) => fmtDate(b.at)}
            />
          </div>
        </Section>

        <Section icon="📜" title="آخرین call‌ها" summary="۲۰ مورد آخر" className="!mb-0">
          {recent.length === 0 ? (
            <p className="text-xs text-[var(--color-text-dim)]">خالی</p>
          ) : (
            <div className="max-h-72 overflow-y-auto flex flex-col gap-2">
              {recent.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-[var(--color-border)] px-3 py-2 flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div dir="ltr" className="text-xs font-mono truncate">
                      {c.endpoint}
                    </div>
                    <div className="text-xs text-[var(--color-text-dim)]">{fmtDateTime(c.calledAt)}</div>
                  </div>
                  <div className="shrink-0 text-xs text-[var(--color-text-dim)]">
                    <Usd v={c.costUsd} d={4} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Sheet>
  );
}
