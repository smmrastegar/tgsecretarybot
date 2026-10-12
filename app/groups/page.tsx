"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
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

const fa = (n: number) => n.toLocaleString("fa-IR");

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
// Action row: buttons sit on the physical left (also when it holds links, which the global rule does not cover).
const ACTIONS = "flex flex-wrap gap-2 w-full justify-[left]";
const BTN_PRIMARY =`${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [interval, setIntervalHours] = useState<Record<number, number | null>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/groups");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { groups?: GroupRow[] };
      setGroups(j.groups ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(g: GroupRow, next: boolean) {
    setOpen(next ? g.chatId : null);
    setMsg(null);
    if (next && interval[g.chatId] === undefined) {
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
    if (!(await confirmDialog("لینک عمومی این گروه لغو شود؟ آدرس فعلی از کار می‌افتد.", { danger: true, confirmLabel: "لغو لینک" }))) return;
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

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? groups.filter((g) => `${g.chatTitle ?? ""} ${g.chatId}`.toLowerCase().includes(needle))
        : groups,
    [groups, needle],
  );
  const publicCount = groups.filter((g) => g.shareToken).length;

  return (
    <Shell>
      <PageTitle
        title="👥 گروه‌ها"
        subtitle="هر گروهی که بات در آن عضو است — لینک اشتراک‌گذاری، فرکانس خلاصه‌سازی و تحلیل هر گروه از همین‌جا."
        actions={
          <div className={ACTIONS}>
            <Link href="/groups/summaries" className={BTN_PLAIN}>
              📝 خلاصه‌های روزانه
            </Link>
          </div>
        }
      />

      {msg && (
        <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm leading-6 text-center">
          {msg}
        </div>
      )}

      {err ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری گروه‌ها: {err}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading && groups.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری گروه‌ها…</p>
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="👥"
          title="هنوز پیامی از هیچ گروهی ثبت نشده."
          hint="بات را به یک گروه اضافه کن؛ بعد از اولین پیام، گروه اینجا نمایش داده می‌شود."
        />
      ) : (
        <>
          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 جستجوی گروه…"
            aria-label="جستجوی گروه"
            className="w-full min-h-11 mb-3 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4"
          />
          <div className="mb-3 flex flex-wrap justify-center gap-1.5 text-xs">
            <Pill>{fa(groups.length)} گروه</Pill>
            <Pill tone="ok">🔗 {fa(publicCount)} لینک عمومی</Pill>
            {needle && <Pill tone="warn">{fa(shown.length)} نتیجه</Pill>}
          </div>

          {shown.length === 0 && (
            <EmptyState icon="🔍" title="گروهی با این جستجو پیدا نشد." />
          )}

          {shown.map((g) => {
            // One token, two views: the read-only report and the
            // editable task board. The board had no link anywhere in the
            // app, so it was reachable only by already knowing the URL.
            const shareUrl = g.shareToken
              ? `${origin}/share/groups/${g.shareToken}?days=0`
              : null;
            const boardUrl = g.shareToken
              ? `${origin}/board/${g.shareToken}`
              : null;
            const name = g.chatTitle ?? `گروه ${g.chatId}`;
            const working = busy === g.chatId;
            return (
              <Section
                key={g.chatId}
                icon="👥"
                title={name}
                summary={`${fa(g.messages)} پیام · ${fa(g.senders)} نفر${g.lastSeen ? ` · ${relTime(g.lastSeen)}` : ""}`}
                badge={g.shareToken ? <Pill tone="ok">🔗 عمومی</Pill> : <Pill>خصوصی</Pill>}
                open={open === g.chatId}
                onOpenChange={(o) => void toggle(g, o)}
              >
                <div className="flex flex-col gap-5">
                  {/* The row above truncates long names, so the full one lives here. */}
                  <div>
                    <div dir="auto" className="text-sm font-semibold leading-6">{name}</div>
                    <div className="mt-1 text-xs text-[var(--color-text-dim)]">
                      {g.summaryCount > 0 ? `${fa(g.summaryCount)} خلاصه` : "بدون خلاصه"} · id {g.chatId}
                    </div>
                  </div>

                  {/* SHARE LINK — the thing that used to be unfindable. */}
                  <div className="pt-4 border-t border-[var(--color-border)]">
                    <div className="text-sm font-medium mb-1">🔗 لینک اشتراک‌گذاری عمومی</div>
                    <p className="text-xs text-[var(--color-text-dim)] leading-6 mb-3">
                      یک توکن، دو نما: <b>گزارش</b> فقط‌خواندنی است، و <b>بورد کارها</b> قابل ویرایش.
                    </p>
                    {shareUrl ? (
                      <div className="flex flex-col gap-3">
                        <code
                          dir="ltr"
                          className="block w-full text-xs break-all text-start bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2.5"
                        >
                          {shareUrl}
                        </code>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => copy(g.chatId, shareUrl)} className={BTN_PRIMARY}>
                            {copied === g.chatId ? "✓ کپی شد" : "📋 کپی"}
                          </button>
                          <a href={shareUrl} target="_blank" rel="noreferrer" className={BTN_PLAIN}>
                            📊 گزارش ↗
                          </a>
                          {boardUrl && (
                            <a href={boardUrl} target="_blank" rel="noreferrer"
                              className={`${BTN} border border-[var(--color-accent)] text-[var(--color-accent)]`}>
                              ✍️ بورد قابل ویرایش ↗
                            </a>
                          )}
                          <button onClick={() => void revokeLink(g.chatId)} disabled={working}
                            className={`${BTN} border border-red-900/50 text-red-300`}>
                            🗑 لغو لینک
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => void makeLink(g.chatId)} disabled={working} className={`${BTN_PRIMARY} w-full`}>
                        {working ? "…" : "+ ساخت لینک"}
                      </button>
                    )}
                  </div>

                  {/* SUMMARY CADENCE */}
                  <div className="pt-4 border-t border-[var(--color-border)]">
                    <div className="text-sm font-medium mb-1">⏱ فرکانس خلاصه‌سازی</div>
                    <p className="text-xs text-[var(--color-text-dim)] leading-6 mb-3">
                      کرون هر ساعت اجرا می‌شود و فقط گروه‌هایی را می‌سازد که زمانشان رسیده باشد.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {INTERVALS.map((o) => {
                        const active = (interval[g.chatId] ?? null) === o.hours;
                        return (
                          <button
                            key={String(o.hours)}
                            onClick={() => void setInterval(g.chatId, o.hours)}
                            aria-pressed={active}
                            className={`min-h-11 px-2 rounded-xl text-sm border ${
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
                  <div className="pt-4 border-t border-[var(--color-border)] flex flex-col gap-2">
                    <button onClick={() => void summarize(g.chatId)} disabled={working} className={`${BTN_PRIMARY} w-full`}>
                      {working ? "…" : "▶ خلاصه‌گیریِ الان"}
                    </button>
                    <Link href={`/groups/${g.chatId}`} className={`${BTN_PLAIN} w-full`}>
                      📊 تحلیل کارها
                    </Link>
                    <Link href={`/groups/${g.chatId}`} className={`${BTN_PLAIN} w-full`}>
                      ✎ ویرایشِ نام و یادداشتِ تاپیک‌ها
                    </Link>
                    <Link href={`/groups/summaries?q=${encodeURIComponent(g.chatTitle ?? "")}`} className={`${BTN_PLAIN} w-full`}>
                      📝 خلاصه‌های این گروه
                    </Link>
                  </div>
                </div>
              </Section>
            );
          })}
        </>
      )}
    </Shell>
  );
}
