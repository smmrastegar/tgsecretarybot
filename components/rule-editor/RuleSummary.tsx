import type { ReactNode } from "react";
import { Chip, fa, windowLabel, type Recipient } from "./shared";

// "What does this rule do?" in plain Persian, built from the live form state so it follows every edit:
// where it listens, how it decides, what it sends and when. Sits at the very top of the editor.
export default function RuleSummary({
  name, enabled, sourceChats, examplesCount, negativeCount, description, matchPattern, matchAllFromSource,
  recipients, formatAsOtp, format, header, requestWindow, requestTrigger, gateExamplesCount,
}: {
  name: string; enabled: boolean; sourceChats: string; examplesCount: number; negativeCount: number; description: string;
  matchPattern: string; matchAllFromSource: boolean; recipients: Recipient[]; formatAsOtp: boolean; format: string; header: string;
  requestWindow: number | null; requestTrigger: string; gateExamplesCount: number;
}) {
  const sources = sourceChats.split(/[\s,،]+/).filter(Boolean);
  const activeRecipients = recipients.filter((r) => !r.paused);
  const pausedCount = recipients.length - activeRecipients.length;
  const gateActive = requestWindow != null && requestWindow > 0 && (requestTrigger.trim().length > 0 || gateExamplesCount > 0);

  // 1) where it listens
  const from: ReactNode = sources.length > 0 ? (
    <>
      فقط از {fa(sources.length)} چت مشخص
      <span className="mt-1.5 flex flex-wrap justify-center gap-1">
        {sources.slice(0, 4).map((c) => (
          <span key={c} dir="ltr" className="px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] text-xs tabular-nums">{c}</span>
        ))}
        {sources.length > 4 && <span className="px-2 py-0.5 text-xs text-[var(--color-text-dim)]">+{fa(sources.length - 4)}</span>}
      </span>
    </>
  ) : (
    <span className="text-amber-300">از همه‌ی چت‌ها (بدون محدودیت مبدأ)</span>
  );

  // 2) how it decides
  let decide: ReactNode;
  let decideWarn = false;
  if (matchPattern.trim()) decide = "فقط پیام‌هایی که با الگوی regex بخونن (AI دخالت نمی‌کنه)";
  else if (matchAllFromSource && sources.length > 0) decide = "هر پیامی از این چت‌ها (بدون بررسی نمونه)";
  else if (examplesCount > 0) decide = `پیام‌های شبیه ${fa(examplesCount)} نمونه‌ی مثبت${negativeCount > 0 ? ` و غیرشبیه ${fa(negativeCount)} نمونه‌ی منفی` : ""}`;
  else if (description.trim()) decide = "با توصیف متنی و AI (نمونه‌ای نداری)";
  else { decide = "هنوز نمونه یا توصیفی نداری — چیزی match نمی‌شه"; decideWarn = true; }

  // 3) what it sends
  const send: ReactNode = recipients.length === 0 ? (
    <span className="text-amber-300">هیچ گیرنده‌ای — پیام‌های match‌شده فقط لاگ می‌شن، جایی فرستاده نمی‌شن.</span>
  ) : (
    <>
      به {fa(activeRecipients.length)} گیرنده{pausedCount > 0 ? ` (${fa(pausedCount)} متوقف)` : ""}
      {" · "}
      {formatAsOtp ? "کد OTP (tap-to-copy)" : format.trim() ? "با format سفارشی" : "پیام اصلی"}
      {header.trim() ? " + هدر" : ""}
    </>
  );

  // 4) when
  const when: ReactNode = gateActive ? (
    <>
      🔒 <b>گیت فعاله.</b> پیام‌های match‌شده نگه داشته می‌شن و فقط وقتی گیرنده خودش درخواست بده (تو پنجره‌ی {windowLabel(requestWindow ?? 0)}) ارسال می‌شن. هر درخواست فقط <b>یک</b> پیام آزاد می‌کنه.
    </>
  ) : (
    <>
      🔓 <b>گیت غیرفعاله — هر پیامِ match‌شده فوراً به همه‌ی گیرنده‌ها فوروارد می‌شه.</b> برای فعال‌کردن گیت، هم پنجره‌ی زمانی رو ست کن هم توصیف درخواست (یا نمونه‌های Gate) رو.
    </>
  );

  const rows: Array<{ icon: string; label: string; body: ReactNode; warn?: boolean }> = [
    { icon: "📥", label: "می‌شنوه از", body: from },
    { icon: "🧠", label: "تشخیص", body: decide, warn: decideWarn },
    { icon: "📤", label: "می‌فرسته", body: send },
    { icon: gateActive ? "🔒" : "🔓", label: "زمان ارسال", body: when },
  ];

  return (
    <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold">این rule چه کار می‌کنه؟</h2>
        {enabled ? <Chip tone="ok">on</Chip> : <Chip>off</Chip>}
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-dim)] truncate">{name}</p>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className={`rounded-xl px-3 py-2.5 border ${row.warn ? "border-amber-500/40 bg-amber-500/10" : "border-[var(--color-border)] bg-[var(--color-surface-2)]/50"}`}>
            <div className="text-xs text-[var(--color-text-dim)]">{row.icon} {row.label}</div>
            <div className={`mt-0.5 text-sm leading-7 ${row.warn ? "text-amber-200" : ""}`}>{row.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
