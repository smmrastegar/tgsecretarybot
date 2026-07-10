"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type Item = {
  id: number;
  messageId: number | null;
  tgMessageId: number | null;
  chatId: number | null;
  chatTitle: string | null;
  senderName: string | null;
  kind: string;
  priority: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  location: string | null;
  participants: string[] | null;
  sourceText: string | null;
  doneAt: string | null;
  createdAt: string;
};

const PRIORITY_LABEL: Record<
  string,
  { label: string; tone: "danger" | "warn" | "neutral" | "info" }
> = {
  urgent: { label: "🔴 فوری", tone: "danger" },
  high: { label: "🟠 مهم", tone: "warn" },
  normal: { label: "عادی", tone: "neutral" },
  low: { label: "کم", tone: "info" },
};

function googleCalendarUrl(it: Item): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", it.title);
  if (it.dueAt) {
    // Google Calendar uses YYYYMMDDTHHmmssZ format. Default duration 1 hour
    // when we have a start time.
    const start = new Date(it.dueAt);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const fmt = (d: Date) =>
        d
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, "");
      params.set("dates", `${fmt(start)}/${fmt(end)}`);
    }
  }
  const details: string[] = [];
  if (it.description) details.push(it.description);
  if (it.senderName) details.push(`از: ${it.senderName}`);
  if (it.sourceText) details.push(`\nمتن اصلی:\n${it.sourceText}`);
  if (details.length > 0) params.set("details", details.join("\n"));
  if (it.location) params.set("location", it.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const KIND_LABEL: Record<
  string,
  { label: string; tone: "info" | "warn" | "success" | "danger" | "neutral" }
> = {
  event: { label: "📅 رویداد", tone: "info" },
  task: { label: "✅ کار", tone: "warn" },
  reminder: { label: "🔔 یادآوری", tone: "warn" },
  deadline: { label: "⏳ ددلاین", tone: "danger" },
  decision: { label: "🗳 تصمیم", tone: "neutral" },
  note: { label: "📝 نکته", tone: "neutral" },
};

function fmtDue(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function dueChip(s: string | null): { text: string; tone: "danger" | "warn" | "neutral" } | null {
  if (!s) return null;
  const d = new Date(s);
  const ms = d.getTime() - Date.now();
  const days = ms / 86_400_000;
  if (days < 0) return { text: "عقب‌افتاده", tone: "danger" };
  if (days < 1) return { text: "امروز", tone: "warn" };
  if (days < 2) return { text: "فردا", tone: "warn" };
  if (days < 7) return { text: `${Math.ceil(days)} روز دیگه`, tone: "neutral" };
  return null;
}

const BULK_KIND_OPTIONS = [
  "event",
  "task",
  "reminder",
  "deadline",
  "decision",
  "note",
  "action",
] as const;

export default function RemindersPage() {
  const [filter, setFilter] = useState<"upcoming" | "all" | "done">("upcoming");
  const [priorityFilter, setPriorityFilter] = useState<
    "all" | "urgent" | "high" | "normal" | "low"
  >("all");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSource, setExpandedSource] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);
  const toggleSource = (id: number) =>
    setExpandedSource((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/reminders?filter=${filter}&priority=${priorityFilter}`,
    );
    if (!r.ok) {
      setLoading(false);
      return;
    }
    const j = (await r.json()) as { items: Item[] };
    setItems(j.items);
    setSelected(new Set());
    setLoading(false);
  }, [filter, priorityFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(items.map((it) => it.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function runBulk(
    op: "done" | "undone" | "delete" | "set_kind",
    kind?: string,
  ) {
    if (selected.size === 0) return;
    if (op === "delete") {
      if (!confirm(`حذف ${selected.size} مورد؟`)) return;
    }
    setBulking(true);
    try {
      const r = await fetch("/api/reminders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: [...selected], kind }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`عملیات شکست خورد: ${j.error ?? r.status}`);
      } else {
        await load();
      }
    } finally {
      setBulking(false);
    }
  }

  async function setDone(id: number, done: boolean) {
    await fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    load();
  }

  return (
    <Shell>
      <PageTitle
        title="کارها"
        subtitle="کارها، رویدادها، یادآوری‌ها و نکته‌هایی که از پیام‌ها استخراج شده. ریمایندر فقط یک نوع از actionهاست."
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex gap-1">
              {(["upcoming", "all", "done"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${
                    filter === f
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white"
                      : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <select
              value={priorityFilter}
              onChange={(e) =>
                setPriorityFilter(
                  e.target.value as
                    | "all"
                    | "urgent"
                    | "high"
                    | "normal"
                    | "low",
                )
              }
              className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
            >
              <option value="all">همه‌ی اولویت‌ها</option>
              <option value="urgent">🔴 فوری</option>
              <option value="high">🟠 مهم</option>
              <option value="normal">عادی</option>
              <option value="low">کم</option>
            </select>
          </div>
        }
      />

      {loading ? (
        <Card>در حال بارگذاری…</Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هنوز چیزی نیست. روی هر پیامی توی «همه‌ی پیام‌ها» یا «فوری» دکمه‌ی
            «🧠 استخراج» رو بزن تا AI تاریخ‌ها، کارها و یادآوری‌ها رو ازش بیرون بکشه.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-3 !p-3 sticky top-0 z-10">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <button
                onClick={selectAll}
                disabled={bulking}
                className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                انتخاب همه ({items.length})
              </button>
              <button
                onClick={selectNone}
                disabled={bulking || selected.size === 0}
                className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                پاک کردن
              </button>
              <span className="text-[var(--color-text-dim)]">
                {selected.size} انتخاب‌شده
              </span>
              <span className="text-[var(--color-text-dim)] mx-1">|</span>
              <button
                onClick={() => runBulk("done")}
                disabled={bulking || selected.size === 0}
                className="px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
              >
                ✓ انجام شد
              </button>
              <button
                onClick={() => runBulk("undone")}
                disabled={bulking || selected.size === 0}
                className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                برگرداندن به انجام‌نشده
              </button>
              <button
                onClick={() => runBulk("delete")}
                disabled={bulking || selected.size === 0}
                className="px-2 py-1 rounded-md border border-red-800 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
              >
                🗑 حذف
              </button>
              <select
                disabled={bulking || selected.size === 0}
                onChange={(e) => {
                  const k = e.target.value;
                  if (!k) return;
                  void runBulk("set_kind", k);
                  e.currentTarget.value = "";
                }}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                defaultValue=""
              >
                <option value="">تغییر نوع به…</option>
                {BULK_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </Card>
          <div className="flex flex-col gap-2">
          {items.map((it) => {
            const kindInfo = KIND_LABEL[it.kind] ?? KIND_LABEL.note!;
            const due = dueChip(it.dueAt);
            return (
              <Card
                key={it.id}
                className={`!p-3 ${
                  selected.has(it.id)
                    ? "ring-1 ring-[var(--color-accent)]"
                    : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggleSelect(it.id)}
                    className="mt-1 shrink-0"
                  />
                <div className="flex items-start justify-between gap-3 flex-wrap flex-1 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={kindInfo.tone}>{kindInfo.label}</Badge>
                      {it.priority && it.priority !== "normal" && (
                        <Badge
                          tone={
                            (PRIORITY_LABEL[it.priority] ?? PRIORITY_LABEL.normal!)
                              .tone
                          }
                        >
                          {(PRIORITY_LABEL[it.priority] ?? PRIORITY_LABEL.normal!)
                            .label}
                        </Badge>
                      )}
                      {due && <Badge tone={due.tone}>{due.text}</Badge>}
                      {it.doneAt && <Badge tone="success">انجام‌شده</Badge>}
                    </div>
                    <div
                      dir="auto"
                      className="mt-2 font-medium break-words"
                    >
                      {it.title}
                    </div>
                    {it.description && (
                      <div
                        dir="auto"
                        className="text-sm text-[var(--color-text-dim)] mt-1 break-words"
                      >
                        {it.description}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-[var(--color-text-dim)] flex flex-wrap gap-x-3 gap-y-1">
                      {fmtDue(it.dueAt) && <span>🗓 {fmtDue(it.dueAt)}</span>}
                      {it.location && <span>📍 {it.location}</span>}
                      {it.participants && it.participants.length > 0 && (
                        <span>👥 {it.participants.join(", ")}</span>
                      )}
                      {it.chatId && it.senderName && (
                        <span>
                          از{" "}
                          <Link
                            href={`/chats/${it.chatId}`}
                            className="underline"
                          >
                            {it.senderName}
                          </Link>
                        </span>
                      )}
                      <span>{relTime(it.createdAt)}</span>
                    </div>
                    {it.sourceText && (
                      <div className="mt-2">
                        <button
                          onClick={() => toggleSource(it.id)}
                          className="text-[11px] text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
                        >
                          {expandedSource.has(it.id)
                            ? "مخفی کردن پیام اصلی ▴"
                            : "نمایش پیام اصلی ▾"}
                        </button>
                        {expandedSource.has(it.id) && (
                          <div
                            dir="auto"
                            className="mt-1 p-2 rounded-md bg-[var(--color-surface-2)] text-xs whitespace-pre-wrap break-words border border-[var(--color-border)]"
                          >
                            {it.sourceText}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <a
                        href={googleCalendarUrl(it)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                        title="باز کردن رویداد ازپیش‌پرشده‌ی Google Calendar در تب جدید"
                      >
                        📅 افزودن به Google Calendar
                      </a>
                    </div>
                  </div>
                  <button
                    onClick={() => setDone(it.id, !it.doneAt)}
                    className={`text-xs px-3 py-1.5 rounded-md border ${
                      it.doneAt
                        ? "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                        : "border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
                    }`}
                  >
                    {it.doneAt ? "برگرداندن به انجام‌نشده" : "انجام شد"}
                  </button>
                </div>
                </div>
              </Card>
            );
          })}
          </div>
        </>
      )}
    </Shell>
  );
}
