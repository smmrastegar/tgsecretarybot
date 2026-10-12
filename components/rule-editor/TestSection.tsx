"use client";

import { relTime, truncate } from "@/lib/format";
import { btnGhost, btnPrimary, Chip, fa, Field, inputCls, Note, type TestResult } from "./shared";

// Manual run (type a message, the real matcher runs and forwards on a match) + replay of the rule over past
// messages. Both only display what the page's handlers return.
export default function TestSection({
  simText, simBusy, simResult, setSimText, onSimulate,
  testLimit, testing, testResults, setTestLimit, onRunTest,
}: {
  simText: string; simBusy: boolean; simResult: string | null; setSimText: (v: string) => void; onSimulate: () => void;
  testLimit: number; testing: boolean; testResults: TestResult[] | null; setTestLimit: (n: number) => void; onRunTest: () => void;
}) {
  const matched = testResults?.filter((r) => r.matched) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Field
          label="▶️ تست/اجرای دستی — یه پیام بده، اگه match شد واقعاً اجرا می‌شه"
          hint={<>
            دقیقاً مثل یه پیام واقعی از همین مسیر رد می‌شه: اگه match بشه و گیت فعال باشه، <b>نگه‌داشته می‌شه</b> و می‌ره تو تب «فعال (منتظر)» تا
            گیرنده «کد بده» بفرسته. اگه گیت غیرفعال باشه، <b>واقعاً فوروارد می‌شه</b>. (گیرنده‌های متوقف‌شده رد می‌شن.)
          </>}
        >
          <textarea value={simText} onChange={(e) => setSimText(e.target.value)} placeholder="متن پیام تستی…" rows={3} className={inputCls} />
        </Field>
        <div className="flex gap-2">
          <button onClick={onSimulate} disabled={simBusy || !simText.trim()} className={btnPrimary}>
            {simBusy ? "…" : "▶️ اجرا"}
          </button>
        </div>
        {simResult && <Note>{simResult}</Note>}
      </div>

      <div className="pt-5 border-t border-[var(--color-border)] flex flex-col gap-3">
        <Field label="🧪 تست روی پیام‌های قبلی">
          <select value={testLimit} onChange={(e) => setTestLimit(Number(e.target.value))} className={`${inputCls} text-start`}>
            <option value={10}>۱۰ پیام</option>
            <option value={30}>۳۰ پیام</option>
            <option value={50}>۵۰ پیام</option>
            <option value={100}>۱۰۰ پیام</option>
          </select>
        </Field>
        <div className="flex gap-2">
          <button onClick={onRunTest} disabled={testing} className={btnGhost}>
            {testing ? "تست…" : "▶ run"}
          </button>
        </div>
        {testResults && (
          <>
            <div className="text-xs leading-6 text-[var(--color-text-dim)]">
              {fa(matched.length)} از {fa(testResults.length)} پیام match شد.
              {matched.length === 0 && " — هیچی match نشد، rule رو ویرایش کن یا نمونه‌ی بیشتر اضافه کن."}
            </div>
            <div className="flex flex-col gap-2">
              {matched.map((r) => (
                <div key={r.messageLogId} className="p-3 rounded-xl text-xs border border-emerald-700 bg-emerald-900/20 flex flex-col gap-2">
                  <div className="flex flex-col items-center gap-1 text-xs text-[var(--color-text-dim)]">
                    <Chip tone="ok">match</Chip>
                    <span>{r.senderName} · {r.chatTitle ?? `chat ${r.chatId}`} · {relTime(r.createdAt)}</span>
                  </div>
                  {/* text-start: message bodies are data */}
                  <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="whitespace-pre-wrap break-words text-start leading-6">
                    {truncate(r.originalText, 300)}
                  </div>
                  {r.formattedText && (
                    <div className="pt-2 border-t border-emerald-700/40">
                      <div className="text-xs text-[var(--color-text-dim)] mb-1">خروجی format شده:</div>
                      <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="whitespace-pre-wrap break-words text-start leading-6">
                        {r.formattedText}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
