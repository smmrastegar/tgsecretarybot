"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import Section, { Pill } from "@/components/ui/Section";
import { confirmDialog } from "@/components/ui/Dialogs";
import { relTime } from "@/lib/format";

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

type Decided =
  | "no_customer_message"
  | "never_engaged"
  | "replied_by_owner"
  | "follow_up_disabled"
  | "chat_muted"
  | "chat_ignored"
  | "is_bot"
  | "acked"
  | "below_threshold"
  | "ai_pending"
  | "ai_no_reply_needed"
  | "waiting_for_escalate"
  | "already_pinged_escalate"
  | "would_ping_first"
  | "would_ping_escalate";

type ChatRow = {
  chatId: number;
  name: string | null;
  decided: Decided;
  hoursSinceCustomer: number | null;
  thresholdHours: number;
  escalateHours: number;
  followUpEnabled: boolean;
  muted: boolean;
  ignored: boolean;
  isBot: boolean;
  lastCustomerMessageAt: string | null;
  lastOwnerMessageAt: string | null;
  lastOwnerMsgOnlyAt: string | null;
  lastReactionAt: string | null;
  reactionsTotal: number;
  lastAnyMessageAt: string | null;
  messagesLast24h: number;
  lastPingAt: string | null;
  lastPingKind: string | null;
  ackedAt: string | null;
  aiForMessageAt: string | null;
  aiVerdictAt: string | null;
  aiNeedsReply: boolean | null;
  aiReason: string | null;
  aiUrgency: "low" | "normal" | "high" | null;
};

type TenantBlock = {
  tenantId: number;
  totalChats: number;
  buckets: Record<string, number>;
  chats: ChatRow[];
};

type Response = {
  ok: boolean;
  debug: boolean;
  tenants: TenantBlock[];
};

const DECIDED_LABELS: Record<Decided, string> = {
  would_ping_first: "🔔 نیاز به جواب",
  would_ping_escalate: "🚨 escalate",
  ai_pending: "🤖 در صف AI",
  ai_no_reply_needed: "💤 جواب نمی‌خواد",
  below_threshold: "⏱ زیر آستانه",
  waiting_for_escalate: "⌛ منتظر escalate",
  already_pinged_escalate: "✓ هر دو ping رفته",
  replied_by_owner: "✅ جواب دادی",
  acked: "👌 متوجه شدم زدی",
  never_engaged: "🤷 یه‌بار هم جواب ندادی",
  is_bot: "🤖 بات",
  chat_muted: "🔇 بی‌صدا",
  chat_ignored: "🙈 نادیده‌گرفته‌شده",
  follow_up_disabled: "⛔ غیرفعال",
  no_customer_message: "— پیامی نیست",
};

const DECIDED_TONES: Record<
  Decided,
  "candidate" | "neutral" | "answered" | "dim"
> = {
  would_ping_first: "candidate",
  would_ping_escalate: "candidate",
  ai_pending: "neutral",
  ai_no_reply_needed: "answered",
  below_threshold: "neutral",
  waiting_for_escalate: "neutral",
  already_pinged_escalate: "neutral",
  replied_by_owner: "answered",
  acked: "answered",
  never_engaged: "dim",
  is_bot: "dim",
  chat_muted: "dim",
  chat_ignored: "dim",
  follow_up_disabled: "dim",
  no_customer_message: "dim",
};

const TONE_CLASSES: Record<string, string> = {
  candidate: "text-amber-200 bg-amber-500/15 border-amber-500/40",
  neutral: "text-sky-200 bg-sky-500/10 border-sky-500/30",
  answered: "text-emerald-200 bg-emerald-500/10 border-emerald-500/30",
  dim: "text-[var(--color-text-dim)] bg-[var(--color-surface-2)] border-[var(--color-border)]",
};

// Single-select filter — either "all" (show every row), a preset
// like "needs_reply" (any AI-needs-reply candidate), or one specific
// decided bucket.
type FilterKey = "all" | "needs_reply" | Decided;
const DEFAULT_FILTER: FilterKey = "needs_reply";
// "نیاز به جواب" includes chats with a fresh AI verdict saying yes,
// PLUS chats whose verdict hasn't been computed yet (ai_pending) —
// those are pending evaluation but they ARE the same pool of chats
// that may need a reply, just waiting on the next cron tick to be
// judged. Operator asked for these to be visible alongside.
const NEEDS_REPLY_DECIDED: Decided[] = [
  "would_ping_first",
  "would_ping_escalate",
  "ai_pending",
];

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${fa(Math.round(h * 60))} دقیقه`;
  if (h < 48) return `${fa(h.toFixed(1)).replace(".", "٫")} ساعت`;
  return `${fa((h / 24).toFixed(1)).replace(".", "٫")} روز`;
}

const PAGE_SIZE = 25;

const CHIP = "min-h-10 px-3 rounded-full border text-xs font-medium";
const chipOff = "text-[var(--color-text-dim)] bg-transparent border-[var(--color-border)]";

export default function FollowUpDebugPage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<FilterKey>(DEFAULT_FILTER);
  const [q, setQ] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [moreStats, setMoreStats] = useState<Set<number>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // notes_inbox health check: if no chat carries the role, the cron
  // can't deliver pings and silently returns skipped. Surface a
  // banner so the operator knows what's wrong without having to dig
  // through System Log.
  const [notesInboxMissing, setNotesInboxMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/functions")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          j: {
            byRole?: Record<string, Record<string, unknown[]> | unknown[]>;
          } | null,
        ) => {
          if (cancelled || !j?.byRole) return;
          const ni = j.byRole.notes_inbox;
          if (!ni) {
            setNotesInboxMissing(true);
            return;
          }
          const total = Array.isArray(ni)
            ? ni.length
            : Object.values(ni).reduce(
                (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
                0,
              );
          setNotesInboxMissing(total === 0);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/cron/follow-up?debug=1");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Response);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const allRows = useMemo<ChatRow[]>(() => {
    if (!data) return [];
    return data.tenants.flatMap((t) => t.chats);
  }, [data]);

  const aggBuckets = useMemo<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    for (const r of allRows) o[r.decided] = (o[r.decided] ?? 0) + 1;
    return o;
  }, [allRows]);

  const filtered = useMemo<ChatRow[]>(() => {
    const ql = q.trim().toLowerCase();
    return allRows.filter((r) => {
      // Single-select filter: all / needs_reply preset / specific decided.
      if (active === "needs_reply") {
        if (!NEEDS_REPLY_DECIDED.includes(r.decided)) return false;
      } else if (active !== "all") {
        if (r.decided !== active) return false;
      }
      if (ql) {
        const hay =
          (r.name ?? "").toLowerCase() +
          " " +
          String(r.chatId) +
          " " +
          (r.aiReason ?? "").toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [allRows, active, q]);

  const sorted = useMemo<ChatRow[]>(() => {
    return [...filtered].sort((a, b) => {
      const ha = a.hoursSinceCustomer ?? -1;
      const hb = b.hoursSinceCustomer ?? -1;
      return hb - ha;
    });
  }, [filtered]);

  // Reset visible window whenever the filter or query changes so the
  // infinite-scroll counter doesn't drift past the new result set.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [active, q, allRows.length]);

  // IntersectionObserver: when the bottom sentinel scrolls into view,
  // expand the slice by another page until everything is rendered.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, sorted.length));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sorted.length]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = sorted.length > visibleCount;

  const [analyzing, setAnalyzing] = useState<Set<number>>(new Set());

  const analyzeChat = async (chatId: number) => {
    setAnalyzing((cur) => new Set(cur).add(chatId));
    try {
      const r = await fetch(`/api/chats/${chatId}/follow-up/analyze`, {
        method: "POST",
      });
      if (r.ok) await load();
    } finally {
      setAnalyzing((cur) => {
        const next = new Set(cur);
        next.delete(chatId);
        return next;
      });
    }
  };

  const ackChat = async (chatId: number) => {
    try {
      const r = await fetch(`/api/chats/${chatId}/follow-up/ack`, {
        method: "POST",
      });
      if (r.ok) await load();
    } catch {
      // surface via reload — silent failure is fine here
    }
  };

  const disableFollowUp = async (chatId: number) => {
    if (!(await confirmDialog("فالو‌آپ این چت خاموش بشه؟", { danger: true, confirmLabel: "خاموش کن" }))) return;
    try {
      const r = await fetch(`/api/chats/${chatId}/follow-up`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      if (r.ok) await load();
    } catch {
      // ignored — reload will reflect persisted state
    }
  };

  const triggerNow = async () => {
    if (!(await confirmDialog("برای چت‌های نیازمند جواب، همین الان ping فرستاده بشه؟", { confirmLabel: "بفرست" }))) return;
    setTriggering(true);
    try {
      const r = await fetch("/api/cron/follow-up", { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as {
          tenants: Array<{
            pinged?: number;
            candidates?: number;
            skipped?: string;
            errors?: Array<{ chatId: number; error: string }>;
          }>;
        };
        const totalPinged = j.tenants.reduce(
          (s, t) => s + (t.pinged ?? 0),
          0,
        );
        const totalCands = j.tenants.reduce(
          (s, t) => s + (t.candidates ?? 0),
          0,
        );
        const allErrors = j.tenants.flatMap((t) => t.errors ?? []);
        const skipped = j.tenants
          .filter((t) => t.skipped)
          .map((t) => t.skipped);
        let msg = `✅ ${fa(totalPinged)}/${fa(totalCands)} ping رفت`;
        if (skipped.length) msg += ` · skipped: ${skipped.join(", ")}`;
        if (allErrors.length) {
          msg +=
            ` · ❌ ${fa(allErrors.length)} خطا — ` +
            allErrors
              .slice(0, 3)
              .map((e) => `chat ${e.chatId}: ${e.error}`)
              .join(" | ");
        }
        setLastRun(msg);
        await load();
      } else {
        setLastRun(`❌ HTTP ${r.status}`);
      }
    } catch (e) {
      setLastRun(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTriggering(false);
    }
  };

  const orderedKeys: Decided[] = [
    "would_ping_first",
    "would_ping_escalate",
    "ai_pending",
    "ai_no_reply_needed",
    "waiting_for_escalate",
    "below_threshold",
    "already_pinged_escalate",
    "replied_by_owner",
    "acked",
    "never_engaged",
    "is_bot",
    "chat_muted",
    "chat_ignored",
    "follow_up_disabled",
    "no_customer_message",
  ];

  const needsReplyCount = NEEDS_REPLY_DECIDED.reduce(
    (n, k) => n + (aggBuckets[k] ?? 0),
    0,
  );
  const presets: Array<{ key: FilterKey; label: string; count: number; toneClass: string }> = [
    { key: "needs_reply", label: "🔔 نیاز به جواب", count: needsReplyCount, toneClass: TONE_CLASSES.candidate ?? "" },
    { key: "all", label: "🌐 همه", count: allRows.length, toneClass: TONE_CLASSES.neutral ?? "" },
  ];
  const specific = active !== "all" && active !== "needs_reply" ? active : null;

  return (
    <Shell>
      <div className="md:max-w-3xl md:mx-auto">
        <PageTitle
          title="⏰ دیباگ یادآور جواب‌ندادن"
          subtitle="هر چتی که این لحظه پیامش از طرف کاربر بدون جواب مونده — با فیلتر، جستجو، و trigger دستی."
        />

        {notesInboxMissing && (
          <div role="alert" className="mb-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-center">
            <div className="text-sm text-amber-200 leading-7">
              ⚠ <b>notes_inbox تنظیم نیست.</b> cron بدون این، هیچ ping
              ای ارسال نمی‌کنه و در سکوت skip می‌شه. یه channel یا
              group بساز، bot رو توش admin کن، بعد توی /functions اون چت
              رو به‌عنوان notes_inbox ست کن.
            </div>
            <div className="mt-3 flex">
              <Link href="/functions" className="min-h-10 inline-flex items-center px-4 rounded-xl border border-amber-500/50 text-sm text-amber-100">
                باز کردن /functions
              </Link>
            </div>
          </div>
        )}

        <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={triggerNow}
              disabled={triggering || loading}
              className="min-h-11 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50"
            >
              {triggering ? "در حال اجرا..." : "▶ الان اجرا کن (ping بفرست)"}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="min-h-11 px-4 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm disabled:opacity-50"
            >
              {loading ? "در حال بارگذاری…" : "🔄 رفرش"}
            </button>
          </div>
          {lastRun && (
            <p role="status" className="mt-3 text-xs leading-6 text-[var(--color-text-dim)] break-words">
              {lastRun}
            </p>
          )}

          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 جستجو بر اساس اسم یا chatId"
            aria-label="جستجو بر اساس اسم یا chatId"
            className="mt-3 w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-4"
          />

          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setActive(p.key)}
                className={`${CHIP} ${active === p.key ? p.toneClass : chipOff}`}
              >
                {p.label} <span className="opacity-70">{fa(p.count)}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-[var(--color-text-dim)]">
            {fa(allRows.length)} چت کل، {fa(filtered.length)} نمایش
          </div>
        </div>

        <Section
          icon="🎚"
          title="فیلتر بر اساس وضعیت"
          summary={specific ? DECIDED_LABELS[specific] : "یک وضعیت مشخص را انتخاب کن"}
          badge={specific ? <Pill tone="warn">فعال</Pill> : undefined}
        >
          <div className="flex flex-wrap justify-center gap-1.5">
            {orderedKeys.map((k) => {
              const cnt = aggBuckets[k] ?? 0;
              if (cnt === 0) return null;
              const isOn = active === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActive(k)}
                  className={`${CHIP} ${isOn ? TONE_CLASSES[DECIDED_TONES[k]] : chipOff}`}
                >
                  {DECIDED_LABELS[k]} <span className="opacity-70">{fa(cnt)}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {err && (
          <div role="alert" className="mb-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-center">
            <p className="text-sm text-rose-200 leading-6">خطا: {err}</p>
            <div className="mt-2 flex">
              <button type="button" onClick={load} className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-sm text-rose-100">تلاش دوباره</button>
            </div>
          </div>
        )}

        {loading && !data ? (
          <Card>
            <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
          </Card>
        ) : sorted.length === 0 ? (
          err ? null : (
            <EmptyState
              icon="⏰"
              title="چیزی برای نمایش نیست"
              hint={allRows.length === 0 ? "هنوز چتی برای بررسی وجود ندارد." : "با این فیلتر یا جستجو چتی نیست."}
              action={
                allRows.length > 0 && (active !== "all" || q) ? (
                  <button type="button" onClick={() => { setActive("all"); setQ(""); }} className="min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm">نمایش همه</button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((r) => {
              const tone = DECIDED_TONES[r.decided];
              const customerStale =
                r.lastAnyMessageAt &&
                r.lastCustomerMessageAt &&
                new Date(r.lastAnyMessageAt).getTime() -
                  new Date(r.lastCustomerMessageAt).getTime() >
                  3600_000;
              const urgencyEmoji =
                r.aiUrgency === "high"
                  ? "🔥"
                  : r.aiUrgency === "low"
                    ? "🟢"
                    : "🟡";
              const statsOpen = moreStats.has(r.chatId);
              return (
                <Card key={r.chatId} className="!p-3">
                  {/* Top: name + status */}
                  <Link
                    href={`/chats/${r.chatId}`}
                    className="min-h-10 inline-flex max-w-full items-center justify-center text-sm font-medium leading-6 text-[var(--color-accent)] hover:underline break-words"
                  >
                    {r.name || `chat ${r.chatId}`}
                  </Link>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-md border ${TONE_CLASSES[tone]}`}
                    >
                      {DECIDED_LABELS[r.decided]}
                    </span>
                    <span dir="ltr" className="text-xs text-[var(--color-text-dim)]">
                      {r.chatId}
                    </span>
                  </div>

                  {/* AI reason — the WHY this chat needs (or doesn't) a reply.
                      Cached reasons from before the "use کاربر" prompt
                      change still say "مشتری" — rewrite at display time
                      until they're naturally refreshed by a new customer
                      message. */}
                  {r.aiReason ? (
                    <div className="mt-3 text-sm leading-7 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                      <span className="block text-xs text-amber-300 mb-1">
                        🤖 دلیل AI {urgencyEmoji}
                      </span>
                      <span dir="auto">
                        {r.aiReason.replace(/مشتری/g, "کاربر")}
                      </span>
                    </div>
                  ) : r.decided === "ai_pending" ? (
                    <div className="mt-3 text-xs leading-6 p-3 rounded-xl bg-sky-500/5 border border-sky-500/20">
                      <p className="text-sky-200">
                        🤖 هنوز AI این چت رو ارزیابی نکرده. cron هر ۳۰
                        دقیقه ۱۰ تای قدیمی‌ترین رو می‌گیره — این چت
                        احتمالاً توی صف‌های بعدیه. می‌تونی الان دستی
                        اجرا کنی:
                      </p>
                      <div className="mt-2 flex">
                        <button
                          type="button"
                          onClick={() => analyzeChat(r.chatId)}
                          disabled={analyzing.has(r.chatId)}
                          className="min-h-10 text-xs px-3 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-200 active:bg-sky-500/25 disabled:opacity-50"
                        >
                          {analyzing.has(r.chatId)
                            ? "..."
                            : "🤖 الان تحلیل کن"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Headline stats; the rest sits behind "آمار بیشتر" */}
                  <div className="mt-3 text-xs leading-6 text-[var(--color-text-dim)]">
                    <span>آخرین پیام: </span>
                    <span className="text-white">{fmtHours(r.hoursSinceCustomer)}</span>
                    {r.lastCustomerMessageAt && (
                      <span className="opacity-60"> ({relTime(new Date(r.lastCustomerMessageAt))})</span>
                    )}
                    <span className="mx-1.5 opacity-40">|</span>
                    <span>جواب تو: </span>
                    <span className="text-white">
                      {r.lastOwnerMessageAt ? relTime(new Date(r.lastOwnerMessageAt)) : "—"}
                    </span>
                  </div>
                  {statsOpen && (
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-[var(--color-text-dim)]">
                      <div>
                        <span className="opacity-70">پیام‌های ۲۴h: </span>
                        <span className="text-white">{fa(r.messagesLast24h)}</span>
                      </div>
                      <div>
                        <span className="opacity-70">آستانه: </span>
                        <span className="text-white" dir="ltr">
                          {fa(r.thresholdHours)}h / {fa(r.escalateHours)}h
                        </span>
                      </div>
                      {r.lastPingAt && (
                        <div className="col-span-2">
                          <span className="opacity-70">آخرین ping: </span>
                          <span className="text-white">
                            {relTime(new Date(r.lastPingAt))} ({r.lastPingKind})
                          </span>
                        </div>
                      )}
                      {r.lastReactionAt && (
                        <div className="col-span-2">
                          <span className="opacity-70">🌜 ری‌اکشن: </span>
                          <span className="text-white">{relTime(new Date(r.lastReactionAt))}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {customerStale && (
                    <div
                      className="mt-2 text-xs leading-6 text-amber-300"
                      title="یه پیام جدیدتر توی این چت لاگ شده ولی به‌عنوان «کاربر» شناخته نشده — احتمالاً from_owner اشتباه ست شده."
                    >
                      ⚠ آخرین پیام چت {relTime(new Date(r.lastAnyMessageAt!))} — ولی
                      from_owner=customer نیست
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => ackChat(r.chatId)}
                      className="min-h-10 text-xs px-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] active:bg-[var(--color-surface)]"
                      title="مارک کن به‌عنوان «متوجه شدم» — تا پیام جدید بعدی، دیگه ping نمی‌شه"
                    >
                      👌 ack
                    </button>
                    <button
                      type="button"
                      onClick={() => disableFollowUp(r.chatId)}
                      className="min-h-10 text-xs px-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 active:bg-rose-500/20"
                      title="فالو‌آپ این چت رو خاموش کن — حتی برای پیام‌های بعدی، توی لاگ‌ها نمیاد"
                    >
                      🙈 بیخیال
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMoreStats((cur) => {
                          const next = new Set(cur);
                          if (next.has(r.chatId)) next.delete(r.chatId);
                          else next.add(r.chatId);
                          return next;
                        })
                      }
                      aria-expanded={statsOpen}
                      className="min-h-10 text-xs px-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-dim)]"
                    >
                      آمار بیشتر {statsOpen ? "▴" : "▾"}
                    </button>
                  </div>
                </Card>
              );
            })}

            {hasMore && (
              <div
                ref={sentinelRef}
                className="text-xs text-center text-[var(--color-text-dim)] py-3"
              >
                در حال بارگذاری بیشتر…
              </div>
            )}
            {!hasMore && sorted.length > PAGE_SIZE && (
              <div className="text-xs text-center text-[var(--color-text-dim)] py-3">
                · پایان لیست ({fa(sorted.length)} مورد) ·
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
