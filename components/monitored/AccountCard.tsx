"use client";

import { useState } from "react";
import Section, { Pill } from "@/components/ui/Section";
import { ToggleList, ToggleRow, Chip } from "@/components/chat-detail/shared";
import { relTime } from "@/lib/format";
import {
  BTN,
  BTN_AMBER,
  BTN_DANGER,
  CHECK_KINDS,
  INTERVAL_OPTIONS,
  SELECT,
  TEHRAN_TRIGGER_HOURS,
  fa,
  intervalLabel,
  type Account,
} from "./shared";

// One monitored account: a 64 px row (status avatar, @username, last check, refresh button) that opens to the
// switches, the polling interval and the destructive actions. Per-account options live in nested Sections.
export default function AccountCard({
  account: a,
  selectMode,
  selected,
  refreshing,
  onToggleSelect,
  onRefresh,
  onPatch,
  onRemove,
}: {
  account: Account;
  selectMode: boolean;
  selected: boolean;
  refreshing: boolean;
  onToggleSelect: (id: number) => void;
  onRefresh: (a: Account) => void;
  onPatch: (id: number, body: Record<string, unknown>) => void | Promise<void>;
  onRemove: (id: number) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const isNotify = a.mode === "notify";
  const enabledKinds = CHECK_KINDS.filter(([k]) => a[k]).map(([, l]) => l.replace(/^\S+\s/, ""));
  const hours = TEHRAN_TRIGGER_HOURS[a.intervalMinutes];

  const ring = a.lastError
    ? "border-rose-500/60 text-rose-300"
    : a.enabled
      ? "border-emerald-500/50 text-emerald-300"
      : "border-[var(--color-border)] text-[var(--color-text-dim)]";

  const rowClick = () => (selectMode ? onToggleSelect(a.id) : setOpen((o) => !o));

  return (
    <div
      className={`rounded-2xl border bg-[var(--color-surface)] min-w-0 overflow-hidden ${
        selected ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]" : "border-[var(--color-border)]"
      }`}
    >
      <div className="flex items-stretch">
        {selectMode && (
          <label className="grid place-items-center w-12 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(a.id)}
              aria-label={`انتخاب @${a.username}`}
              className="!w-5 !h-5"
            />
          </label>
        )}
        <button
          type="button"
          onClick={rowClick}
          aria-expanded={selectMode ? undefined : open}
          className="flex-1 min-w-0 min-h-16 flex items-center gap-3 ps-3 pe-2 py-2 text-center active:bg-[var(--color-surface-2)]"
        >
          <span
            aria-hidden
            className={`grid place-items-center w-11 h-11 rounded-full border-2 bg-[var(--color-surface-2)] text-base font-semibold uppercase shrink-0 ${ring}`}
          >
            {a.username.charAt(0)}
          </span>
          <span className="min-w-0 flex-1">
            <span dir="ltr" className="block text-sm font-semibold truncate">
              @{a.username}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center justify-center gap-1">
              {a.enabled ? <Pill tone="ok">فعال</Pill> : <Pill>خاموش</Pill>}
              {a.lastError && <Pill tone="bad">خطا</Pill>}
              {!a.lastCheckedAt && <Pill>هنوز چک نشده</Pill>}
              {isNotify && <Pill tone="warn">🔔 notify</Pill>}
            </span>
            <span className="block text-xs text-[var(--color-text-dim)] truncate mt-0.5">
              {a.lastCheckedAt ? `چک: ${relTime(a.lastCheckedAt)}` : "—"}
              {!isNotify && ` · هر ${intervalLabel(a.intervalMinutes)}`}
            </span>
          </span>
          {!selectMode && (
            <svg
              aria-hidden
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-[var(--color-text-dim)] transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </button>
        {!selectMode && (
          <div className="shrink-0 flex items-center pe-2">
            <button
              type="button"
              onClick={() => onRefresh(a)}
              disabled={refreshing}
              aria-label={`دوباره گرفتن @${a.username}`}
              title="فقط چیزایی رو که می‌خوای انتخاب کن و دوباره بگیر"
              className="grid place-items-center w-12 h-12 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-lg disabled:opacity-50"
            >
              {refreshing ? "…" : "🔄"}
            </button>
          </div>
        )}
      </div>

      {open && !selectMode && (
        <div className="border-t border-[var(--color-border)] px-3 pb-3 pt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {a.lastStoryAt && <Chip tone="info">آخرین محتوا: {relTime(a.lastStoryAt)}</Chip>}
            <Chip>{isNotify ? "🔔 notify" : `هر ${intervalLabel(a.intervalMinutes)}`}</Chip>
          </div>

          {a.lastError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5">
              <p dir="auto" className="text-xs leading-6 text-rose-200 [overflow-wrap:anywhere]">
                {a.lastError.slice(0, 200)}
              </p>
              <div className="mt-2 flex">
                <button
                  type="button"
                  onClick={() => void onPatch(a.id, { resetError: true })}
                  title="ریست خطا و چک فوری توی cron بعدی"
                  className={BTN_AMBER}
                >
                  🔁 ریست خطا
                </button>
              </div>
            </div>
          )}

          <ToggleList>
            <ToggleRow
              label={a.enabled ? "پایش روشن است" : "پایش خاموش است"}
              hint="خاموش = در cron بررسی نمی‌شود"
              checked={a.enabled}
              onChange={(v) => void onPatch(a.id, { enabled: v })}
            />
          </ToggleList>

          <Section
            icon="🎯"
            title="چه چیزهایی گرفته بشه؟"
            summary={enabledKinds.length > 0 ? enabledKinds.join(" · ") : "هیچ‌کدام"}
            className="!mb-0"
          >
            <ToggleList>
              {CHECK_KINDS.map(([key, label]) => (
                <ToggleRow
                  key={key}
                  label={label}
                  checked={a[key]}
                  onChange={(v) => void onPatch(a.id, { [key]: v })}
                />
              ))}
            </ToggleList>
          </Section>

          <Section
            icon="⏱"
            title="بازه‌ی بررسی"
            summary={isNotify ? "🔔 notify" : intervalLabel(a.intervalMinutes)}
            className="!mb-0"
          >
            <select
              value={isNotify ? "notify" : String(a.intervalMinutes)}
              onChange={(e) => {
                if (e.target.value === "notify") {
                  void onPatch(a.id, { mode: "notify" });
                } else {
                  void onPatch(a.id, {
                    mode: "interval",
                    intervalMinutes: Number(e.target.value),
                  });
                }
              }}
              aria-label="بازه‌ی بررسی"
              className={SELECT}
            >
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {intervalLabel(m)}
                </option>
              ))}
              <option value="notify">🔔 notify</option>
            </select>
            {!isNotify && hours && (
              <p className="mt-2 text-xs leading-6 text-[var(--color-text-dim)]">
                ساعت‌های اجرا (تهران): <bdi dir="ltr">{hours.map((h) => `${fa(h)}:۰۰`).join(" ، ")}</bdi>
              </p>
            )}
          </Section>

          <div className="flex flex-wrap items-center gap-2 [justify-content:left]">
            <a
              href={a.url ?? `https://instagram.com/${a.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className={BTN}
            >
              ↗ اینستاگرام
            </a>
            <button type="button" onClick={() => void onRemove(a.id)} className={BTN_DANGER}>
              🗑 حذف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
