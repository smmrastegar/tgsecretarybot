"use client";

import Link from "next/link";
import Section, { Pill } from "@/components/ui/Section";
import { Field, Chip, ToggleList, ToggleRow } from "@/components/chat-detail/shared";
import {
  BTN,
  BTN_PRIMARY,
  CHECK_KINDS,
  FIELD,
  INTERVAL_OPTIONS,
  SELECT,
  chatLabel,
  fa,
  intervalLabel,
  type ChatBrief,
  type Defaults,
} from "./shared";

// Where forwarded media goes: the storage channels (or, failing that, downloader chats as fallback).
export function StorageSection({
  storageChats,
  downloaderChats,
  targetChatId,
}: {
  storageChats: ChatBrief[];
  downloaderChats: ChatBrief[];
  targetChatId: number | null;
}) {
  const none = storageChats.length === 0 && downloaderChats.length === 0;
  const shown = storageChats.length > 0 ? storageChats : downloaderChats;
  return (
    <Section
      icon="📦"
      title="کانال‌های Storage"
      summary={none ? "کانالی ست نشده" : `${fa(shown.length)} کانال`}
      badge={none ? <Pill tone="bad">!</Pill> : undefined}
      className="!mb-0"
    >
      {none ? (
        <p className="text-sm leading-7 text-red-300">
          ⚠️ هیچ کانالی با role=storage ست نشده. برو /chats و یه کانال رو role «📦 Storage» بده.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((c) => (
            <Link
              key={c.chatId}
              href={`/chats/${c.chatId}`}
              className="min-h-14 flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2 active:bg-[var(--color-surface-2)]"
            >
              <span aria-hidden className="text-xl shrink-0">
                {storageChats.length > 0 ? "📦" : "📥"}
              </span>
              <span dir="auto" className="min-w-0 flex-1 text-sm font-medium truncate">
                {chatLabel(c)}
              </span>
              {targetChatId === c.chatId && (
                <Chip tone={storageChats.length > 0 ? "success" : "warn"}>
                  {storageChats.length > 0 ? "✓ فعال" : "fallback"}
                </Chip>
              )}
            </Link>
          ))}
          <p className="text-xs leading-6 text-[var(--color-text-dim)]">
            اولین storage chat به‌عنوان مقصد استفاده می‌شه. اگه storage نباشه، اولین downloader fallback می‌شه.
          </p>
        </div>
      )}
    </Section>
  );
}

// Defaults every NEW account is created with (manual add or CSV).
export function DefaultsSection({
  defaults,
  onSave,
}: {
  defaults: Defaults;
  onSave: (next: Partial<Defaults>) => void;
}) {
  return (
    <Section
      icon="⚙️"
      title="پیش‌فرض اکانت‌های جدید"
      summary={`هر ${intervalLabel(defaults.intervalMinutes)}`}
      className="!mb-0"
    >
      <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
        وقتی اکانت جدید اضافه می‌کنی (دستی یا CSV)، با این پیش‌فرض‌ها ساخته می‌شه.
      </p>
      <ToggleList>
        {CHECK_KINDS.map(([key, label]) => (
          <ToggleRow key={key} label={label} checked={defaults[key]} onChange={(v) => onSave({ [key]: v })} />
        ))}
      </ToggleList>
      <div className="mt-3">
        <Field label="بازه‌ی بررسی پیش‌فرض">
          <select
            value={defaults.intervalMinutes}
            onChange={(e) => onSave({ intervalMinutes: Number(e.target.value) })}
            className={SELECT}
          >
            {INTERVAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {intervalLabel(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Section>
  );
}

// Add one account by username, or import many from a CSV file.
export function AddAccountSection({
  value,
  adding,
  importing,
  open,
  onOpenChange,
  onChange,
  onAdd,
  onImport,
}: {
  value: string;
  adding: boolean;
  importing: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChange: (v: string) => void;
  onAdd: () => void;
  onImport: (f: File) => void;
}) {
  return (
    <Section
      icon="➕"
      title="اضافه کردن اکانت"
      summary="یک username یا فایل CSV"
      open={open}
      onOpenChange={onOpenChange}
    >
      <Field label="username اینستاگرام">
        <input
          dir="ltr"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          placeholder="مثل ali_chaychi_"
          autoCapitalize="none"
          autoCorrect="off"
          className={FIELD}
        />
      </Field>
      <div className="mt-3 flex flex-wrap items-center gap-2 [justify-content:left]">
        <button type="button" onClick={onAdd} disabled={adding || !value.trim()} className={BTN_PRIMARY}>
          {adding ? "در حال افزودن…" : "+ افزودن"}
        </button>
        <label className={`${BTN} cursor-pointer ${importing ? "opacity-50 pointer-events-none" : ""}`}>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.currentTarget.value = "";
            }}
            className="hidden"
          />
          {importing ? "آپلود…" : "📤 آپلود CSV"}
        </label>
      </div>
    </Section>
  );
}
