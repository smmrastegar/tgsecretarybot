"use client";

import type { Dispatch, SetStateAction } from "react";

import { btnAmber, CheckRow, Field, HEADER_VARS, inputCls, Note, WINDOW_OPTIONS, type Example } from "./shared";

// Form bodies of the settings sections of the rule editor. All values live in the page (they are saved by the
// single "💾 ذخیره" action), these components only lay them out.

export function SourceFields({
  sourceChats, excludeChats, sourceThreads, matchPattern, matchAllFromSource,
  setSourceChats, setExcludeChats, setSourceThreads, setMatchPattern, setMatchAllFromSource,
}: {
  sourceChats: string; excludeChats: string; sourceThreads: string; matchPattern: string; matchAllFromSource: boolean;
  setSourceChats: (v: string) => void; setExcludeChats: (v: string) => void; setSourceThreads: (v: string) => void;
  setMatchPattern: (v: string) => void; setMatchAllFromSource: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {!sourceChats.trim() && (
        <Note tone="warn">
          ⚠️ محدودیت چت مبدأ ست نشده — پیام <b>هر</b> چتی می‌تونه match بشه. برای دقت، chat_id مبدأ (مثلاً چت پیامک بانک) رو وارد کن.
        </Note>
      )}
      <Field label="🎯 فقط از این چت‌ها" hint="chat_id با کاما — خالی = همه چت‌ها">
        <input type="text" dir="ltr" value={sourceChats} onChange={(e) => setSourceChats(e.target.value)}
          placeholder="-1001234567890, 777" className={inputCls} />
      </Field>
      <Field label="⛔ هرگز از این چت‌ها" hint="chat_id با کاما — برای قانون «همه مبدأها» که باید چند چت را به قانون دیگری واگذار کند">
        <input type="text" dir="ltr" value={excludeChats} onChange={(e) => setExcludeChats(e.target.value)}
          placeholder="-1001234567890" className={inputCls} />
      </Field>
      <Field
        label="🧵 فقط این تاپیک‌ها"
        hint={<>
          message_thread_id با کاما — خالی = همه‌ی تاپیک‌ها. برای گروه‌های فورومی: یک گروه ده‌ها تاپیک بی‌ربط دارد، پس محدودکردن به کل چت
          معمولاً خیلی گشاد است. شناسه‌ی تاپیک را از آدرس پیام در تلگرام وب یا از ستون <code dir="ltr">message_thread_id</code> بردار.
          (فقط وقتی «فقط از این چت‌ها» پر باشد فعال است.)
        </>}
      >
        <input type="text" dir="ltr" value={sourceThreads} onChange={(e) => setSourceThreads(e.target.value)} disabled={!sourceChats.trim()}
          placeholder="12, 40" className={inputCls} />
      </Field>
      <Field
        label="🔒 الگوی اجباری (regex)"
        hint={<>
          خالی = بدون الگو. اگر پر باشد، <b>الگو تصمیم می‌گیرد و AI اصلاً دخالت نمی‌کند</b>: پیامی که با الگو بخواند فوروارد می‌شود و بقیه رد می‌شوند. برای
          وقتی که فرمت پیام مهم است (مثل «باید با تیکت #شماره شروع شود») و نمی‌خواهی نه هر چیزی که کسی تایپ کرد برود، نه AI پیامی را که
          دقیقاً در فرمت است به‌خاطر متنش رد کند. الگوی نامعتبر یعنی قانون هیچ پیامی را نمی‌گیرد، نه اینکه همه را بگیرد.
        </>}
      >
        <input type="text" dir="ltr" value={matchPattern} onChange={(e) => setMatchPattern(e.target.value)}
          placeholder="^\s*🎫?\s*تیکت" className={`${inputCls} font-mono`} />
      </Field>
      <CheckRow checked={matchAllFromSource} disabled={!sourceChats.trim()} onChange={setMatchAllFromSource}>
        📩 <b>هر پیامی از این چت‌ها رو بگیر</b> (بدون بررسی نمونه). برای فیدهای اختصاصی مثل پیامک بانک. تو حالت OTP، پیام‌های بدون کد رد می‌شن.
      </CheckRow>
    </div>
  );
}

export function FormatFields({
  formatAsOtp, header, showRulePrefix, format, previewHeader, setFormatAsOtp, setHeader, setShowRulePrefix, setFormat,
}: {
  formatAsOtp: boolean; header: string; showRulePrefix: boolean; format: string; previewHeader: string;
  setFormatAsOtp: (v: boolean) => void; setHeader: Dispatch<SetStateAction<string>>; setShowRulePrefix: (v: boolean) => void; setFormat: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <CheckRow checked={formatAsOtp} onChange={setFormatAsOtp}>
        🔑 <b>حالت OTP</b> — کد رو از متن استخراج کن و به‌صورت
        <code className="mx-1 px-1 bg-[var(--color-surface-2)] rounded">tap-to-copy</code>
        بفرست.
      </CheckRow>

      <Field label="🪧 هدر پیام" hint="اول هر فوروارد می‌آید — خالی = بدون هدر">
        <textarea value={header} onChange={(e) => setHeader(e.target.value)} rows={3}
          placeholder={"مثلاً: 🎫 درخواست تیک جدید داریم\nاز {sender}"} className={inputCls} />
        <div className="text-xs text-[var(--color-text-dim)]">متغیرها (لمس = افزودن):</div>
        <div className="grid grid-cols-3 gap-2">
          {HEADER_VARS.map((v) => (
            <button key={v.token} type="button" title={v.label}
              onClick={() => setHeader((h) => (h ? `${h} ${v.token}` : v.token))}
              className="min-h-10 px-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:border-[var(--color-accent)] font-mono text-xs">
              {v.token}
            </button>
          ))}
        </div>
        {header.trim() && (
          <div className="text-xs leading-6 p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] whitespace-pre-wrap text-start">
            <span className="text-[var(--color-text-dim)]">پیش‌نمایش: </span>
            {previewHeader}
          </div>
        )}
      </Field>

      <CheckRow checked={showRulePrefix} onChange={setShowRulePrefix}>
        🏷 prefix اول پیام بیاد («[rule: …] · از …»).
      </CheckRow>

      <Field label="✨ format فوروارد" hint="اختیاری — مثلاً «فقط عدد کد رو با emoji 🔑 بفرست». خالی = پیام اصلی (در حالت OTP غیرفعاله).">
        <textarea value={format} onChange={(e) => setFormat(e.target.value)} rows={3} disabled={formatAsOtp}
          placeholder="(اختیاری) format فوروارد — مثلاً «فقط عدد کد رو با emoji 🔑 بفرست» — خالی = پیام اصلی" className={inputCls} />
      </Field>
    </div>
  );
}

export function GateFields({
  requestTrigger, requestWindow, gateExamples, generating, variationStatus,
  setRequestTrigger, setRequestWindow, onGenerate, onDeleteExample,
}: {
  requestTrigger: string; requestWindow: number | null; gateExamples: Example[]; generating: boolean; variationStatus: string | null;
  setRequestTrigger: (v: string) => void; setRequestWindow: (v: number | null) => void; onGenerate: () => void; onDeleteExample: (id: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="⏸ گیت درخواست (اختیاری)"
        hint="اگه ست شد، پیام‌های منطبق فقط وقتی فوروارد می‌شن که گیرنده تو پنجره‌ی زمانی یه پیامی بفرسته که با این توصیف یا نمونه‌های زیر بخوره."
      >
        <textarea value={requestTrigger} onChange={(e) => setRequestTrigger(e.target.value)} rows={2}
          placeholder="توصیف درخواست — مثلاً «کد رو برام بفرست»" className={inputCls} />
      </Field>
      <div className="flex flex-col gap-2 items-center">
        <div className="flex gap-2 self-stretch">
          <button onClick={onGenerate} disabled={generating || !requestTrigger.trim()} className={btnAmber}
            title="با AI پاراف‌رازهای متن بالا رو به‌عنوان نمونه‌ی گیت ذخیره کن">
            {generating ? "..." : "🤖 ساخت نمونه‌های گیت با AI"}
          </button>
        </div>
        {variationStatus && <div className="text-xs leading-6 text-[var(--color-text-dim)]">{variationStatus}</div>}
      </div>
      {gateExamples.length > 0 && (
        <div className="flex flex-col gap-2">
          {gateExamples.map((g) => (
            <div key={g.id} className="flex items-center gap-2 ps-3 pe-1 py-1 min-h-14 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs">
              <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="flex-1 min-w-0 break-words text-start leading-6 py-1.5">
                {g.text}
              </div>
              <button onClick={() => onDeleteExample(g.id)} aria-label="حذف نمونه"
                className="grid place-items-center w-10 h-10 rounded-lg text-sm text-red-300 hover:text-red-200 shrink-0">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <Field label="پنجره‌ی زمانی">
        <select value={requestWindow ?? ""} onChange={(e) => setRequestWindow(e.target.value === "" ? null : Number(e.target.value))}
          className={`${inputCls} text-start`}>
          {WINDOW_OPTIONS.map((o) => (
            <option key={o.value ?? "always"} value={o.value ?? ""}>{o.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}
