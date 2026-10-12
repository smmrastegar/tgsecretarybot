"use client";

import { useState } from "react";
import { BTN, BTN_AMBER, BTN_DANGER, BTN_OK, CHECK_KINDS, INTERVAL_OPTIONS, SELECT, fa, intervalLabel } from "./shared";

// Sticky bar (above the phone tab bar) shown while accounts are selected: count + the bulk actions.
export default function BulkBar({
  count,
  bulking,
  onRun,
}: {
  count: number;
  bulking: boolean;
  onRun: (op: "update" | "delete", patch?: Record<string, unknown>) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky bottom-[4.5rem] md:bottom-4 z-20 mt-3 rounded-2xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 shadow-2xl text-center">
      {open && (
        <div className="mb-3 max-h-[55vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void onRun("update", { enabled: true })}
              disabled={bulking}
              className={BTN_OK}
            >
              ▶ روشن کردن همه
            </button>
            <button
              type="button"
              onClick={() => void onRun("update", { enabled: false })}
              disabled={bulking}
              className={BTN}
            >
              ⏸ خاموش کردن همه
            </button>
          </div>
          <select
            disabled={bulking}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              void onRun("update", { intervalMinutes: Number(v) });
              e.currentTarget.value = "";
            }}
            aria-label="ست کردن interval"
            className={`${SELECT} mt-2`}
          >
            <option value="">⏱ ست interval…</option>
            {INTERVAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {intervalLabel(m)}
              </option>
            ))}
          </select>
          <div className="mt-2 flex flex-col gap-2">
            {CHECK_KINDS.map(([key, label]) => (
              <div
                key={key}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2"
              >
                <div className="text-sm leading-6">{label}</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void onRun("update", { [key]: true })}
                    disabled={bulking}
                    className={BTN}
                  >
                    + روشن
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRun("update", { [key]: false })}
                    disabled={bulking}
                    className={BTN}
                    title={`${label} خاموش`}
                  >
                    − خاموش
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void onRun("update", { resetError: true })}
              disabled={bulking}
              className={BTN_AMBER}
              title="last_error رو پاک می‌کنه و همه رو توی cron بعدی چک می‌کنه"
            >
              🔁 ریست خطاها
            </button>
            <button type="button" onClick={() => void onRun("delete")} disabled={bulking} className={BTN_DANGER}>
              🗑 حذف همه
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{fa(count)} انتخاب شده</span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={BTN}>
          {open ? "▾ بستن" : "▴ عملیات گروهی"}
        </button>
      </div>
    </div>
  );
}
