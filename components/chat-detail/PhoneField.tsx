"use client";

import { useCallback, useState } from "react";
import { ActionRow, Note, btnCls, btnPrimaryCls, inputCls } from "./shared";

// Inline editor for chat_rules.phone_number. Saves on blur or when the operator taps the save button;
// flashes "ذخیره شد" briefly.
export default function PhoneField({ chatId, initial, onSaved }: { chatId: number; initial: string | null; onSaved?: () => void }) {
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
    <div>
      <input type="tel" dir="ltr" aria-label="شماره تلفن" value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
        placeholder="+989123456789" disabled={saving} className={`${inputCls} tabular-nums text-center`} />
      <ActionRow>
        <button type="button" onClick={save} disabled={saving || value === baseline} className={btnPrimaryCls}>ذخیره</button>
        {baseline && <button type="button" onClick={clear} disabled={saving} className={btnCls}>پاک کن</button>}
      </ActionRow>
      {status && <Note>{status}</Note>}
    </div>
  );
}
