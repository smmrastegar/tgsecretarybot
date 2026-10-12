"use client";

import Section from "@/components/ui/Section";
import { relTime } from "@/lib/format";
import { ActionRow, Field, Note, Stack, SubBlock, ToggleList, ToggleRow, btnCls, inputCls } from "./shared";
import { MODE_LABELS, type Rule } from "./types";

// What the AI does in this chat. Only the blocks that apply to the current mode / chat kind are shown:
// tone fine-tuning (private chats), media understanding (AI chat), automatic thread summaries (AI listen).
export default function AiSection({ rule, showTone, saving, patchRule, putAutoSummarize, fineTuning, fineTuneMsg, onFineTune }: {
  rule: Rule | null;
  showTone: boolean;
  saving: boolean;
  patchRule: (patch: Record<string, unknown>) => Promise<void>;
  putAutoSummarize: (body: { enabled: boolean; gapMinutes: number; smartTiming: boolean }) => void;
  fineTuning: boolean;
  fineTuneMsg: string | null;
  onFineTune: () => void;
}) {
  const showMedia = rule?.mode === "ai_chat";
  const showSummary = rule?.mode === "ai_listen";
  if (!rule || (!showTone && !showMedia && !showSummary)) return null;

  const enabled = Boolean(rule.autoSummarizeEnabled);
  const gap = rule.autoSummarizeGapMinutes ?? 5;
  const smart = rule.autoSummarizeSmartTiming ?? true;
  const media: Array<[string, string, boolean]> = [
    ["aiProcessVoice", "🎤 ویس", rule.aiProcessVoice],
    ["aiProcessStickers", "🎨 استیکر", rule.aiProcessStickers],
    ["aiProcessGifs", "🎞 گیف", rule.aiProcessGifs],
    ["aiProcessPhotos", "📷 عکس", rule.aiProcessPhotos],
    ["aiProcessVideoNotes", "📹 ویدیو نوت", rule.aiProcessVideoNotes],
    ["aiGeneratePhoto", "🖼 تولید عکس من", rule.aiGeneratePhoto],
  ];
  const summary = showSummary ? `${MODE_LABELS.ai_listen.split(" (")[0]} · خلاصه‌سازی ${enabled ? "روشن" : "خاموش"}`
    : showMedia ? `چت AI · ${media.filter((m) => m[2]).length > 0 ? "پردازش رسانه فعال" : "پردازش رسانه خاموش"}`
      : rule.toneProfileAt ? `لحن تنظیم شد ${relTime(rule.toneProfileAt)}` : "لحن هنوز تنظیم نشده";

  return (
    <Section icon="🧠" title="پاسخ‌های AI" summary={summary}>
      <Stack>
        {showSummary && (
          <SubBlock title="📬 خلاصه‌سازی خودکار thread‌ها"
            hint="وقتی یه thread با گپ سکوت بسته بشه، خلاصه‌اش خودکار تولید می‌شه و توی کانال «Summary inbox» (که توی Functions ست کردی) با دکمه‌ی «جواب پیشنهادی» پست می‌شه. پیش‌فرض خاموش.">
            <ToggleList>
              <ToggleRow label="خلاصه‌سازی خودکار روشن" checked={enabled} disabled={saving}
                onChange={(v) => putAutoSummarize({ enabled: v, gapMinutes: gap, smartTiming: smart })} />
              <ToggleRow label="🧠 timing هوشمند"
                hint="گپ از آخرین پیامِ «کسی که thread رو شروع کرده» حساب بشه. یعنی اگه طرف پرسیده و تو جواب دادی و باز خودش یه چیزی اضافه کرده، تایمر از پیام آخرِ اون شروع می‌شه (نه از پیام تو)."
                checked={smart} disabled={saving || !enabled}
                onChange={(v) => putAutoSummarize({ enabled, gapMinutes: gap, smartTiming: v })} />
            </ToggleList>
            <div className="mt-3">
              <Field label="گپ سکوت برای بستن thread">
                <select value={gap} disabled={saving || !enabled} className={inputCls}
                  onChange={(e) => putAutoSummarize({ enabled: rule.autoSummarizeEnabled, gapMinutes: Number(e.target.value), smartTiming: smart })}>
                  <option value="2">۲ دقیقه</option>
                  <option value="5">۵ دقیقه</option>
                  <option value="10">۱۰ دقیقه</option>
                  <option value="15">۱۵ دقیقه</option>
                  <option value="30">۳۰ دقیقه</option>
                  <option value="60">۱ ساعت</option>
                </select>
              </Field>
            </div>
            {rule.lastAutoSummaryAt && <Note>آخرین summary خودکار: {relTime(rule.lastAutoSummaryAt)}</Note>}
          </SubBlock>
        )}

        {showMedia && (
          <SubBlock title="🎙 پردازش خودکار رسانه در AI chat"
            hint="وقتی روشن باشه، AI به جای اینکه ساکت بمونه ویس / استیکر / GIF / عکس / ویدیو نوت رو می‌فهمه و جواب می‌ده. transcript روی پیام پایدار می‌مونه و دفعه‌ی بعد نیازی به دکمه نیست.">
            <ToggleList>
              {media.map(([key, label, value]) => (
                <ToggleRow key={key} label={label} checked={Boolean(value)} disabled={saving}
                  hint={key === "aiGeneratePhoto" ? "نیاز به Owner photo URL تو Settings" : undefined}
                  onChange={(v) => patchRule({ [key]: v })} />
              ))}
            </ToggleList>
          </SubBlock>
        )}

        {showTone && (
          <SubBlock title="🎯 Fine-tune لحن AI روی پیام‌های قبلی شما"
            hint={<>فقط پیام‌هایی که خودت تایپ کردی بررسی می‌شه — پیام‌های AI کنار گذاشته میشن.{rule.toneProfileAt ? ` آخرین تنظیم: ${relTime(rule.toneProfileAt)}` : " هنوز تنظیم نشده."}</>}>
            <ActionRow>
              <button type="button" onClick={onFineTune} disabled={fineTuning} className={btnCls}>
                {fineTuning ? "در حال تحلیل…" : rule.toneProfile ? "Re-tune" : "Fine-tune now"}
              </button>
            </ActionRow>
            {fineTuneMsg && <Note tone={fineTuneMsg.toLowerCase().includes("updat") ? "ok" : "warn"}>{fineTuneMsg}</Note>}
            {rule.toneProfile && (
              <details className="mt-3">
                <summary className="min-h-11 flex items-center justify-center text-sm text-[var(--color-text-dim)] cursor-pointer">نمایش tone profile فعلی</summary>
                <pre dir="auto" className="mt-1 text-xs leading-6 text-start whitespace-pre-wrap [overflow-wrap:anywhere] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-3">{rule.toneProfile}</pre>
              </details>
            )}
          </SubBlock>
        )}
      </Stack>
    </Section>
  );
}
