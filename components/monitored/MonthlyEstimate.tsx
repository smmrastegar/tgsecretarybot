"use client";

import { useState } from "react";
import Section, { Pill } from "@/components/ui/Section";
import { ToggleRow } from "@/components/chat-detail/shared";
import { TEHRAN_TRIGGER_HOURS, Tile, Usd, fa, intervalLabel, type Account } from "./shared";

// HikerAPI per-call prices we use today, in USD. These mirror the
// authoritative table in lib/hikerapi-budget.ts; if that file changes
// these need to bump too.
const HIKER_USD = {
  userByUsername: 0.001,
  stories: 0.003,
  posts: 0.012,
  reels: 0.012,
  mentions: 0.012,
} as const;

// HikerAPI plan tiers (best estimate — confirm against your contract).
// Used only to color/explain the projected monthly cost; the cron
// itself never references these.
const PLAN_TIERS = [
  { id: "basic", label: "Basic", monthly: 30 },
  { id: "pro", label: "Pro", monthly: 100 },
  { id: "ultra", label: "Ultra", monthly: 300 },
] as const;

// Probability that each "expensive feed" call is actually made when
// optimize_change_detection is on (i.e. the account's media_count
// changed since last check). 25% is a reasonable upper bound for the
// kinds of accounts the operator follows; real numbers will be lower.
const CHANGE_DETECTION_HIT_RATE = 0.25;

export default function MonthlyEstimate({ accounts }: { accounts: Account[] }) {
  const [optimizeOn, setOptimizeOn] = useState(true);
  const [pickedPlan, setPickedPlan] = useState<(typeof PLAN_TIERS)[number]["id"]>("ultra");

  // Cost per single tick of one account, before any optimization.
  function costPerTick(a: Account): number {
    if (!a.enabled) return 0;
    // The user-by-username lookup is always paid (it's the cheap
    // baseline call that decides whether to go further).
    let cost = HIKER_USD.userByUsername;
    if (a.checkStories) cost += HIKER_USD.stories;
    // Posts / reels / mentions are gated by optimize_change_detection
    // when it's on — multiply by the hit-rate to estimate average cost.
    const heavyHitRate = optimizeOn ? CHANGE_DETECTION_HIT_RATE : 1;
    if (a.checkPosts) cost += HIKER_USD.posts * heavyHitRate;
    if (a.checkReels) cost += HIKER_USD.reels * heavyHitRate;
    if (a.checkMentioned) cost += HIKER_USD.mentions * heavyHitRate;
    return cost;
  }

  // Ticks per month is the number of Tehran peak-hour triggers per
  // day * 30. For intervals without a curated schedule fall back to
  // the old "wall-clock / interval" estimate. This matches the gate
  // applied in lib/db.ts dueMonitoredAccounts.
  //
  // For notify-mode accounts we compute the WORST CASE: a 3-hour
  // cooldown caps fetches at 8 per day → 240 per month. Actual
  // spending is usually much lower (only when the external notify
  // service actually fires), but the estimate has to fit the user-
  // visible "worst case" guarantee.
  function ticksPerMonth(intervalMinutes: number, mode?: string): number {
    if (mode === "notify") return 8 * 30;
    // 3-hour floor — anything shorter is a stale row the migration
    // missed, treat it as the 3h schedule so the dashboard doesn't
    // show the legacy cost regime.
    const m = Math.max(180, intervalMinutes);
    const hours = TEHRAN_TRIGGER_HOURS[m];
    if (hours && hours.length > 0) return hours.length * 30;
    return m > 0 ? (30 * 24 * 60) / m : 0;
  }

  const perAccountMonthly = accounts.map((a) => {
    const ticks = ticksPerMonth(a.intervalMinutes, a.mode);
    const monthly = costPerTick(a) * ticks;
    return { account: a, ticks, monthly };
  });
  const totalMonthly = perAccountMonthly.reduce((s, r) => s + r.monthly, 0);
  const enabledCount = accounts.filter((a) => a.enabled).length;
  const plan = PLAN_TIERS.find((p) => p.id === pickedPlan) ?? PLAN_TIERS[2];
  const overspend = totalMonthly > plan.monthly;
  const percentOfPlan = plan.monthly > 0 ? (totalMonthly / plan.monthly) * 100 : 0;

  // Group by bucket. Notify-mode accounts get their own row
  // (worst-case cap). Interval-mode accounts bucket by their
  // intervalMinutes — pulled from the actual data so accounts on
  // legacy values (15 / 30 / 60 min) still appear in the breakdown.
  type Row = { key: string; label: string; count: number; cost: number };
  const enabledAccounts = accounts.filter((a) => a.enabled);
  const notifyAccounts = enabledAccounts.filter((a) => a.mode === "notify");
  const intervalAccounts = enabledAccounts.filter((a) => a.mode !== "notify");
  const intervalSet = new Set<number>(intervalAccounts.map((a) => a.intervalMinutes));
  const intervalBreakdown: Row[] = [];
  if (notifyAccounts.length > 0) {
    const cost = notifyAccounts.reduce((s, a) => s + costPerTick(a) * ticksPerMonth(a.intervalMinutes, "notify"), 0);
    intervalBreakdown.push({
      key: "notify",
      label: "🔔 notify (سقف ۸ بار/روز با cooldown ۳h)",
      count: notifyAccounts.length,
      cost,
    });
  }
  for (const minutes of Array.from(intervalSet).sort((a, b) => a - b)) {
    const inGroup = intervalAccounts.filter((a) => a.intervalMinutes === minutes);
    const cost = inGroup.reduce((s, a) => s + costPerTick(a) * ticksPerMonth(minutes), 0);
    intervalBreakdown.push({
      key: `i:${minutes}`,
      label: intervalLabel(minutes),
      count: inGroup.length,
      cost,
    });
  }

  return (
    <Section
      icon="📈"
      title="تخمین هزینه‌ی ماهانه HikerAPI"
      summary={
        <>
          حدود <Usd v={totalMonthly} /> در ماه · {fa(enabledCount)} اکانت فعال
        </>
      }
      badge={overspend ? <Pill tone="bad">بیش از پلن</Pill> : undefined}
      className="!mb-0"
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs leading-6 text-[var(--color-text-dim)]">
          تخمین بر اساس interval هر اکانت و kind های روشن. با <code>optimize_change_detection</code> فرض می‌گیریم فقط{" "}
          {fa(Math.round(CHANGE_DETECTION_HIT_RATE * 100))}٪ از تیک‌ها posts/reels/mentions می‌خونن (وقتی media_count
          تغییر کرده). بدون اون، هر تیک کامل خونده می‌شه.
        </p>

        <ToggleRow label="optimize_change_detection" checked={optimizeOn} onChange={setOptimizeOn} />

        <div className="grid grid-cols-3 gap-2">
          <Tile label="اکانت‌های فعال">{fa(enabledCount)}</Tile>
          <Tile label="تخمین ماهانه" tone={overspend ? "bad" : "ok"}>
            <Usd v={totalMonthly} />
          </Tile>
          <Tile label={`٪ پلن ${plan.label}`} tone={overspend ? "bad" : "neutral"}>
            {fa(percentOfPlan.toFixed(0))}٪
          </Tile>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {PLAN_TIERS.map((p) => (
            <button
              type="button"
              key={p.id}
              aria-pressed={pickedPlan === p.id}
              onClick={() => setPickedPlan(p.id)}
              className={`min-h-12 px-1 rounded-xl border text-sm ${
                pickedPlan === p.id
                  ? "bg-[var(--color-accent)] text-white border-transparent"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {p.label}
              <span className="block text-xs opacity-80" dir="ltr">
                ${fa(p.monthly)}/mo
              </span>
            </button>
          ))}
        </div>

        {overspend && (
          <p className="text-xs leading-6 text-red-300">
            ⚠️ تخمین بیشتر از پلن {plan.label} (<bdi dir="ltr">${fa(plan.monthly)}/mo</bdi>) هست. interval بیشتری بزن یا
            چند اکانت رو خاموش کن.
          </p>
        )}

        {intervalBreakdown.length > 0 && (
          <div className="pt-3 border-t border-[var(--color-border)]">
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
              تفکیک بر اساس interval (همه ساعت‌ها به وقت تهران). 🌙 ساعت ۲ تا ۸ صبح هیچ بررسی‌ای انجام نمی‌شه (intervals
              کمتر از ۱۲h فقط از ۹ صبح تا حدود ۲۲ شب اجرا می‌شن).
            </p>
            <div className="flex flex-col gap-2">
              {intervalBreakdown.map((row) => {
                const minutes = row.key.startsWith("i:") ? Number(row.key.slice(2)) : null;
                const hours = minutes != null ? TEHRAN_TRIGGER_HOURS[minutes] : undefined;
                const slots = hours ? hours.map((h) => `${fa(h)}:۰۰`).join("، ") : null;
                return (
                  <div
                    key={row.key}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5 flex items-center justify-between gap-3"
                  >
                    {/* label + counts on the start side, the amount on the end: a two-column data row */}
                    <span className="min-w-0 text-sm text-start">
                      {row.label}
                      <span className="block text-xs text-[var(--color-text-dim)]">{fa(row.count)} اکانت</span>
                      {slots && (
                        <span className="block text-xs text-[var(--color-text-dim)]">ساعت‌های اجرا: {slots}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <Usd v={row.cost} /> <span className="text-xs text-[var(--color-text-dim)]">در ماه</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
