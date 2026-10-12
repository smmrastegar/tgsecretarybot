"use client";

import Section, { Pill } from "@/components/ui/Section";
import { BTN, BTN_AMBER, BTN_PRIMARY, Usd, fa, type Diagnose, type OutOfCredits, type Usage } from "./shared";

// HikerAPI key + balance panel (the key sheet, diagnose and refresh are driven by the page).
export default function UsageSection({
  usage,
  usageError,
  outOfCredits,
  loading,
  keyPrefix,
  keySource,
  keyName,
  diagnose,
  diagnoseLoading,
  open,
  onOpenChange,
  onOpenKey,
  onDiagnose,
  onRefresh,
}: {
  usage: Usage | null;
  usageError: string | null;
  outOfCredits: OutOfCredits | null;
  loading: boolean;
  keyPrefix: string | null;
  keySource: "tenant" | "db" | "env" | null;
  keyName: string | null;
  diagnose: Diagnose | null;
  diagnoseLoading: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenKey: () => void;
  onDiagnose: () => void;
  onRefresh: () => void;
}) {
  const problem = Boolean(outOfCredits || usageError || (usage && !usage.configured));
  const summary = outOfCredits ? (
    "پاسخ ۴۰۲ — اعتبار/Plan"
  ) : usageError ? (
    "خطا در دریافت مصرف"
  ) : usage?.configured ? (
    usage.balanceUsd != null ? (
      <>
        موجودی <Usd v={usage.balanceUsd} />
      </>
    ) : (
      "کلید فعال است"
    )
  ) : usage ? (
    "کلید ست نشده"
  ) : (
    "در حال بارگذاری…"
  );

  return (
    <Section
      icon={outOfCredits ? "💸" : "💳"}
      title={outOfCredits ? "HikerAPI پاسخ ۴۰۲ می‌ده" : "مصرف HikerAPI"}
      summary={summary}
      badge={problem ? <Pill tone="bad">!</Pill> : undefined}
      open={open}
      onOpenChange={onOpenChange}
      className="!mb-0"
    >
      <div className="flex flex-col gap-3">
        {keyPrefix ? (
          <div
            dir="ltr"
            className="text-xs text-[var(--color-text-dim)] font-mono break-all"
            title="کلیدی که سرور الان داره استفاده می‌کنه"
          >
            {keyName ? `${keyName} ` : ""}key: {keyPrefix}
            {keySource && (
              <span
                className={`mx-1 px-1.5 py-0.5 rounded ${
                  keySource === "db" ? "bg-emerald-900/40 text-emerald-300" : "bg-blue-900/40 text-blue-300"
                }`}
              >
                {keySource}
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-red-300">⚠️ کلیدی ست نشده</div>
        )}

        {outOfCredits ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-6 text-amber-200">
              HikerAPI روی probe (مثل <span dir="ltr">/v1/auth/me</span>) خطای ۴۰۲ <code>InsufficientFunds</code>{" "}
              برمی‌گردونه. این <strong>همیشه</strong> یعنی Balance صفره — گاهی فقط یعنی Plan فعال نداری حتی اگه Balance
              مثبته. اول 🩺 «تشخیص» بزن، اگه یکی از probeها 2xx شد این banner پاک می‌شه. اگه واقعاً همه ۴۰۲ بودن، توی
              dashboard هم Plan رو فعال کن + هم Balance رو شارژ کن.
            </p>
            <div dir="ltr" className="text-xs text-amber-300/70 break-all font-mono">
              {outOfCredits.message}
            </div>
            <div className="flex flex-wrap items-center gap-2 [justify-content:left]">
              <a
                href={outOfCredits.billingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-11 px-4 rounded-xl bg-amber-500 text-black text-sm font-medium inline-flex items-center"
              >
                💳 <bdi dir="ltr">hikerapi.com/billing →</bdi>
              </a>
              <a href="https://hikerapi.com/profile" target="_blank" rel="noopener noreferrer" className={BTN_AMBER}>
                ⚙️ فعال‌سازی Plan
              </a>
            </div>
          </div>
        ) : usageError ? (
          <div className="rounded-xl border border-red-800 bg-red-900/20 px-3 py-2.5 text-sm text-red-300 break-all">
            خطا در دریافت مصرف: {usageError}
          </div>
        ) : usage?.configured ? (
          <div className="flex flex-col gap-1 text-sm">
            {usage.balanceUsd != null ? (
              <div>
                <span className="text-[var(--color-text-dim)]">💰 موجودی:</span>{" "}
                <strong className="text-emerald-300">
                  <Usd v={usage.balanceUsd} />
                </strong>{" "}
                <span className="text-xs text-[var(--color-text-dim)]">(از /sys/balance)</span>
              </div>
            ) : (
              <div className="text-emerald-300">✅ کلید فعاله (موجودی برگشت نخورد)</div>
            )}
            {usage.rateLimitPerSec != null && (
              <div>
                <span className="text-[var(--color-text-dim)]">نرخ:</span>{" "}
                <strong className="tabular-nums" dir="ltr">
                  {fa(usage.rateLimitPerSec)}/sec
                </strong>
              </div>
            )}
            <div className="text-xs text-[var(--color-text-dim)]">هزینه‌ی $ تخمینی از کارت بودجه پایین</div>
          </div>
        ) : usage ? (
          <div className="text-sm text-red-300">⚠️ کلید HikerAPI ست نشده — 🔑 «کلید» رو بزن.</div>
        ) : (
          <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
        )}

        <div className="flex flex-wrap items-center gap-2 [justify-content:left]">
          <button
            type="button"
            onClick={onOpenKey}
            title="کلید HikerAPI رو از همینجا ست کن — بدون redeploy"
            className={BTN_PRIMARY}
          >
            🔑 کلید
          </button>
          <button
            type="button"
            onClick={onDiagnose}
            disabled={diagnoseLoading}
            title="هر سه probe رو raw اجرا می‌کنه + اگه یکی OK بود banner ۴۰۲ رو پاک می‌کنه"
            className={BTN}
          >
            {diagnoseLoading ? "…" : "🩺 تشخیص"}
          </button>
          <button type="button" onClick={onRefresh} disabled={loading} className={BTN}>
            {loading ? "…" : "🔄 بروزرسانی"}
          </button>
        </div>

        {diagnose && (
          <div className="pt-3 border-t border-[var(--color-border)] flex flex-col gap-2">
            <div className="text-sm font-medium">🩺 نتایج تشخیص</div>
            <div className="text-xs">
              <span className="text-[var(--color-text-dim)]">کلید لود شده:</span>{" "}
              <span dir="ltr" className="font-mono">
                {diagnose.keyLoaded ? (diagnose.keyPrefix ?? "(loaded)") : "❌ env nis لود نشده"}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {diagnose.probes.map((p) => {
                const tone = p.ok
                  ? "border-emerald-700 bg-emerald-900/20"
                  : p.transient
                    ? "border-amber-700 bg-amber-900/20"
                    : "border-red-700 bg-red-900/20";
                const icon = p.ok ? "✓" : p.transient ? "⏳" : "✗";
                const iconColor = p.ok ? "text-emerald-400" : p.transient ? "text-amber-300" : "text-red-400";
                return (
                  <div key={p.path} dir="ltr" className={`text-xs p-2 rounded-xl border text-start ${tone}`}>
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <span className={iconColor}>
                        {icon} {p.status || "?"}
                      </span>
                      <span className="font-medium break-all">{p.path}</span>
                      {p.attempts && p.attempts > 1 && (
                        <span className="text-[var(--color-text-dim)]">({p.attempts} attempts)</span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-text-dim)] mt-0.5 break-all font-mono">{p.body}</div>
                  </div>
                );
              })}
            </div>
            {diagnose.probes.some((p) => p.transient) && (
              <p className="text-xs text-amber-200 leading-6">
                ⏳ Instagram خودش الان جواب نمی‌ده (InstagramServerError) — به کلید یا حساب تو ربطی نداره. cron بعدی
                دوباره تلاش می‌کنه. اگه چند بار پشت سر هم اتفاق افتاد، چند دقیقه صبر کن و دوباره «🩺 تشخیص» بزن.
              </p>
            )}
            <p className="text-xs leading-6 text-[var(--color-text-dim)]">
              نکته: اگه کلیدی که اینجا می‌بینی همون کلید درستی نیست که توی hikerapi dashboard داری، یعنی Vercel env یا
              redeploy نشده یا کلید قدیمیه. کلید رو از 🔑 «کلید» همینجا می‌تونی ست کنی.
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
