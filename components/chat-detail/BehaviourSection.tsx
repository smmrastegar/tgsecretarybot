"use client";

import Link from "next/link";
import Section from "@/components/ui/Section";
import { relTime } from "@/lib/format";
import { Field, Note, Stack, SubBlock, ToggleList, ToggleRow, inputCls } from "./shared";
import { MODE_LABELS, type ChatMode, type ProfileSummary, type Rule } from "./types";

// How the bot treats this chat: mode, VIP / mute, who the secretary forwards to, and the chat profile.
export default function BehaviourSection({ rule, secretaries, profiles, saving, patchRule, patchProfile }: {
  rule: Rule | null;
  secretaries: { userId: number; name: string }[];
  profiles: ProfileSummary[];
  saving: boolean;
  patchRule: (patch: Record<string, unknown>) => Promise<void>;
  patchProfile: (profileId: number | null) => Promise<void>;
}) {
  const mode = rule?.mode ?? "off";
  const summary = [MODE_LABELS[mode], rule?.vip && "⭐ VIP", rule?.muted && "بی‌صدا"].filter(Boolean).join(" · ");
  return (
    <Section icon="🎛" title="رفتار ربات" summary={summary} defaultOpen>
      <Stack>
        <div>
          <Field label="حالت" hint={rule?.modeChangedAt ? `تغییر یافت ${relTime(rule.modeChangedAt)}` : undefined}>
            <select disabled={saving} value={mode} onChange={(e) => patchRule({ mode: e.target.value as ChatMode })} className={inputCls}>
              {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                <option key={m} value={m}>{MODE_LABELS[m]}</option>
              ))}
            </select>
          </Field>
          {mode === "secretary" && secretaries.length > 0 && (
            <div className="mt-3">
              <Field label="فوروارد به" hint={rule?.secretaryUserId ? "override فعال" : undefined}>
                <select disabled={saving} value={String(rule?.secretaryUserId ?? "")}
                  onChange={(e) => patchRule({ secretaryUserId: e.target.value ? Number(e.target.value) : null })} className={inputCls}>
                  <option value="">پیش‌فرض ({secretaries[0]?.name ?? "—"})</option>
                  {secretaries.map((s) => (
                    <option key={s.userId} value={s.userId}>{s.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>

        <ToggleList>
          <ToggleRow label={rule?.vip ? "★ VIP روشن" : "علامت VIP"} hint="چت مهم؛ مکث بعد از پیام شما برایش اعمال نمی‌شه" checked={Boolean(rule?.vip)} disabled={saving}
            onChange={(v) => patchRule({ vip: v })} />
          <ToggleRow label={rule?.muted ? "🔕 بی‌صدا" : "بی‌صدا کن"} hint="این چت رو بی‌صدا علامت می‌زنه" checked={Boolean(rule?.muted)} disabled={saving}
            onChange={(v) => patchRule({ muted: v })} />
        </ToggleList>

        <SubBlock title="👤 پروفایل چت"
          hint={<>هر چت عضو یه پروفایله؛ اگه انتخاب نکنی، خودکار «پیش‌فرض» می‌شه. مدیریت پروفایل‌ها توی{" "}
            <Link href="/chat-profiles" className="text-[var(--color-accent)] underline inline-block py-3 -my-3" dir="ltr">/chat-profiles</Link>.</>}>
          <select aria-label="پروفایل چت" value={rule?.profileId ?? profiles.find((p) => p.isDefault)?.id ?? ""} disabled={saving}
            onChange={(e) => patchProfile(Number(e.target.value))} className={inputCls}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.emoji ?? ""} {p.name}{p.isDefault ? " (پیش‌فرض)" : ""}</option>
            ))}
          </select>
          {profiles.length === 0 && <Note>پروفایلی بارگذاری نشد.</Note>}
        </SubBlock>
      </Stack>
    </Section>
  );
}
