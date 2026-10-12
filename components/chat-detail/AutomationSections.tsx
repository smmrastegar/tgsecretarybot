"use client";

import Section from "@/components/ui/Section";
import { Stack, SubBlock, ToggleList, ToggleRow, fa } from "./shared";
import MediaRoutingLog from "./MediaRoutingLog";
import RulesPanel from "./RulesPanel";
import { ALL_FUNCTION_ROLES, FUNCTION_ROLE_LABELS, type Rule } from "./types";

// Roles (Functions) of this chat and the rules that forward into it.
export function RolesSection({ chatId, functionRoles, saving, onRoles }: {
  chatId: number; functionRoles: string[]; saving: boolean; onRoles: (next: string[]) => void;
}) {
  return (
    <Section icon="🧩" title="نقش‌ها و قانون‌ها" summary={functionRoles.length > 0 ? `${fa(functionRoles.length)} نقش فعال` : "بدون نقش · rule‌های فوروارد"}>
      <Stack>
        <SubBlock title="🧩 نقش‌های (Functions) این چت"
          hint="هر چت می‌تونه چند نقش هم‌زمان داشته باشه (مثلاً یه کانال هم 📦 Storage باشه هم 📒 Notes inbox). سوییچ‌های پایین رو هر تعداد بخوای روشن کن.">
          <ToggleList>
            {ALL_FUNCTION_ROLES.map((k) => (
              <ToggleRow key={k} label={FUNCTION_ROLE_LABELS[k]} checked={functionRoles.includes(k)} disabled={saving}
                onChange={(v) => onRoles(v ? Array.from(new Set([...functionRoles, k])) : functionRoles.filter((r) => r !== k))} />
            ))}
          </ToggleList>
        </SubBlock>
        <RulesPanel chatId={chatId} />
      </Stack>
    </Section>
  );
}

// Automatic copying of voice / video / photo / location into the storage channels, plus the routing log.
export function MediaAutomationSection({ chatId, rule, saving, patchAutomation }: {
  chatId: number; rule: Rule | null; saving: boolean; patchAutomation: (patch: Record<string, boolean>) => void;
}) {
  const items: Array<[string, string, string | undefined, boolean | undefined]> = rule ? [
    ["autoForwardVoice", "🎤 voice + 🎥 video-note", "→ voice_storage (با دکمه‌ی 📝 Transcribe)", rule.autoForwardVoice],
    ["autoForwardVideo", "🎬 video", "→ video_storage", rule.autoForwardVideo],
    ["autoForwardPhoto", "🖼 photo", "→ photo_storage", rule.autoForwardPhoto],
    ["autoForwardLocation", "📍 location", "→ Notes + notes_inbox", rule.autoForwardLocation],
    ["autoExtractNotes", "📒 استخراج خودکار آدرس/تماس/نکات مهم با AI", undefined, rule.autoExtractNotes],
    ["selfVoiceTranscript", "🗣 ویسِ خودم → متنش ریپلای بشه زیر همون ویس", "بدون هدر — طرف مقابل هم می‌بینه", rule.selfVoiceTranscript],
  ] : [];
  const on = items.filter((i) => i[3]).length;
  return (
    <Section icon="🤖" title="اتومیشن رسانه" summary={rule ? `${fa(on)} از ${fa(items.length)} روشن · کپی خودکار به Storage` : "کپی خودکار به کانال‌های Storage"}>
      <Stack>
        {rule && (
          <SubBlock title="🤖 اتومیشن — کپی خودکار به کانال‌های Storage"
            hint={<>هر voice/video/photo که توی این چت بیاد، خودکار توی کانال نقش‌دار ست‌شده کپی می‌شه. لوکیشن‌ها و موارد مهم توی{" "}
              <a href="/notes" className="underline inline-block py-3 -my-3">Notes</a> ذخیره می‌شن. کانال‌های هدف باید از{" "}
              <a href="/functions" className="underline inline-block py-3 -my-3">Functions</a>{" "}
              به‌عنوان voice_storage / video_storage / photo_storage / notes_inbox تگ شده باشن.</>}>
            <ToggleList>
              {items.map(([key, label, hint, value]) => (
                <ToggleRow key={key} label={label} hint={hint} checked={Boolean(value)} disabled={saving} onChange={(v) => patchAutomation({ [key]: v })} />
              ))}
            </ToggleList>
          </SubBlock>
        )}
        {rule && <MediaRoutingLog chatId={chatId} />}
      </Stack>
    </Section>
  );
}
