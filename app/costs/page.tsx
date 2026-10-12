"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, StatCard, Badge } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";

type Overview = {
  totalCostUsd: number;
  totalTokens: number;
  totalCalls: number;
  last24hCostUsd: number;
};

type BudgetState = {
  spentUsd: number;
  approvedUsd: number;
  budgetUsd: number;
  stepUsd: number;
  needsApproval: boolean;
  budgetExceeded: boolean;
  nextThresholdUsd: number;
  tenantId: number | null;
  tenantName: string | null;
};
type Credits = {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
  fetchedAt: string;
};
type Row = {
  purpose?: string;
  model?: string;
  calls: number;
  totalCostUsd: number;
  totalTokens: number;
};
type DayRow = { day: string; totalCostUsd: number; calls: number };

const PURPOSE_LABEL: Record<string, string> = {
  classify: "دسته‌بندی (تشخیص فوریت)",
  summary: "خلاصه‌ی گروه‌ها",
  ai_chat: "پاسخ‌های چت AI",
  friendly_reply: "پاسخ خودکار دوستانه",
  transcribe: "رونویسی صدا",
  describe_media: "توضیح عکس / گیف / استیکر",
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
// Money keeps Latin digits (it is a $ amount) but is isolated so it does not scramble inside Persian text.
const usd = (n: number, d = 2) => <bdi dir="ltr">${n.toFixed(d)}</bdi>;

// Controls are >= 40 px tall; fields 44 px.
const btn = "min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-40";
const btnPrimary = "min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50";
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2 tabular-nums";

export default function CostsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [byPurpose, setByPurpose] = useState<Row[]>([]);
  const [byModel, setByModel] = useState<Row[]>([]);
  const [byDay, setByDay] = useState<DayRow[]>([]);
  const [predictN, setPredictN] = useState(1000);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [creditsError, setCreditsError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/ai-usage?days=${days}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        overview: Overview | null;
        byPurpose: Row[];
        byModel: Row[];
        byDay: DayRow[];
      };
      setOverview(j.overview);
      setByPurpose(j.byPurpose);
      setByModel(j.byModel);
      setByDay(j.byDay);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  const loadBudget = useCallback(async () => {
    try {
      const r = await fetch("/api/openrouter/budget");
      if (!r.ok) return;
      const j = (await r.json()) as {
        state: BudgetState;
        credits: Credits | null;
        creditsError: string | null;
      };
      setBudget(j.state);
      setCredits(j.credits);
      setCreditsError(j.creditsError);
    } catch {}
  }, []);

  const approveNext = useCallback(
    async (opts?: {
      absolute?: number;
      budgetUsd?: number;
      stepUsd?: number;
      extendBudget?: boolean;
    }) => {
      setApproving(true);
      try {
        const body: Record<string, unknown> = {};
        if (opts?.absolute != null) body.approvedUsd = opts.absolute;
        if (opts?.budgetUsd != null) body.budgetUsd = opts.budgetUsd;
        if (opts?.stepUsd != null) body.stepUsd = opts.stepUsd;
        if (opts?.extendBudget) body.extendBudget = true;
        const r = await fetch("/api/openrouter/budget/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (r.ok) {
          const j = (await r.json()) as { state: BudgetState };
          setBudget(j.state);
        }
      } finally {
        setApproving(false);
      }
    },
    [],
  );

  const [budgetDialog, setBudgetDialog] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  const totalCalls = byPurpose.reduce((s, r) => s + r.calls, 0);
  const totalCost = byPurpose.reduce((s, r) => s + r.totalCostUsd, 0);
  const avgCostPerCall = totalCalls > 0 ? totalCost / totalCalls : 0;

  // Per-purpose average (per call). For prediction we assume a sender's
  // message roughly causes one classify call; secretary forwards/AI replies
  // ratio comes from observed counts.
  const classifyRow = byPurpose.find((r) => r.purpose === "classify");
  const aiRow = byPurpose.find((r) => r.purpose === "ai_chat");
  const avgClassify = classifyRow && classifyRow.calls > 0
    ? classifyRow.totalCostUsd / classifyRow.calls
    : 0;
  const avgAi = aiRow && aiRow.calls > 0
    ? aiRow.totalCostUsd / aiRow.calls
    : 0;
  const aiRatio =
    totalCalls > 0 ? (aiRow?.calls ?? 0) / totalCalls : 0;

  const predictedCost = predictN * avgClassify + predictN * aiRatio * avgAi;

  const maxDayCost = byDay.reduce((m, d) => Math.max(m, d.totalCostUsd), 0.0001);

  // One row of a ranked list: name + call count in the middle, cost at the end.
  const listRow = (key: string, name: ReactNode, calls: number, cost: number, ltr = false) => (
    <div key={key} className="flex items-center gap-3 min-h-14 px-4 py-2 border-t first:border-t-0 border-[var(--color-border)]">
      <div className="min-w-0 flex-1 text-center">
        <div dir={ltr ? "ltr" : undefined} className="text-sm [overflow-wrap:anywhere]">{name}</div>
        <div className="text-xs text-[var(--color-text-dim)]">{fa(calls)} call</div>
      </div>
      <div className="shrink-0 text-sm font-semibold tabular-nums">{usd(cost, 4)}</div>
    </div>
  );

  return (
    <Shell>
      <PageTitle
        title="هزینه‌های AI"
        subtitle="خرج OpenRouter / Groq کجا می‌ره."
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="بازه‌ی زمانی"
            className="min-h-11 px-3 rounded-xl text-sm border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <option value={7}>۷ روز اخیر</option>
            <option value={30}>۳۰ روز اخیر</option>
            <option value={90}>۹۰ روز اخیر</option>
          </select>
        }
      />

      {error && (
        <Card className="mb-4 !border-red-800 !bg-red-900/20">
          <p className="text-sm text-red-200">بارگذاری هزینه‌ها ناموفق بود ({error})</p>
          <button onClick={load} className={`${btn} mt-3`}>تلاش دوباره</button>
        </Card>
      )}
      {loading && !overview && !error && <Card className="mb-4">بارگذاری…</Card>}

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
          <StatCard
            label="هزینه کل"
            value={`$${overview.totalCostUsd.toFixed(4)}`}
            hint={`${fa(overview.totalCalls)} call در کل`}
          />
          <StatCard
            label="۲۴ ساعت اخیر"
            value={`$${overview.last24hCostUsd.toFixed(4)}`}
          />
          <StatCard
            label="میانگین / call"
            value={`$${avgCostPerCall.toFixed(5)}`}
          />
          <StatCard
            label="توکن (بازه)"
            value={`${fa((byPurpose.reduce((s, r) => s + r.totalTokens, 0) / 1000).toFixed(1))}k`}
          />
        </div>
      )}

      {budget && (
        <Card
          className={`mb-4 ${
            budget.budgetExceeded
              ? "!border-red-700 !bg-red-900/20"
              : budget.needsApproval
                ? "!border-amber-600 !bg-amber-900/20"
                : ""
          }`}
        >
          <div className="text-sm font-semibold leading-6">
            {budget.budgetExceeded
              ? "🛑 سقف بودجه OpenRouter تمام شد"
              : budget.needsApproval
                ? "⏸ نیاز به تایید برای ادامه‌ی هزینه"
                : "💳 بودجه OpenRouter"}
          </div>
          {budget.tenantName && (
            <div className="text-xs text-[var(--color-text-dim)]">tenant: {budget.tenantName}</div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-3 mb-2">
            <div>
              <div className="text-xs text-[var(--color-text-dim)]">خرج‌شده</div>
              <div className="text-sm font-semibold tabular-nums">{usd(budget.spentUsd, 4)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-dim)]">مجاز تا</div>
              <div className="text-sm font-semibold tabular-nums">{usd(budget.approvedUsd)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-dim)]">سقف کلی</div>
              <div className="text-sm font-semibold tabular-nums">{usd(budget.budgetUsd)}</div>
            </div>
          </div>
          {/* Two-tier progress bar: approved layer (green) + spent layer
              (accent/amber/red depending on state). */}
          <div className="h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden relative mb-2">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-600/60"
              style={{
                width: `${Math.min(
                  100,
                  (budget.approvedUsd / Math.max(budget.budgetUsd, 0.01)) * 100,
                )}%`,
              }}
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
              style={{
                width: `${Math.min(
                  100,
                  (budget.spentUsd / Math.max(budget.budgetUsd, 0.01)) * 100,
                )}%`,
              }}
              title={`خرج: $${budget.spentUsd.toFixed(2)}`}
            />
          </div>
          <div className="text-xs leading-6 text-[var(--color-text-dim)]">
            step {usd(budget.stepUsd)}
            {credits && (
              <>
                {" · "}موجودی واقعی OpenRouter:{" "}
                <strong className="text-emerald-300">{usd(credits.remaining)}</strong>
              </>
            )}
            {creditsError && !credits && (
              <span className="text-red-300"> ({creditsError.slice(0, 40)})</span>
            )}
          </div>
          {(budget.needsApproval || budget.budgetExceeded) && (
            <div className="text-xs leading-6 text-amber-200 mt-2">
              {budget.budgetExceeded
                ? `سقف کل $${budget.budgetUsd.toFixed(2)} پر شد. AI call‌ها قفلن — با دکمه «🔓 +$${budget.stepUsd.toFixed(2)} + سقف» یه slice دیگه باز کن.`
                : `خرج رسید به سقف مجاز $${budget.approvedUsd.toFixed(2)}. تا تخصیص ندی، call‌ها bunda می‌شن.`}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-dim)] mb-2">⚡ تخصیص</div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Always-available +step button. */}
              <button
                onClick={() => approveNext()}
                disabled={
                  approving ||
                  budget.approvedUsd + 0.0001 >= budget.budgetUsd
                }
                className="min-h-11 px-4 rounded-xl border border-emerald-700 bg-emerald-500/10 text-emerald-300 text-sm font-medium hover:bg-emerald-900/30 disabled:opacity-40"
                title={`الان مجاز تا $${budget.approvedUsd.toFixed(2)} — بزن می‌ره +$${budget.stepUsd.toFixed(2)}`}
              >
                + ${budget.stepUsd.toFixed(2)} تخصیص
              </button>
              {/* Multi-step jumps up to cap. */}
              {(() => {
                const jumps: number[] = [];
                for (
                  let n = 2;
                  n <= 5 &&
                  budget.approvedUsd + budget.stepUsd * n <= budget.budgetUsd + 0.0001;
                  n++
                ) {
                  jumps.push(n);
                }
                return jumps.map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      approveNext({
                        absolute: Math.min(
                          budget.budgetUsd,
                          budget.approvedUsd + budget.stepUsd * n,
                        ),
                      })
                    }
                    disabled={approving}
                    className={`${btn} text-[var(--color-text-dim)]`}
                    title={`بپر تا $${(budget.approvedUsd + budget.stepUsd * n).toFixed(2)}`}
                  >
                    +{fa(n)}×
                  </button>
                ));
              })()}
              {/* Jump straight to cap. */}
              {budget.approvedUsd + 0.0001 < budget.budgetUsd && (
                <button
                  onClick={() => approveNext({ absolute: budget.budgetUsd })}
                  disabled={approving}
                  className={`${btn} text-[var(--color-text-dim)]`}
                  title={`تا سقف کل $${budget.budgetUsd.toFixed(2)}`}
                >
                  ⬆ سقف
                </button>
              )}
              {/* Extend cap by step + approve to there. */}
              <button
                onClick={() =>
                  approveNext({
                    extendBudget: true,
                    absolute: budget.budgetUsd + budget.stepUsd,
                  })
                }
                disabled={approving}
                className="min-h-11 px-4 rounded-xl border border-amber-600 bg-amber-500/15 text-amber-200 text-sm hover:bg-amber-500/30 disabled:opacity-40"
                title={`سقف رو $${budget.stepUsd.toFixed(2)} بالا ببر + تخصیص رو هم تا اونجا ببر`}
              >
                🔓 +${budget.stepUsd.toFixed(2)} + سقف
              </button>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setBudgetDialog(true)} className={btn}>
              ⚙️ تنظیمات
            </button>
            <button onClick={loadBudget} className={btn} aria-label="بارگذاری دوباره‌ی بودجه">
              🔄
            </button>
          </div>
        </Card>
      )}

      {budgetDialog && budget && (
        <OpenrouterBudgetDialog
          budget={budget}
          onClose={() => setBudgetDialog(false)}
          onSave={async (cap, step) => {
            await approveNext({
              budgetUsd: cap,
              stepUsd: step,
              absolute: budget.approvedUsd,
            });
            setBudgetDialog(false);
          }}
        />
      )}

      {!error && (
        <>
          <Section icon="🔮" title="پیش‌بینی هزینه" summary={`${fa(predictN)} پیام ← تخمین $${predictedCost.toFixed(4)}`}>
            <label className="block text-sm mb-2" htmlFor="predict-n">اگه این‌قدر پیام ورودی دیگه بیاد:</label>
            <input
              id="predict-n"
              type="number"
              min={1}
              max={1_000_000}
              dir="ltr"
              value={predictN}
              onChange={(e) =>
                setPredictN(Math.max(1, Number(e.target.value) || 0))
              }
              className={`${field} text-center`}
            />
            <div className="mt-3">
              <Badge tone="info">
                تخمین {usd(predictedCost, 4)}
              </Badge>
            </div>
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mt-3">
              از میانگین هر call در بازه‌ی انتخاب‌شده استفاده می‌کنه (هزینه‌ی
              دسته‌بندی هر پیام × N، به‌علاوه‌ی سهم پاسخ AI × N × میانگین هزینه‌ی
              پاسخ AI).
            </p>
          </Section>

          <Section icon="🎯" title="بر اساس هدف" summary={byPurpose.length ? `${fa(byPurpose.length)} هدف · ${fa(totalCalls)} call` : "هنوز مصرفی نیست"} defaultOpen>
            {byPurpose.length === 0 ? (
              <EmptyState icon="🎯" title="هنوز مصرفی نیست" hint="بعد از اولین call به AI اینجا می‌بینی خرج کجا می‌ره." />
            ) : (
              <div className="-mx-4 -mb-4">
                {byPurpose.map((r) => listRow(r.purpose ?? "?", PURPOSE_LABEL[r.purpose ?? ""] ?? r.purpose, r.calls, r.totalCostUsd))}
              </div>
            )}
          </Section>

          <Section icon="🤖" title="بر اساس مدل" summary={byModel.length ? `${fa(byModel.length)} مدل` : "هنوز مصرفی نیست"} defaultOpen>
            {byModel.length === 0 ? (
              <EmptyState icon="🤖" title="هنوز مصرفی نیست" hint="بعد از اولین call به AI اینجا می‌بینی خرج کجا می‌ره." />
            ) : (
              <div className="-mx-4 -mb-4">
                {byModel.map((r) => listRow(r.model ?? "?", r.model, r.calls, r.totalCostUsd, true))}
              </div>
            )}
          </Section>

          <Section icon="📅" title="خرج روزانه" summary={byDay.length ? `${fa(byDay.length)} روز` : "هنوز مصرفی نیست"}>
            {byDay.length === 0 ? (
              <EmptyState icon="📅" title="هنوز مصرفی نیست" hint="بعد از اولین call به AI اینجا می‌بینی خرج کجا می‌ره." />
            ) : (
              <div className="flex flex-col gap-3">
                {byDay.map((d) => (
                  <div key={d.day}>
                    <div className="flex items-center justify-between gap-2 text-xs tabular-nums mb-1">
                      <span dir="ltr" className="text-[var(--color-text-dim)]">{d.day}</span>
                      <span>
                        {usd(d.totalCostUsd, 4)}
                        <span className="text-[var(--color-text-dim)]"> · {fa(d.calls)} call</span>
                      </span>
                    </div>
                    <div dir="ltr" className="h-3 bg-[var(--color-surface-2)] rounded">
                      <div
                        className="h-full bg-[var(--color-accent)] rounded"
                        style={{
                          width: `${(d.totalCostUsd / maxDayCost) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </Shell>
  );
}

// Sheet for editing the budget cap + approval step. Mirrors the
// Instagram budget dialog — two inputs and a single save button that
// PUTs through the approve endpoint with the current approvedUsd
// unchanged (so we don't accidentally bump allocation).
function OpenrouterBudgetDialog({
  budget,
  onClose,
  onSave,
}: {
  budget: BudgetState;
  onClose: () => void;
  onSave: (cap: number, step: number) => Promise<void>;
}) {
  const [cap, setCap] = useState(String(budget.budgetUsd));
  const [step, setStep] = useState(String(budget.stepUsd));
  const [saving, setSaving] = useState(false);

  const capN = Number(cap);
  const stepN = Number(step);
  const valid = Number.isFinite(capN) && capN > 0 && Number.isFinite(stepN) && stepN > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave(capN, stepN);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="تنظیمات بودجه OpenRouter"
        className="w-full md:max-w-md rounded-t-3xl md:rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 pb-6 text-center shadow-2xl"
      >
        <h3 className="text-base font-semibold mb-4">⚙️ تنظیمات بودجه OpenRouter</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="cap" className="text-sm leading-6 block mb-1.5">
              💰 سقف کلی بودجه (USD) — حداکثری که اجازه می‌دی خرج بشه
            </label>
            <input
              id="cap"
              type="number"
              dir="ltr"
              min="0"
              step="0.01"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="step" className="text-sm leading-6 block mb-1.5">
              ⚡ مقدار هر تخصیص (USD) — هر بار «تایید» می‌زنی این‌قدر اضافه می‌شه
            </label>
            <input
              id="step"
              type="number"
              dir="ltr"
              min="0.01"
              step="0.01"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className={field}
            />
          </div>
          <div className="text-xs leading-6 text-[var(--color-text-dim)]">
            خرج فعلی: {usd(budget.spentUsd, 4)} · مجاز فعلی: {usd(budget.approvedUsd)}
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving || !valid} className={btnPrimary}>
            {saving ? "ذخیره…" : "ذخیره"}
          </button>
          <button onClick={onClose} className={btn}>
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
