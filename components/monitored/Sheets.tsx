"use client";

import { Field } from "@/components/chat-detail/shared";
import Sheet from "./Sheet";
import { BTN, BTN_DANGER, BTN_PRIMARY, FIELD, fa, type RefreshDraft } from "./shared";

type Flag = "stories" | "posts" | "reels" | "mentioned";
type CountKey = "countStories" | "countPosts" | "countReels" | "countMentioned";

const ROWS: ReadonlyArray<readonly [Flag, string, CountKey]> = [
  ["stories", "📸 Stories", "countStories"],
  ["posts", "🖼 Posts", "countPosts"],
  ["reels", "🎬 Reels", "countReels"],
  ["mentioned", "🏷 Mentioned (در پست‌های دیگران تگ شده)", "countMentioned"],
];

// "Fetch again": pick which kinds to pull and how many of the latest of each.
export function RefreshSheet({
  draft,
  onChange,
  onClose,
  onRun,
}: {
  draft: RefreshDraft;
  onChange: (d: RefreshDraft) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const none = !draft.stories && !draft.posts && !draft.reels && !draft.mentioned;
  return (
    <Sheet
      title={
        <>
          🔄 دوباره گرفتن <bdi dir="ltr">@{draft.username}</bdi>
        </>
      }
      subtitle="کدوم‌ها رو می‌خوای + چند تای آخر هر کدوم"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onRun} disabled={none} className={BTN_PRIMARY}>
            بگیر
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            لغو
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {ROWS.map(([flag, label, countKey]) => (
          <div
            key={flag}
            className={`rounded-xl border px-3 py-2.5 ${
              draft[flag]
                ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/5"
                : "border-[var(--color-border)]"
            }`}
          >
            <button
              type="button"
              role="switch"
              aria-checked={draft[flag]}
              onClick={() => onChange({ ...draft, [flag]: !draft[flag] })}
              className="w-full min-h-11 flex items-center gap-3 text-center"
            >
              <span
                aria-hidden
                className={`grid place-items-center w-6 h-6 rounded-md border shrink-0 text-sm ${
                  draft[flag]
                    ? "bg-[var(--color-accent)] border-transparent text-white"
                    : "border-[var(--color-border)]"
                }`}
              >
                {draft[flag] ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1 leading-6">{label}</span>
            </button>
            <div className="mt-1 flex items-center justify-center gap-2">
              <label htmlFor={`cnt-${flag}`} className="text-xs text-[var(--color-text-dim)]">
                تعداد:
              </label>
              <input
                id={`cnt-${flag}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                disabled={!draft[flag]}
                value={draft[countKey]}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    [countKey]: Math.max(1, Math.min(20, Number(e.target.value) || 3)),
                  })
                }
                className={`${FIELD} !w-24 text-center`}
              />
            </div>
          </div>
        ))}
        <p className="text-xs leading-6 text-[var(--color-text-dim)]">
          هر مورد تا {fa(20)} تا — هر بار گرفتن هزینه‌ی HikerAPI دارد.
        </p>
      </div>
    </Sheet>
  );
}

// Set (or clear) the HikerAPI key from the dashboard — stored server-side, preferred over the env var.
export function KeySheet({
  keyPrefix,
  keyName,
  keySource,
  keyInput,
  keyNameInput,
  saving,
  onKeyInput,
  onKeyNameInput,
  onClose,
  onSave,
  onClear,
}: {
  keyPrefix: string | null;
  keyName: string | null;
  keySource: "tenant" | "db" | "env" | null;
  keyInput: string;
  keyNameInput: string;
  saving: boolean;
  onKeyInput: (v: string) => void;
  onKeyNameInput: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <Sheet
      title="🔑 کلید HikerAPI"
      subtitle="کلید رو اینجا ست کن. توی DB ذخیره می‌شه (با redact) و بر env var ترجیح داده می‌شه. خالی بذار تا fallback به env."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onSave} disabled={saving || !keyInput.trim()} className={BTN_PRIMARY}>
            {saving ? "ذخیره…" : "💾 ذخیره"}
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            لغو
          </button>
          <button type="button" onClick={onClear} className={BTN_DANGER} title="override رو پاک کن، fallback به env">
            🗑 پاک کردن override
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {keyPrefix && (
          <div dir="ltr" className="text-xs font-mono text-[var(--color-text-dim)] break-all">
            فعلاً: {keyName ? `[${keyName}] ` : ""}
            {keyPrefix} ({keySource})
          </div>
        )}
        <Field label="کلید جدید">
          <input
            dir="ltr"
            type="password"
            value={keyInput}
            onChange={(e) => onKeyInput(e.target.value)}
            placeholder="x-access-key"
            autoComplete="off"
            className={`${FIELD} font-mono`}
          />
        </Field>
        <Field label="نام (اختیاری — مثل smmr)">
          <input
            dir="ltr"
            type="text"
            value={keyNameInput}
            onChange={(e) => onKeyNameInput(e.target.value)}
            placeholder="smmr"
            autoComplete="off"
            className={FIELD}
          />
        </Field>
      </div>
    </Sheet>
  );
}
