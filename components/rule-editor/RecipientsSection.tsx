"use client";

import { useState } from "react";
import { btnPrimary, Field, inputCls, Note, type Recipient } from "./shared";

// The recipients list + add form of the rule editor.
export default function RecipientsSection({
  recipients,
  busyMap,
  testStatus,
  newChat,
  newLabel,
  adding,
  onNewChat,
  onNewLabel,
  onAdd,
  onPause,
  onRemove,
  onRename,
  onTest,
}: {
  recipients: Recipient[];
  busyMap: Record<number, boolean>;
  testStatus: Record<number, string>;
  newChat: string;
  newLabel: string;
  adding: boolean;
  onNewChat: (v: string) => void;
  onNewLabel: (v: string) => void;
  onAdd: () => void;
  onPause: (chatId: number, paused: boolean) => void;
  onRemove: (chatId: number) => void;
  onRename: (chatId: number, label: string) => Promise<void>;
  onTest: (chatId: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-text-dim)] leading-6">
        chat_id کاربر (مثبت) یا گروه/کانال (منفی). گیرنده باید قبلاً به بات
        /start زده باشه یا بات تو گروه/کانال عضو باشه.
      </p>
      {recipients.length === 0 ? (
        <Note tone="warn">هیچ گیرنده‌ای ست نشده — پیام‌های match‌شده فقط لاگ می‌شن.</Note>
      ) : (
        <div className="flex flex-col gap-2">
          {recipients.map((r) => (
            <RecipientRow
              key={r.recipientChatId}
              r={r}
              busy={!!busyMap[r.recipientChatId]}
              testStatus={testStatus[r.recipientChatId]}
              onPause={() => onPause(r.recipientChatId, !r.paused)}
              onRemove={() => onRemove(r.recipientChatId)}
              onRename={(label) => onRename(r.recipientChatId, label)}
              onTest={() => onTest(r.recipientChatId)}
            />
          ))}
        </div>
      )}
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-3 flex flex-col gap-2">
        <Field label="افزودن گیرنده">
          <input type="number" dir="ltr" value={newChat} onChange={(e) => onNewChat(e.target.value)} placeholder="chat_id" className={inputCls} />
          <input type="text" value={newLabel} onChange={(e) => onNewLabel(e.target.value)} placeholder="label (اختیاری)" className={inputCls} />
        </Field>
        <div className="flex gap-2">
          <button onClick={onAdd} disabled={!newChat || adding} className={btnPrimary}>
            {adding ? "…" : "+ اضافه"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One recipient row: inline rename + per-action loading, no page reload.
function RecipientRow({
  r,
  busy,
  testStatus,
  onPause,
  onRemove,
  onRename,
  onTest,
}: {
  r: Recipient;
  busy: boolean;
  testStatus?: string;
  onPause: () => void;
  onRemove: () => void;
  onRename: (label: string) => Promise<void>;
  onTest: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(r.recipientLabel ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onRename(label);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  const act = "min-h-10 px-1 rounded-lg border text-xs disabled:opacity-50";
  return (
    <div
      className={`p-3 rounded-xl text-xs flex flex-col gap-2.5 ${
        r.paused ? "bg-amber-500/5 border border-amber-500/30" : "bg-[var(--color-surface-2)]"
      } ${busy ? "opacity-60" : ""}`}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            dir="auto"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="اسم گیرنده"
            className="w-full min-h-11 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3"
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="min-h-10 px-4 rounded-lg border border-[var(--color-accent)] text-[var(--color-accent)] text-xs disabled:opacity-50">
              {saving ? "…" : "ذخیره"}
            </button>
            <button
              onClick={() => {
                setLabel(r.recipientLabel ?? "");
                setEditing(false);
              }}
              className="min-h-10 px-4 rounded-lg border border-[var(--color-border)] text-xs"
            >
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {r.recipientLabel || <span className="text-[var(--color-text-dim)] font-normal">بدون‌نام</span>}
            </div>
            <div dir="ltr" className="text-xs text-[var(--color-text-dim)] tabular-nums">{r.recipientChatId}</div>
            {r.paused && (
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200">⏸ متوقف</span>
            )}
          </div>
          {testStatus && (
            <div className={`text-xs leading-6 whitespace-pre-line [overflow-wrap:anywhere] ${testStatus.startsWith("✓") ? "text-emerald-300" : testStatus.startsWith("⏳") ? "text-[var(--color-text-dim)]" : "text-red-300"}`}>
              {testStatus}
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            <button onClick={() => setEditing(true)} title="ویرایش اسم" className={`${act} border-[var(--color-border)]`}>
              ✏️ نام
            </button>
            <button
              onClick={onPause}
              disabled={busy}
              className={`${act} ${r.paused ? "border-emerald-500/40 text-emerald-200" : "border-amber-500/40 text-amber-200"}`}
              title={r.paused ? "ادامه‌ی ارسال به این گیرنده" : "توقف موقت ارسال (بدون حذف)"}
            >
              {busy ? "…" : r.paused ? "▶️ ادامه" : "⏸ توقف"}
            </button>
            <button onClick={onTest} className={`${act} border-[var(--color-border)]`} title="یه پیام تست از bot بفرست">
              🧪 تست
            </button>
            <button onClick={onRemove} disabled={busy} className={`${act} border-red-700/60 text-red-300`}>
              ✕ حذف
            </button>
          </div>
        </>
      )}
    </div>
  );
}
