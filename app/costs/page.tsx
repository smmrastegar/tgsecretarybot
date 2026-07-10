"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, StatCard, Badge } from "@/components/Card";

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

export default function CostsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [byPurpose, setByPurpose] = useState<Row[]>([]);
  const [byModel, setByModel] = useState<Row[]>([]);
  const [byDay, setByDay] = useState<DayRow[]>([]);
  const [predictN, setPredictN] = useState(1000);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [creditsError, setCreditsError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/ai-usage?days=${days}`);
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
    setLoading(false);
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

  return (
    <Shell>
      <PageTitle
        title="هزینه‌های AI"
        subtitle="خرج OpenRouter / Groq کجا می‌ره."
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <option value={7}>۷ روز اخیر</option>
            <option value={30}>۳۰ روز اخیر</option>
            <option value={90}>۹۰ روز اخیر</option>
          </select>
        }
      />

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <StatCard
            label="هزینه کل"
            value={`$${overview.totalCostUsd.toFixed(4)}`}
            hint={`${overview.totalCalls} call در کل`}
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
            value={`${(byPurpose.reduce((s, r) => s + r.totalTokens, 0) / 1000).toFixed(1)}k`}
          />
        </div>
      )}

      {budget && (
        <Card
          className={`mb-4 !p-3 ${
            budget.budgetExceeded
              ? "!border-red-700 !bg-red-900/20"
              : budget.needsApproval
                ? "!border-amber-600 !bg-amber-900/20"
                : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="text-sm font-medium">
              {budget.budgetExceeded
                ? "🛑 سقف بودجه OpenRouter تمام شد"
                : budget.needsApproval
                  ? "⏸ نیاز به تایید برای ادامه‌ی هزینه"
                  : "💳 بودجه OpenRouter"}
            </div>
            <div className="flex items-center gap-2">
              {budget.tenantName && (
                <span className="text-[10px] text-[var(--color-text-dim)]">
                  tenant: {budget.tenantName}
                </span>
              )}
              <button
                onClick={() => setBudgetDialog(true)}
                className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                ⚙️ تنظیمات
              </button>
              <button
                onClick={loadBudget}
                className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                🔄
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[11px] mb-2">
            <span>
              <span className="text-[var(--color-text-dim)]">خرج‌شده:</span>{" "}
              <strong>${budget.spentUsd.toFixed(4)}</strong>
            </span>
            <span>
              <span className="text-[var(--color-text-dim)]">مجاز تا:</span>{" "}
              <strong>${budget.approvedUsd.toFixed(2)}</strong>
            </span>
            <span>
              <span className="text-[var(--color-text-dim)]">سقف کلی:</span>{" "}
              <strong>${budget.budgetUsd.toFixed(2)}</strong>
            </span>
            <span className="text-[var(--color-text-dim)]">
              · step ${budget.stepUsd.toFixed(2)}
            </span>
            {credits && (
              <span className="text-[var(--color-text-dim)]">
                · موجودی واقعی OpenRouter:{" "}
                <strong className="text-emerald-300">
                  ${credits.remaining.toFixed(2)}
                </strong>
              </span>
            )}
            {creditsError && !credits && (
              <span className="text-red-300 text-[10px]">
                ({creditsError.slice(0, 40)})
              </span>
            )}
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
          {(budget.needsApproval || budget.budgetExceeded) && (
            <div className="text-[11px] text-amber-200 mb-2">
              {budget.budgetExceeded
                ? `سقف کل $${budget.budgetUsd.toFixed(2)} پر شد. AI call‌ها قفلن — با دکمه «🔓 +$${budget.stepUsd.toFixed(2)} + سقف» یه slice دیگه باز کن.`
                : `خرج رسید به سقف مجاز $${budget.approvedUsd.toFixed(2)}. تا تخصیص ندی، call‌ها bunda می‌شن.`}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-[var(--color-text-dim)]">
              ⚡ تخصیص:
            </span>
            {/* Always-available +step button. */}
            <button
              onClick={() => approveNext()}
              disabled={
                approving ||
                budget.approvedUsd + 0.0001 >= budget.budgetUsd
              }
              className="text-[11px] px-2.5 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-40"
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
                  className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
                  title={`بپر تا $${(budget.approvedUsd + budget.stepUsd * n).toFixed(2)}`}
                >
                  +{n}×
                </button>
              ));
            })()}
            {/* Jump straight to cap. */}
            {budget.approvedUsd + 0.0001 < budget.budgetUsd && (
              <button
                onClick={() => approveNext({ absolute: budget.budgetUsd })}
                disabled={approving}
                className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
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
              className="text-[11px] px-2.5 py-1 rounded-md border border-amber-600 bg-amber-500/15 text-amber-200 hover:bg-amber-500/30"
              title={`سقف رو $${budget.stepUsd.toFixed(2)} بالا ببر + تخصیص رو هم تا اونجا ببر`}
            >
              🔓 +${budget.stepUsd.toFixed(2)} + سقف
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

      {loading && <Card className="mb-4">بارگذاری…</Card>}

      <Card className="mb-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
          پیش‌بینی هزینه
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span>اگه</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={predictN}
            onChange={(e) =>
              setPredictN(Math.max(1, Number(e.target.value) || 0))
            }
            className="w-24 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <span>پیام ورودی دیگه بیاد →</span>
          <Badge tone="info">
            تخمین ${predictedCost.toFixed(4)}
          </Badge>
        </div>
        <p className="text-xs text-[var(--color-text-dim)] mt-2">
          از میانگین هر call در بازه‌ی انتخاب‌شده استفاده می‌کنه (هزینه‌ی
          دسته‌بندی هر پیام × N، به‌علاوه‌ی سهم پاسخ AI × N × میانگین هزینه‌ی
          پاسخ AI).
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            بر اساس هدف
          </div>
          {byPurpose.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">هنوز مصرفی نیست.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byPurpose.map((r) => (
                  <tr
                    key={r.purpose}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2 pr-2">
                      {PURPOSE_LABEL[r.purpose ?? ""] ?? r.purpose}
                    </td>
                    <td className="py-2 pr-2 text-right text-xs text-[var(--color-text-dim)]">
                      {r.calls} calls
                    </td>
                    <td className="py-2 text-right">
                      ${r.totalCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            بر اساس مدل
          </div>
          {byModel.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">هنوز مصرفی نیست.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byModel.map((r) => (
                  <tr
                    key={r.model}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2 pr-2 break-all text-xs">
                      {r.model}
                    </td>
                    <td className="py-2 pr-2 text-right text-xs text-[var(--color-text-dim)]">
                      {r.calls}
                    </td>
                    <td className="py-2 text-right">
                      ${r.totalCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
          خرج روزانه
        </div>
        {byDay.length === 0 ? (
          <p className="text-sm text-[var(--color-text-dim)]">هنوز مصرفی نیست.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {byDay.map((d) => (
              <div key={d.day} className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[var(--color-text-dim)] shrink-0">
                  {d.day}
                </span>
                <div className="flex-1 h-3 bg-[var(--color-surface-2)] rounded">
                  <div
                    className="h-full bg-[var(--color-accent)] rounded"
                    style={{
                      width: `${(d.totalCostUsd / maxDayCost) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-20 text-right tabular-nums">
                  ${d.totalCostUsd.toFixed(4)}
                </span>
                <span className="w-16 text-right text-[var(--color-text-dim)]">
                  {d.calls}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}

// Modal for editing the budget cap + approval step. Mirrors the
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

  const save = async () => {
    const capN = Number(cap);
    const stepN = Number(step);
    if (!Number.isFinite(capN) || capN <= 0) return;
    if (!Number.isFinite(stepN) || stepN <= 0) return;
    setSaving(true);
    try {
      await onSave(capN, stepN);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">⚙️ تنظیمات بودجه OpenRouter</h3>
          <button
            onClick={onClose}
            className="text-[var(--color-text-dim)] hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[var(--color-text-dim)] block mb-1">
              💰 سقف کلی بودجه (USD) — حداکثری که اجازه می‌دی خرج بشه
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 tabular-nums"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--color-text-dim)] block mb-1">
              ⚡ مقدار هر تخصیص (USD) — هر بار «تایید» می‌زنی این‌قدر اضافه می‌شه
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 tabular-nums"
            />
          </div>
          <div className="text-[10px] text-[var(--color-text-dim)] pt-1">
            خرج فعلی: ${budget.spentUsd.toFixed(4)} · مجاز فعلی: $
            {budget.approvedUsd.toFixed(2)}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            انصراف
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "ذخیره…" : "ذخیره"}
          </button>
        </div>
      </div>
    </div>
  );
}
