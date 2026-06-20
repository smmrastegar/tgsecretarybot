"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import { relTime } from "@/lib/format";

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
  chat_muted: "🔇 muted",
  chat_ignored: "🙈 ignored",
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
  if (h < 1) return `${Math.round(h * 60)} دقیقه`;
  if (h < 48) return `${h.toFixed(1)} ساعت`;
  return `${(h / 24).toFixed(1)} روز`;
}

const PAGE_SIZE = 25;

export default function FollowUpDebugPage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<FilterKey>(DEFAULT_FILTER);
  const [q, setQ] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
        let msg = `✅ ${totalPinged}/${totalCands} ping رفت`;
        if (skipped.length) msg += ` · skipped: ${skipped.join(", ")}`;
        if (allErrors.length) {
          msg +=
            ` · ❌ ${allErrors.length} خطا — ` +
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

  return (
    <Shell>
      <PageTitle
        title="⏰ دیباگ یادآور جواب‌ندادن"
        subtitle="هر چتی که این لحظه پیامش از طرف کاربر بدون جواب مونده — با فیلتر، جستجو، و trigger دستی."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={load}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-50"
          >
            {loading ? "..." : "🔄 رفرش"}
          </button>
          <button
            onClick={triggerNow}
            disabled={triggering || loading}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {triggering ? "در حال اجرا..." : "▶ الان اجرا کن (ping بفرست)"}
          </button>
          {lastRun && (
            <span className="text-xs text-[var(--color-text-dim)]">
              {lastRun}
            </span>
          )}
          <span className="text-xs text-[var(--color-text-dim)] mr-auto">
            {allRows.length} چت کل · {filtered.length} نمایش
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {(() => {
            const needsReplyCount = NEEDS_REPLY_DECIDED.reduce(
              (n, k) => n + (aggBuckets[k] ?? 0),
              0,
            );
            const presets: Array<{
              key: FilterKey;
              label: string;
              count: number;
              toneClass: string;
            }> = [
              {
                key: "needs_reply",
                label: "🔔 نیاز به جواب",
                count: needsReplyCount,
                toneClass: TONE_CLASSES.candidate ?? "",
              },
              {
                key: "all",
                label: "🌐 همه",
                count: allRows.length,
                toneClass: TONE_CLASSES.neutral ?? "",
              },
            ];
            return presets.map((p) => {
              const isOn = active === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setActive(p.key)}
                  className={`text-[11px] px-2 py-1 rounded-md border font-medium ${
                    isOn
                      ? p.toneClass
                      : "text-[var(--color-text-dim)] bg-transparent border-[var(--color-border)] opacity-60"
                  }`}
                >
                  {p.label} · {p.count}
                </button>
              );
            });
          })()}
          <div className="w-full" />
          {orderedKeys.map((k) => {
            const cnt = aggBuckets[k] ?? 0;
            if (cnt === 0) return null;
            const isOn = active === k;
            const tone = DECIDED_TONES[k];
            return (
              <button
                key={k}
                onClick={() => setActive(k)}
                className={`text-[10px] px-2 py-1 rounded-md border transition ${
                  isOn
                    ? TONE_CLASSES[tone]
                    : "text-[var(--color-text-dim)] bg-transparent border-[var(--color-border)] opacity-60"
                }`}
              >
                {DECIDED_LABELS[k]} · {cnt}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 جستجو بر اساس اسم یا chatId"
          className="w-full text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
        />
      </Card>

      {err && (
        <Card className="mb-4">
          <div className="text-xs text-red-300">خطا: {err}</div>
        </Card>
      )}

      {sorted.length === 0 && !loading ? (
        <Card>
          <div className="text-xs text-center text-[var(--color-text-dim)] py-4">
            چیزی برای نمایش نیست.
          </div>
        </Card>
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
            return (
              <Card key={r.chatId} className="p-3">
                {/* Top row: name + status + actions */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <Link
                      href={`/chats/${r.chatId}`}
                      className="text-sm font-medium text-[var(--color-accent)] hover:underline"
                    >
                      {r.name || `chat ${r.chatId}`}
                    </Link>
                    <div className="text-[10px] text-[var(--color-text-dim)]">
                      {r.chatId}
                    </div>
                  </div>
                  <span
                    className={`inline-block text-[10px] px-1.5 py-0.5 rounded-md border ${TONE_CLASSES[tone]} shrink-0`}
                  >
                    {DECIDED_LABELS[r.decided]}
                  </span>
                </div>

                {/* AI reason — the WHY this chat needs (or doesn't) a reply.
                    Cached reasons from before the "use کاربر" prompt
                    change still say "مشتری" — rewrite at display time
                    until they're naturally refreshed by a new customer
                    message. */}
                {r.aiReason ? (
                  <div className="text-xs leading-relaxed mb-2 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                    <span className="text-[10px] text-amber-300 mr-1">
                      🤖 دلیل AI {urgencyEmoji}
                    </span>
                    <span dir="auto">
                      {r.aiReason.replace(/مشتری/g, "کاربر")}
                    </span>
                  </div>
                ) : r.decided === "ai_pending" ? (
                  <div className="text-[10px] leading-relaxed mb-2 p-2 rounded-md bg-sky-500/5 border border-sky-500/20 flex items-center gap-2">
                    <span className="text-sky-200 flex-1">
                      🤖 هنوز AI این چت رو ارزیابی نکرده. cron هر ۳۰
                      دقیقه ۱۰ تای قدیمی‌ترین رو می‌گیره — این چت
                      احتمالاً توی صف‌های بعدیه. می‌تونی الان دستی
                      اجرا کنی:
                    </span>
                    <button
                      onClick={() => analyzeChat(r.chatId)}
                      disabled={analyzing.has(r.chatId)}
                      className="text-[10px] px-2 py-1 rounded-md bg-sky-500/15 border border-sky-500/40 text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 shrink-0"
                    >
                      {analyzing.has(r.chatId)
                        ? "..."
                        : "🤖 الان تحلیل کن"}
                    </button>
                  </div>
                ) : null}

                {/* Compact stats row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-dim)] mb-2">
                  <div>
                    <span className="opacity-70">آخرین پیام: </span>
                    <span className="text-white">
                      {fmtHours(r.hoursSinceCustomer)}
                    </span>
                    {r.lastCustomerMessageAt && (
                      <span className="opacity-60">
                        {" "}
                        ({relTime(new Date(r.lastCustomerMessageAt))})
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="opacity-70">جواب تو: </span>
                    <span className="text-white">
                      {r.lastOwnerMessageAt
                        ? relTime(new Date(r.lastOwnerMessageAt))
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="opacity-70">پیام‌های ۲۴h: </span>
                    <span className="text-white">{r.messagesLast24h}</span>
                  </div>
                  <div>
                    <span className="opacity-70">آستانه: </span>
                    <span className="text-white">
                      {r.thresholdHours}h / {r.escalateHours}h
                    </span>
                  </div>
                  {r.lastPingAt && (
                    <div>
                      <span className="opacity-70">آخرین ping: </span>
                      <span className="text-white">
                        {relTime(new Date(r.lastPingAt))} (
                        {r.lastPingKind})
                      </span>
                    </div>
                  )}
                  {r.lastReactionAt && (
                    <div>
                      <span className="opacity-70">🌜 ری‌اکشن: </span>
                      <span className="text-white">
                        {relTime(new Date(r.lastReactionAt))}
                      </span>
                    </div>
                  )}
                </div>

                {customerStale && (
                  <div
                    className="text-[10px] text-amber-300 mb-2"
                    title="یه پیام جدیدتر توی این چت لاگ شده ولی به‌عنوان «کاربر» شناخته نشده — احتمالاً from_owner اشتباه ست شده."
                  >
                    ⚠ آخرین پیام چت {relTime(new Date(r.lastAnyMessageAt!))} — ولی
                    from_owner=customer نیست
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => ackChat(r.chatId)}
                    className="text-[10px] px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                    title="مارک کن به‌عنوان «متوجه شدم» — تا پیام جدید بعدی، دیگه ping نمی‌شه"
                  >
                    👌 ack
                  </button>
                  <button
                    onClick={() => disableFollowUp(r.chatId)}
                    className="text-[10px] px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-200 hover:bg-rose-500/20"
                    title="فالو‌آپ این چت رو خاموش کن — حتی برای پیام‌های بعدی، توی لاگ‌ها نمیاد"
                  >
                    🙈 بیخیال
                  </button>
                </div>
              </Card>
            );
          })}

          {hasMore && (
            <div
              ref={sentinelRef}
              className="text-[10px] text-center text-[var(--color-text-dim)] py-3"
            >
              ...
            </div>
          )}
          {!hasMore && sorted.length > PAGE_SIZE && (
            <div className="text-[10px] text-center text-[var(--color-text-dim)] py-3">
              · پایان لیست ({sorted.length} مورد) ·
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
