"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type GroupRow = {
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  messages: number;
  senders: number;
  lastSeen: string | null;
  summaryCount: number;
  lastSummaryAt: string | null;
  hasAnalysis: boolean;
  shareToken: string | null;
};

type Summary = {
  id: number;
  chatId: number;
  chatTitle: string | null;
  periodStart: string;
  periodEnd: string;
  messageCount: number;
  activeSenders: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  mentionsOwner: boolean;
  createdAt: string;
};

// Window options for the filter chip row. days=null = unbounded.
type WindowKey = "1" | "3" | "7" | "30" | "all";
const WINDOWS: Array<{ key: WindowKey; label: string; days: number | null }> = [
  { key: "1", label: "۲۴ ساعت اخیر", days: 1 },
  { key: "3", label: "۳ روز اخیر", days: 3 },
  { key: "7", label: "۷ روز اخیر", days: 7 },
  { key: "30", label: "۳۰ روز اخیر", days: 30 },
  { key: "all", label: "همه", days: null },
];

// One consolidated card per group, built by merging every per-day
// summary that falls inside the active window.
type Consolidated = {
  chatId: number;
  chatTitle: string | null;
  summaryCount: number;
  earliestPeriodStart: Date;
  latestPeriodEnd: Date;
  totalMessages: number;
  peakActiveSenders: number;
  mentionsOwner: boolean;
  topics: string[];
  actionItems: string[];
  latestSummaryText: string;
  latestCreatedAt: Date;
  daily: Summary[]; // raw per-day rows for the expandable section
};

function uniqCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it.trim());
  }
  return out;
}

function consolidate(summaries: Summary[]): Consolidated[] {
  const byChat = new Map<number, Summary[]>();
  for (const s of summaries) {
    const arr = byChat.get(s.chatId) ?? [];
    arr.push(s);
    byChat.set(s.chatId, arr);
  }
  const out: Consolidated[] = [];
  for (const [chatId, arr] of byChat.entries()) {
    arr.sort(
      (a, b) =>
        new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime(),
    );
    const latest = arr[0]!;
    out.push({
      chatId,
      chatTitle: latest.chatTitle,
      summaryCount: arr.length,
      earliestPeriodStart: arr.reduce(
        (min, s) =>
          new Date(s.periodStart).getTime() < min.getTime()
            ? new Date(s.periodStart)
            : min,
        new Date(latest.periodStart),
      ),
      latestPeriodEnd: arr.reduce(
        (max, s) =>
          new Date(s.periodEnd).getTime() > max.getTime()
            ? new Date(s.periodEnd)
            : max,
        new Date(latest.periodEnd),
      ),
      totalMessages: arr.reduce((n, s) => n + s.messageCount, 0),
      peakActiveSenders: arr.reduce(
        (m, s) => Math.max(m, s.activeSenders),
        0,
      ),
      mentionsOwner: arr.some((s) => s.mentionsOwner),
      topics: uniqCaseInsensitive(arr.flatMap((s) => s.topics)),
      actionItems: uniqCaseInsensitive(arr.flatMap((s) => s.actionItems)),
      latestSummaryText: latest.summary,
      latestCreatedAt: new Date(latest.createdAt),
      daily: arr,
    });
  }
  // Most recently active group first.
  out.sort(
    (a, b) => b.latestPeriodEnd.getTime() - a.latestPeriodEnd.getTime(),
  );
  return out;
}

export default function GroupsPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>("7");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [busyChat, setBusyChat] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/groups");
    const j = (await r.json()) as { summaries: Summary[]; groups?: GroupRow[] };
    setSummaries(j.summaries);
    setGroups(j.groups ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Summarise one group on demand. Previously the only control ran every
  // group at once, and a group with no summary yet wasn't even listed, so
  // there was no way to produce its first one from here.
  async function summarizeOne(chatId: number) {
    setBusyChat(chatId);
    setMsg(null);
    try {
      const r = await fetch(
        `/api/cron/daily-summary?hours=24&chat_id=${chatId}`,
        { method: "POST" },
      );
      const j = (await r.json()) as { summarized?: number; error?: string };
      setMsg(
        j.error
          ? `خطا: ${j.error}`
          : j.summarized
            ? "خلاصه ساخته شد ✓"
            : "پیام کافی برای خلاصه‌سازی نبود (حداقل ۳ پیام در بازه).",
      );
      await load();
    } finally {
      setBusyChat(null);
    }
  }

  async function runNow() {
    setRunning(true);
    setMsg(null);
    try {
      const r = await fetch("/api/cron/daily-summary?hours=24", {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        summarized?: number;
        chats?: number;
        error?: string;
      };
      if (!r.ok) throw new Error(j.error ?? "failed");
      setMsg(`✅ ${j.summarized ?? 0} از ${j.chats ?? 0} گروه خلاصه شد.`);
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const activeWindow = WINDOWS.find((w) => w.key === windowKey)!;

  const windowed = useMemo(() => {
    if (activeWindow.days == null) return summaries;
    const cutoff = Date.now() - activeWindow.days * 24 * 60 * 60 * 1000;
    return summaries.filter(
      (s) => new Date(s.periodEnd).getTime() >= cutoff,
    );
  }, [summaries, activeWindow]);

  const consolidated = useMemo(() => consolidate(windowed), [windowed]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return consolidated;
    return consolidated.filter((c) => {
      const hay =
        (c.chatTitle ?? "").toLowerCase() +
        " " +
        c.topics.join(" ").toLowerCase() +
        " " +
        c.actionItems.join(" ").toLowerCase() +
        " " +
        c.latestSummaryText.toLowerCase() +
        " " +
        String(c.chatId);
      return hay.includes(ql);
    });
  }, [consolidated, q]);

  const toggleExpand = (chatId: number) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const exportText = () => {
    const lines: string[] = [];
    lines.push(
      `📊 خلاصه گروه‌ها — بازه: ${activeWindow.label}  ·  ${filtered.length} گروه`,
    );
    lines.push("");
    for (const c of filtered) {
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`📁 ${c.chatTitle ?? `چت ${c.chatId}`}`);
      lines.push(
        `   ${c.totalMessages} پیام · ${c.peakActiveSenders} نفر · ${c.summaryCount} خلاصه روزانه`,
      );
      lines.push(
        `   ${c.earliestPeriodStart.toLocaleDateString("fa-IR")} → ${c.latestPeriodEnd.toLocaleDateString("fa-IR")}`,
      );
      if (c.mentionsOwner) lines.push(`   ⚠ اسمت برده شده`);
      lines.push("");
      lines.push(`📝 خلاصه:`);
      lines.push(c.latestSummaryText || "(خالی)");
      if (c.topics.length > 0) {
        lines.push("");
        lines.push(`🏷 موضوعات: ${c.topics.join(" · ")}`);
      }
      if (c.actionItems.length > 0) {
        lines.push("");
        lines.push(`✅ اقدامات:`);
        for (const a of c.actionItems) lines.push(`   • ${a}`);
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `groups-summary-${activeWindow.key}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Shell>
      <PageTitle
        title="📊 تحلیلگر گروه"
        subtitle="خلاصه‌های روزانه AI گروه‌ها — همه خلاصه‌های یک گروه روی هم ادغام می‌شن."
        actions={
          <button
            disabled={running}
            onClick={runNow}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {running ? "..." : "▶ خلاصه‌گیری الان (۲۴h)"}
          </button>
        }
      />

      {msg && (
        <Card className="mb-3">
          <p className="text-xs text-[var(--color-text-dim)]">{msg}</p>
        </Card>
      )}

      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWindowKey(w.key)}
              className={`text-[11px] px-2 py-1 rounded-md border ${
                windowKey === w.key
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
              }`}
            >
              {w.label}
            </button>
          ))}
          <span className="text-[10px] text-[var(--color-text-dim)] mr-auto">
            {filtered.length} گروه · {windowed.length} خلاصه روزانه
          </span>
          <button
            onClick={exportText}
            disabled={filtered.length === 0}
            className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-50"
          >
            📤 خروجی متنی
          </button>
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 جستجو در گروه‌ها، موضوعات، اقدامات، متن خلاصه"
          className="w-full text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
        />
      </Card>

      {/* Every group the bot is in — including ones with no summary yet.
          This section is the entry point to each group's page, where the
          public share link is managed. */}
      <Card className="mb-4">
        <div className="text-xs font-medium mb-1">
          👥 گروه‌های بات{" "}
          <span className="text-[var(--color-text-dim)] font-normal">
            ({groups.length})
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-dim)] mb-3">
          هر گروهی که بات توش هست، حتی اگر هنوز خلاصه‌ای نداشته باشد. برای
          مدیریتِ لینکِ اشتراک‌گذاری روی اسم گروه بزن.
        </p>
        {groups.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)]">
            هنوز پیامی از هیچ گروهی ثبت نشده.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <div
                key={g.chatId}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)]"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/groups/${g.chatId}`}
                    className="text-sm font-medium text-[var(--color-accent)] hover:underline break-words"
                    dir="auto"
                  >
                    {g.chatTitle ?? `گروه ${g.chatId}`}
                  </Link>
                  <div className="text-[10px] text-[var(--color-text-dim)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{g.messages.toLocaleString("fa-IR")} پیام</span>
                    <span>{g.senders.toLocaleString("fa-IR")} نفر</span>
                    <span>
                      {g.summaryCount > 0
                        ? `${g.summaryCount.toLocaleString("fa-IR")} خلاصه`
                        : "بدون خلاصه"}
                    </span>
                    {g.lastSeen && <span>آخرین پیام {relTime(g.lastSeen)}</span>}
                    <span className={g.shareToken ? "text-emerald-400" : ""}>
                      {g.shareToken ? "🔗 لینک عمومی دارد" : "بدون لینک عمومی"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
                  <button
                    onClick={() => summarizeOne(g.chatId)}
                    disabled={busyChat === g.chatId}
                    className="text-[11px] px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)] disabled:opacity-50"
                  >
                    {busyChat === g.chatId ? "…" : "▶ خلاصه‌گیری"}
                  </button>
                  <Link
                    href={`/groups/${g.chatId}`}
                    className="text-[11px] px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                  >
                    🔗 لینک و تنظیمات
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {loading ? (
        <Card>
          <div className="text-xs text-[var(--color-text-dim)]">...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هیچ خلاصه‌ای توی این بازه نیست. کرون روزانه ساعت ۰۳:۰۰ UTC اجرا
            می‌شه، یا دکمه «▶ خلاصه‌گیری الان» رو بزن.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((c) => {
            const isOpen = expanded.has(c.chatId);
            return (
              <Card key={c.chatId}>
                {/* Header */}
                <div className="flex items-start justify-between mb-2 gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/groups/${c.chatId}`}
                      className="font-medium hover:underline text-[var(--color-accent)]"
                    >
                      {c.chatTitle ?? `چت ${c.chatId}`}
                    </Link>
                    <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                      {c.earliestPeriodStart.toLocaleDateString("fa-IR")} →{" "}
                      {c.latestPeriodEnd.toLocaleDateString("fa-IR")} ·{" "}
                      آپدیت {relTime(c.latestCreatedAt.toISOString())}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge tone="neutral">
                      {c.totalMessages} پیام · {c.peakActiveSenders} نفر
                    </Badge>
                    <Badge tone="info">
                      {c.summaryCount} خلاصه روزانه ادغام شده
                    </Badge>
                    {c.mentionsOwner && (
                      <Badge tone="warn">اسمت برده شده</Badge>
                    )}
                  </div>
                </div>

                {/* Latest summary text */}
                <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                  📝 خلاصه (آخرین)
                </div>
                <p className="text-sm leading-relaxed mb-3 whitespace-pre-wrap">
                  {c.latestSummaryText || (
                    <span className="text-[var(--color-text-dim)]">
                      خلاصه‌ای نیست.
                    </span>
                  )}
                </p>

                {/* Merged topics */}
                {c.topics.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                      🏷 موضوعات (ادغام‌شده · {c.topics.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.topics.map((t, i) => (
                        <Badge key={i} tone="info">
                          {t.length > 60 ? t.slice(0, 60) + "…" : t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Merged action items */}
                {c.actionItems.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                      ✅ اقدامات (ادغام‌شده · {c.actionItems.length})
                    </div>
                    <ul className="text-sm list-disc pr-5 space-y-0.5">
                      {c.actionItems.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Expandable daily breakdown */}
                {c.daily.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                    <button
                      onClick={() => toggleExpand(c.chatId)}
                      className="text-[10px] text-[var(--color-text-dim)] hover:text-white"
                    >
                      {isOpen
                        ? `▴ بستن خلاصه‌های روزانه`
                        : `▾ نمایش ${c.daily.length} خلاصه روزانه جدا`}
                    </button>
                    {isOpen && (
                      <div className="mt-2 flex flex-col gap-2">
                        {c.daily.map((d) => (
                          <div
                            key={d.id}
                            className="text-[11px] p-2 rounded-md bg-[var(--color-surface-2)]/40 border border-[var(--color-border)]/40"
                          >
                            <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                              {new Date(d.periodStart).toLocaleString(
                                "fa-IR",
                              )}{" "}
                              → {new Date(d.periodEnd).toLocaleString("fa-IR")}{" "}
                              · {d.messageCount} پیام
                            </div>
                            <div className="whitespace-pre-wrap leading-relaxed">
                              {d.summary || (
                                <span className="text-[var(--color-text-dim)]">
                                  (خالی)
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
