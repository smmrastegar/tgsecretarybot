"use client";

import Section from "@/components/ui/Section";
import { Stack, ToggleRow, fmtFollowUpDuration, inputCls } from "./shared";
import type { Rule } from "./types";

type Patch = { enabled?: boolean; thresholdHours?: number; escalateHours?: number };
const FIRST = [
  { label: "۱۵ دقیقه", v: 0.25 },
  { label: "نیم ساعت", v: 0.5 },
  { label: "۱ ساعت", v: 1 },
  { label: "۲ ساعت", v: 2 },
  { label: "۴ ساعت", v: 4 },
];
const ESCALATE = [
  { label: "۱۵ دقیقه", v: 0.25 },
  { label: "نیم ساعت", v: 0.5 },
  { label: "۱ ساعت", v: 1 },
  { label: "۴ ساعت", v: 4 },
  { label: "۱۲ ساعت", v: 12 },
];

// A number input (hours) with preset chips. Commits on blur or on a chip tap, like the original fields.
function HoursField({ label, field, value, presets, disabled, onPatch }: {
  label: string; field: "thresholdHours" | "escalateHours"; value: number; presets: { label: string; v: number }[]; disabled: boolean; onPatch: (p: Patch) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label} <span className="text-xs font-normal text-[var(--color-text-dim)]">(ساعت)</span></label>
      <input type="number" min={0.25} max={168} step={0.25} defaultValue={value} key={`${field}-${value}`} disabled={disabled} dir="ltr"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0) onPatch({ [field]: v });
        }}
        className={`${inputCls} text-center tabular-nums`} />
      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
        {presets.map((p) => (
          <button key={p.v} type="button" disabled={disabled} onClick={() => onPatch({ [field]: p.v })}
            className={`min-h-10 px-3 rounded-xl border text-xs disabled:opacity-50 ${value === p.v
              ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
              : "bg-[var(--color-surface-2)] border-[var(--color-border)] active:bg-[var(--color-surface)]"}`}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}

// "Remind me when I have not answered" for this chat.
export default function FollowUpSection({ rule, saving, patchFollowUp }: { rule: Rule | null; saving: boolean; patchFollowUp: (p: Patch) => void }) {
  const enabled = Boolean(rule?.followUpEnabled ?? true);
  const th = rule?.followUpThresholdHours ?? 2;
  const esc = rule?.followUpEscalateHours ?? 12;
  return (
    <Section icon="⏰" title="یادآور جواب‌ندادن" summary={enabled ? `فعال · بعد از ${fmtFollowUpDuration(th)}` : "خاموش"}>
      <Stack>
        <ToggleRow label="یادآور برای این چت فعال باشه"
          hint={`وقتی این شخص پیام بده و شما بیشتر از ${fmtFollowUpDuration(th)} جواب ندید، توی کانال notes_inbox یه پینگ می‌فرسته با خلاصه‌ی پیام‌ها. اگه بازم ${fmtFollowUpDuration(esc)} بگذره و جواب ندید، escalate می‌کنه.`}
          checked={enabled} disabled={saving} onChange={(v) => patchFollowUp({ enabled: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <HoursField label="آستانه‌ی اول" field="thresholdHours" value={th} presets={FIRST} disabled={saving || !enabled} onPatch={patchFollowUp} />
          <HoursField label="escalate بعد از" field="escalateHours" value={esc} presets={ESCALATE} disabled={saving || !enabled} onPatch={patchFollowUp} />
        </div>
      </Stack>
    </Section>
  );
}
