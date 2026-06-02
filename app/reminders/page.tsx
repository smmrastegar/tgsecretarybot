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
  title: string;
  description: string | null;
  dueAt: string | null;
  location: string | null;
  participants: string[] | null;
  sourceText: string | null;
  doneAt: string | null;
  createdAt: string;
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
  if (it.senderName) details.push(`From: ${it.senderName}`);
  if (it.sourceText) details.push(`\nOriginal:\n${it.sourceText}`);
  if (details.length > 0) params.set("details", details.join("\n"));
  if (it.location) params.set("location", it.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const KIND_LABEL: Record<
  string,
  { label: string; tone: "info" | "warn" | "success" | "danger" | "neutral" }
> = {
  event: { label: "📅 Event", tone: "info" },
  task: { label: "✅ Task", tone: "warn" },
  reminder: { label: "🔔 Reminder", tone: "warn" },
  deadline: { label: "⏳ Deadline", tone: "danger" },
  decision: { label: "🗳 Decision", tone: "neutral" },
  note: { label: "📝 Note", tone: "neutral" },
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
  if (days < 0) return { text: "overdue", tone: "danger" };
  if (days < 1) return { text: "today", tone: "warn" };
  if (days < 2) return { text: "tomorrow", tone: "warn" };
  if (days < 7) return { text: `in ${Math.ceil(days)}d`, tone: "neutral" };
  return null;
}

export default function RemindersPage() {
  const [filter, setFilter] = useState<"upcoming" | "all" | "done">("upcoming");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSource, setExpandedSource] = useState<Set<number>>(new Set());
  const toggleSource = (id: number) =>
    setExpandedSource((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/reminders?filter=${filter}`);
    if (!r.ok) {
      setLoading(false);
      return;
    }
    const j = (await r.json()) as { items: Item[] };
    setItems(j.items);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

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
        title="Actions"
        subtitle="کارها، رویدادها، یادآوری‌ها و نکته‌هایی که از پیام‌ها استخراج شده. ریمایندر فقط یک نوع از actionهاست."
        actions={
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
        }
      />

      {loading ? (
        <Card>Loading…</Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            Nothing yet. Tap "🧠 Extract" on any message in All Messages or
            Urgent to have the AI pull dates, tasks and reminders out of it.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => {
            const kindInfo = KIND_LABEL[it.kind] ?? KIND_LABEL.note!;
            const due = dueChip(it.dueAt);
            return (
              <Card key={it.id} className="!p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={kindInfo.tone}>{kindInfo.label}</Badge>
                      {due && <Badge tone={due.tone}>{due.text}</Badge>}
                      {it.doneAt && <Badge tone="success">done</Badge>}
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
                          from{" "}
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
                            ? "Hide original message ▴"
                            : "Show original message ▾"}
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
                        title="Open prefilled Google Calendar event in a new tab"
                      >
                        📅 Add to Google Calendar
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
                    {it.doneAt ? "Mark undone" : "Mark done"}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
