"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import { relTime } from "@/lib/format";

const fa = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;
// Action row: buttons sit on the physical left.
const ACTIONS = "flex flex-wrap gap-2 w-full justify-[left]";

function Chip({ tone = "neutral", children }: { tone?: "neutral" | "info" | "warn"; children: React.ReactNode }) {
  const c = { neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]", info: "bg-blue-500/15 text-blue-300", warn: "bg-amber-500/15 text-amber-200" }[tone];
  return <span dir="auto" className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs leading-5 max-w-full ${c}`}>{children}</span>;
}

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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>("7");
  const [q, setQ] = useState("");
  // Arriving from a group's page with ?q=<title> scopes the feed to it.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("q");
    if (p) setQ(p);
  }, []);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetch("/api/groups");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { summaries: Summary[] };
      setSummaries(j.summaries ?? []);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      setMsg(`✅ ${fa(j.summarized ?? 0)} از ${fa(j.chats ?? 0)} گروه خلاصه شد.`);
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
        title="📝 خلاصه‌های روزانه"
        subtitle="خلاصه‌های AI گروه‌ها — همه‌ی خلاصه‌های یک گروه روی هم ادغام می‌شن. برای مدیریتِ خودِ گروه‌ها به «گروه‌ها» برو."
        actions={
          <div className={ACTIONS}>
            <button disabled={running} onClick={runNow} className={BTN_PRIMARY}>
              {running ? "در حال خلاصه‌گیری…" : "▶ خلاصه‌گیری الان (۲۴h)"}
            </button>
          </div>
        }
      />

      {msg && (
        <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm leading-6 text-center">
          {msg}
        </div>
      )}

      <Card className="mb-3">
        <div className="flex flex-wrap justify-center gap-2 mb-3">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWindowKey(w.key)}
              aria-pressed={windowKey === w.key}
              className={`min-h-11 px-3.5 rounded-xl text-sm border ${
                windowKey === w.key
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          dir="auto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="جستجو"
          placeholder="🔍 جستجو در گروه‌ها و خلاصه‌ها"
          className="w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-text-dim)]">
            {fa(filtered.length)} گروه · {fa(windowed.length)} خلاصه روزانه
          </span>
          <button onClick={exportText} disabled={filtered.length === 0} className={BTN_PLAIN}>
            📤 خروجی متنی
          </button>
        </div>
      </Card>

      {loadErr ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری خلاصه‌ها: {loadErr}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری خلاصه‌ها…</p>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📝"
          title="هیچ خلاصه‌ای توی این بازه نیست."
          hint="کرون روزانه ساعت ۰۳:۰۰ UTC اجرا می‌شه، یا دکمه «▶ خلاصه‌گیری الان» رو بزن."
          action={
            <button onClick={runNow} disabled={running} className={BTN_PRIMARY}>
              {running ? "…" : "▶ خلاصه‌گیری الان"}
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((c) => {
            const isOpen = expanded.has(c.chatId);
            return (
              <Card key={c.chatId}>
                {/* Header */}
                <Link
                  href={`/groups/${c.chatId}`}
                  dir="auto"
                  className="flex items-center justify-center min-h-11 text-base font-semibold leading-7 text-[var(--color-accent)] hover:underline break-words"
                >
                  {c.chatTitle ?? `چت ${c.chatId}`}
                </Link>
                <div className="text-xs text-[var(--color-text-dim)] mt-1 leading-5">
                  {c.earliestPeriodStart.toLocaleDateString("fa-IR")} →{" "}
                  {c.latestPeriodEnd.toLocaleDateString("fa-IR")} · آپدیت{" "}
                  {relTime(c.latestCreatedAt.toISOString())}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  <Chip>
                    {fa(c.totalMessages)} پیام · {fa(c.peakActiveSenders)} نفر
                  </Chip>
                  <Chip tone="info">{fa(c.summaryCount)} خلاصه روزانه ادغام شده</Chip>
                  {c.mentionsOwner && <Chip tone="warn">اسمت برده شده</Chip>}
                </div>

                {/* Latest summary text */}
                <div className="mt-4 text-xs text-[var(--color-text-dim)] mb-1">📝 خلاصه (آخرین)</div>
                <p className="text-sm leading-7 whitespace-pre-wrap">
                  {c.latestSummaryText || (
                    <span className="text-[var(--color-text-dim)]">خلاصه‌ای نیست.</span>
                  )}
                </p>

                {/* Merged topics */}
                {c.topics.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-[var(--color-text-dim)] mb-1.5">
                      🏷 موضوعات (ادغام‌شده · {fa(c.topics.length)})
                    </div>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {c.topics.map((t, i) => (
                        <Chip key={i} tone="info">
                          {t.length > 60 ? t.slice(0, 60) + "…" : t}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {/* Merged action items */}
                {c.actionItems.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-[var(--color-text-dim)] mb-1.5">
                      ✅ اقدامات (ادغام‌شده · {fa(c.actionItems.length)})
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {c.actionItems.map((a, i) => (
                        <li key={i} className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm leading-6">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Expandable daily breakdown */}
                {c.daily.length > 1 && (
                  <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
                    <button
                      onClick={() => toggleExpand(c.chatId)}
                      aria-expanded={isOpen}
                      className="w-full min-h-11 rounded-xl text-sm text-[var(--color-text-dim)] hover:text-white hover:bg-[var(--color-surface-2)]"
                    >
                      {isOpen
                        ? `▴ بستن خلاصه‌های روزانه`
                        : `▾ نمایش ${fa(c.daily.length)} خلاصه روزانه جدا`}
                    </button>
                    {isOpen && (
                      <div className="mt-2 flex flex-col gap-2">
                        {c.daily.map((d) => (
                          <div
                            key={d.id}
                            className="text-sm p-3 rounded-xl bg-[var(--color-surface-2)]/60 border border-[var(--color-border)]"
                          >
                            <div className="text-xs text-[var(--color-text-dim)] mb-1.5 leading-5">
                              {new Date(d.periodStart).toLocaleString("fa-IR")} →{" "}
                              {new Date(d.periodEnd).toLocaleString("fa-IR")} · {fa(d.messageCount)} پیام
                            </div>
                            <div className="whitespace-pre-wrap leading-7">
                              {d.summary || (
                                <span className="text-[var(--color-text-dim)]">(خالی)</span>
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
