"use client";

import { useCallback, useState } from "react";

// Inline editor for chat_rules.phone_number. Saves on blur or when
// the operator clicks the ✓ button; flashes "ذخیره شد" briefly.
export default function PhoneInput({
  chatId,
  initial,
  onSaved,
}: {
  chatId: number;
  initial: string | null;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const baseline = initial ?? "";

  const save = useCallback(async () => {
    if (value === baseline) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/phone`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: value || null }),
      });
      if (r.ok) {
        setStatus("✓ ذخیره شد");
        setTimeout(() => setStatus(null), 1500);
        onSaved?.();
      } else {
        setStatus(`خطا ${r.status}`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [chatId, value, baseline, onSaved]);

  const clear = useCallback(async () => {
    setValue("");
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/phone`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: null }),
      });
      if (r.ok) {
        setStatus("✓ پاک شد");
        setTimeout(() => setStatus(null), 1500);
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  }, [chatId, onSaved]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="tel"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        placeholder="+989123456789"
        disabled={saving}
        className="flex-1 min-w-[180px] text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5 tabular-nums disabled:opacity-50"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || value === baseline}
        className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
      >
        ذخیره
      </button>
      {baseline && (
        <button
          type="button"
          onClick={clear}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          پاک کن
        </button>
      )}
      {status && (
        <span className="text-[11px] text-[var(--color-text-dim)]">
          {status}
        </span>
      )}
    </div>
  );
}
