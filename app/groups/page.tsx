"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

// Group MANAGEMENT. The daily-summary feed lives at /groups/summaries and
// the deep task analysis at /groups/[id] — they used to share this page,
// which is why the share-link control was impossible to find: it sat
// inside an analysis screen, behind a list that only showed groups that
// already had a summary.

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

const INTERVALS = [
  { hours: null, label: "پیش‌فرض" },
  { hours: 6, label: "۶ ساعت" },
  { hours: 12, label: "۱۲ ساعت" },
  { hours: 24, label: "۲۴ ساعت" },
  { hours: 72, label: "۳ روز" },
  { hours: 168, label: "هفتگی" },
];

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [interval, setIntervalHours] = useState<Record<number, number | null>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/groups");
    if (r.ok) {
      const j = (await r.json()) as { groups?: GroupRow[] };
      setGroups(j.groups ?? []);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(g: GroupRow) {
    const next = open === g.chatId ? null : g.chatId;
    setOpen(next);
    setMsg(null);
    if (next != null && interval[g.chatId] === undefined) {
      const r = await fetch(`/api/groups/${g.chatId}/interval`).catch(() => null);
      if (r?.ok) {
        const j = (await r.json()) as { hours: number | null };
        setIntervalHours((p) => ({ ...p, [g.chatId]: j.hours }));
      }
    }
  }

  async function makeLink(chatId: number) {
    setBusy(chatId);
    try {
      const r = await fetch(`/api/groups/${chatId}/share`, { method: "POST" });
      const j = (await r.json()) as { token?: string };
      if (j.token) {
        setGroups((p) =>
          p.map((g) => (g.chatId === chatId ? { ...g, shareToken: j.token! } : g)),
        );
      }
    } finally {
      setBusy(null);
    }
  }

  async function revokeLink(chatId: number) {
    if (!confirm("لینک عمومی این گروه لغو شود؟ آدرس فعلی از کار می‌افتد.")) return;
    setBusy(chatId);
    try {
      await fetch(`/api/groups/${chatId}/share`, { method: "DELETE" });
      setGroups((p) =>
        p.map((g) => (g.chatId === chatId ? { ...g, shareToken: null } : g)),
      );
    } finally {
      setBusy(null);
    }
  }

  async function setInterval(chatId: number, hours: number | null) {
    setIntervalHours((p) => ({ ...p, [chatId]: hours }));
    await fetch(`/api/groups/${chatId}/interval`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    }).catch(() => {});
  }

  async function summarize(chatId: number) {
    setBusy(chatId);
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
            : "پیام کافی برای خلاصه‌سازی نبود (حداقل ۳ پیام در ۲۴ ساعت گذشته).",
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function copy(chatId: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try */
      }
      document.body.removeChild(ta);
    }
    setCopied(chatId);
    setTimeout(() => setCopied(null), 1600);
  }

  const fa = (n: number) => n.toLocaleString("fa-IR");

  return (
    <Shell>
      <PageTitle
        title="👥 گروه‌ها"
        subtitle="هر گروهی که بات در آن عضو است — لینک اشتراک‌گذاری، فرکانس خلاصه‌سازی و تحلیل هر گروه از همین‌جا."
        actions={
          <Link
            href="/groups/summaries"
            className="text-xs px-3 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            📝 خلاصه‌های روزانه
          </Link>
        }
      />

      {msg && (
        <Card className="mb-3">
          <p className="text-xs text-[var(--color-text-dim)]">{msg}</p>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">…</p>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هنوز پیامی از هیچ گروهی ثبت نشده.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const isOpen = open === g.chatId;
            // One token, two views: the read-only report and the
            // editable task board. The board had no link anywhere in the
            // app, so it was reachable only by already knowing the URL.
            const shareUrl = g.shareToken
              ? `${origin}/share/groups/${g.shareToken}?days=0`
              : null;
            const boardUrl = g.shareToken
              ? `${origin}/board/${g.shareToken}`
              : null;
            return (
              <Card key={g.chatId}>
                <button
                  onClick={() => toggle(g)}
                  className="w-full text-start"
                  aria-expanded={isOpen}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-sm font-medium break-words"
                        dir="auto"
                      >
                        {g.chatTitle ?? `گروه ${g.chatId}`}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-dim)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>{fa(g.messages)} پیام</span>
                        <span>{fa(g.senders)} نفر</span>
                        <span>
                          {g.summaryCount > 0
                            ? `${fa(g.summaryCount)} خلاصه`
                            : "بدون خلاصه"}
                        </span>
                        {g.lastSeen && <span>{relTime(g.lastSeen)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {g.shareToken ? (
                        <Badge tone="success">🔗 عمومی</Badge>
                      ) : (
                        <Badge tone="neutral">خصوصی</Badge>
                      )}
                      <span className="text-[var(--color-text-dim)] text-xs">
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex flex-col gap-5">
                    {/* SHARE LINK — the thing that used to be unfindable. */}
                    <div>
                      <div className="text-xs font-medium mb-1">
                        🔗 لینک اشتراک‌گذاری عمومی
                      </div>
                      <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
                        یک توکن، دو نما: <b>گزارش</b> فقط‌خواندنی است، و{" "}
                        <b>بورد کارها</b> قابل ویرایش.
                      </p>
                      {shareUrl ? (
                        <div className="flex flex-col gap-2">
                          <code
                            dir="ltr"
                            className="block w-full text-[10px] break-all bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-2"
                          >
                            {shareUrl}
                          </code>
                          <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => copy(g.chatId, shareUrl)}
                            className="text-[11px] px-3 py-2 rounded-md bg-[var(--color-accent)] text-white"
                          >
                            {copied === g.chatId ? "✓ کپی شد" : "📋 کپی"}
                          </button>
                          <a
                            href={shareUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] px-3 py-2 rounded-md border border-[var(--color-border)]"
                          >
                            📊 گزارش ↗
                          </a>
                          {boardUrl && (
                            <a
                              href={boardUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] px-3 py-2 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)]"
                            >
                              ✍️ بوردِ قابلِ ویرایش ↗
                            </a>
                          )}
                          <button
                            onClick={() => revokeLink(g.chatId)}
                            disabled={busy === g.chatId}
                            className="text-[11px] px-3 py-2 rounded-md border border-red-900/50 text-red-300 disabled:opacity-50"
                          >
                            🗑 لغو
                          </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => makeLink(g.chatId)}
                          disabled={busy === g.chatId}
                          className="text-[11px] px-3 py-2 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
                        >
                          {busy === g.chatId ? "…" : "+ ساخت لینک"}
                        </button>
                      )}
                    </div>

                    {/* SUMMARY CADENCE */}
                    <div>
                      <div className="text-xs font-medium mb-1">
                        ⏱ فرکانس خلاصه‌سازی
                      </div>
                      <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
                        کرون هر ساعت اجرا می‌شود و فقط گروه‌هایی را می‌سازد که
                        زمانشان رسیده باشد.
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {INTERVALS.map((o) => {
                          const cur = interval[g.chatId] ?? null;
                          const active = cur === o.hours;
                          return (
                            <button
                              key={String(o.hours)}
                              onClick={() => setInterval(g.chatId, o.hours)}
                              className={`text-[11px] px-3 py-2 rounded-md border ${
                                active
                                  ? "bg-[var(--color-accent)] text-white border-transparent"
                                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                              }`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => summarize(g.chatId)}
                        disabled={busy === g.chatId}
                        className="text-[11px] px-3 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                      >
                        {busy === g.chatId ? "…" : "▶ خلاصه‌گیریِ الان"}
                      </button>
                      <Link
                        href={`/groups/${g.chatId}`}
                        className="text-[11px] px-3 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center"
                      >
                        📊 تحلیل کارها
                      </Link>
                      <Link
                        href={`/groups/${g.chatId}`}
                        className="text-[11px] px-3 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center"
                      >
                        ✎ ویرایشِ نام و یادداشتِ تاپیک‌ها
                      </Link>
                      <Link
                        href={`/groups/summaries?q=${encodeURIComponent(g.chatTitle ?? "")}`}
                        className="text-[11px] px-3 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center"
                      >
                        📝 خلاصه‌های این گروه
                      </Link>
                    </div>
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
