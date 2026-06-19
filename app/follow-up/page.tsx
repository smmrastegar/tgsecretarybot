"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, TableWrap } from "@/components/Card";
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
  would_ping_first: "🔔 آماده ping اول",
  would_ping_escalate: "🚨 آماده escalate",
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

const DEFAULT_FILTER: Decided[] = ["would_ping_first", "would_ping_escalate"];

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} دقیقه`;
  if (h < 48) return `${h.toFixed(1)} ساعت`;
  return `${(h / 24).toFixed(1)} روز`;
}

export default function FollowUpDebugPage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Set<Decided>>(new Set(DEFAULT_FILTER));
  const [q, setQ] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

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
      if (active.size > 0 && !active.has(r.decided)) return false;
      if (ql) {
        const hay = (r.name ?? "").toLowerCase() + " " + String(r.chatId);
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

  const toggle = (d: Decided) => {
    setActive((cur) => {
      const next = new Set(cur);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
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
        subtitle="هر چتی که این لحظه پیامش از طرف مشتری بدون جواب مونده — با فیلتر، جستجو، و trigger دستی."
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
          {orderedKeys.map((k) => {
            const cnt = aggBuckets[k] ?? 0;
            if (cnt === 0) return null;
            const isOn = active.has(k);
            const tone = DECIDED_TONES[k];
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                className={`text-[11px] px-2 py-1 rounded-md border transition ${
                  isOn
                    ? TONE_CLASSES[tone]
                    : "text-[var(--color-text-dim)] bg-transparent border-[var(--color-border)] opacity-60"
                }`}
              >
                {DECIDED_LABELS[k]} · {cnt}
              </button>
            );
          })}
          <button
            onClick={() => setActive(new Set())}
            className="text-[11px] px-2 py-1 rounded-md text-[var(--color-text-dim)] hover:underline"
          >
            (همه)
          </button>
          <button
            onClick={() => setActive(new Set(DEFAULT_FILTER))}
            className="text-[11px] px-2 py-1 rounded-md text-[var(--color-text-dim)] hover:underline"
          >
            (فقط کاندیدها)
          </button>
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

      <Card>
        <TableWrap>
          <table className="w-full text-xs">
            <thead className="text-[var(--color-text-dim)]">
              <tr className="text-right border-b border-[var(--color-border)]">
                <th className="py-2 px-2">نام</th>
                <th className="py-2 px-2">وضعیت</th>
                <th className="py-2 px-2">آخرین پیام مشتری</th>
                <th className="py-2 px-2">آخرین فعالیت تو</th>
                <th className="py-2 px-2">۲۴h</th>
                <th className="py-2 px-2">آستانه</th>
                <th className="py-2 px-2">آخرین ping</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-6 px-2 text-center text-[var(--color-text-dim)]"
                  >
                    چیزی برای نمایش نیست.
                  </td>
                </tr>
              )}
              {sorted.map((r) => {
                const tone = DECIDED_TONES[r.decided];
                const customerStale =
                  r.lastAnyMessageAt &&
                  r.lastCustomerMessageAt &&
                  new Date(r.lastAnyMessageAt).getTime() -
                    new Date(r.lastCustomerMessageAt).getTime() >
                    3600_000;
                return (
                  <tr
                    key={r.chatId}
                    className="border-b border-[var(--color-border)]/40 hover:bg-[var(--color-surface-2)]/50"
                  >
                    <td className="py-2 px-2">
                      <Link
                        href={`/chats/${r.chatId}`}
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        {r.name || `chat ${r.chatId}`}
                      </Link>
                      <div className="text-[10px] text-[var(--color-text-dim)]">
                        {r.chatId}
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`inline-block text-[10px] px-1.5 py-0.5 rounded-md border ${TONE_CLASSES[tone]}`}
                      >
                        {DECIDED_LABELS[r.decided]}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <div>{fmtHours(r.hoursSinceCustomer)}</div>
                      {r.lastCustomerMessageAt && (
                        <div className="text-[10px] text-[var(--color-text-dim)]">
                          {relTime(new Date(r.lastCustomerMessageAt))}
                        </div>
                      )}
                      {customerStale && (
                        <div
                          className="text-[10px] text-amber-300 mt-0.5"
                          title="یه پیام جدیدتر توی این چت لاگ شده ولی به‌عنوان «مشتری» شناخته نشده — احتمالاً from_owner اشتباه ست شده."
                        >
                          ⚠ آخرین پیام چت {relTime(new Date(r.lastAnyMessageAt!))} — ولی from_owner=customer نیست
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-[var(--color-text-dim)]">
                      <div>
                        {r.lastOwnerMessageAt
                          ? relTime(new Date(r.lastOwnerMessageAt))
                          : "—"}
                      </div>
                      {r.lastReactionAt ? (
                        <div
                          className="text-[10px] mt-0.5"
                          title={`ری‌اکشن آخر در ${r.lastReactionAt} (کل: ${r.reactionsTotal})`}
                        >
                          🌜 ری‌اکشن: {relTime(new Date(r.lastReactionAt))}
                          {r.reactionsTotal > 1 && ` (${r.reactionsTotal})`}
                        </div>
                      ) : r.reactionsTotal === 0 ? (
                        <div
                          className="text-[10px] mt-0.5 text-red-300"
                          title="هیچ ری‌اکشنی از این چت توی DB ثبت نشده — احتمالاً bot ری‌اکشن نمی‌گیره."
                        >
                          ❌ ۰ ری‌اکشن ثبت‌شده
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 px-2 text-[var(--color-text-dim)] text-center">
                      {r.messagesLast24h}
                    </td>
                    <td className="py-2 px-2 text-[var(--color-text-dim)]">
                      {r.thresholdHours}h / {r.escalateHours}h
                    </td>
                    <td className="py-2 px-2 text-[var(--color-text-dim)]">
                      {r.lastPingAt ? (
                        <>
                          {relTime(new Date(r.lastPingAt))}
                          <div className="text-[10px]">{r.lastPingKind}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex flex-col gap-1">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </Shell>
  );
}
