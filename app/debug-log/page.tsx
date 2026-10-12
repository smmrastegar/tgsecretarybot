"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { relTime } from "@/lib/format";

type Row = {
  id: number;
  receivedAt: string;
  updateId: number | null;
  updateType: string;
  chatId: number | null;
  chatType: string | null;
  userId: number | null;
  businessConnectionId: string | null;
  preview: string | null;
  payload: unknown;
};

type Response = {
  ok: boolean;
  rows: Row[];
  buckets: Array<{ updateType: string; count: number }>;
  backend?: "redis" | "db-fallback";
};

const REACTION_TYPES = new Set(["message_reaction", "message_reaction_count"]);

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Controls are >= 40 px tall; fields 44 px.
const btn = "min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const chip = (on: boolean, reaction = false) =>
  `min-h-10 px-3 rounded-xl border text-sm ${
    on
      ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
      : reaction
        ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
        : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
  }`;
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2";

export default function DebugLogPage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [chatIdFilter, setChatIdFilter] = useState("");
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [refreshingWebhook, setRefreshingWebhook] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (activeType) params.set("type", activeType);
      if (chatIdFilter.trim()) params.set("chatId", chatIdFilter.trim());
      if (q.trim()) params.set("q", q.trim());
      const r = await fetch(`/api/debug-log?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Response);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Initial load + reload on filter change + auto-refresh every 5s
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const refreshWebhook = async () => {
    setRefreshingWebhook(true);
    setWebhookMsg(null);
    try {
      const r = await fetch("/api/health/refresh-webhook", { method: "POST" });
      const j = (await r.json()) as {
        ok?: boolean;
        info?: { allowed_updates?: string[] };
        error?: string;
      };
      if (r.ok && j.ok) {
        const list = (j.info?.allowed_updates ?? []).join(", ") || "(default)";
        setWebhookMsg(`✅ webhook ست شد — allowed_updates: ${list}`);
      } else {
        setWebhookMsg(`❌ ${j.error ?? `HTTP ${r.status}`}`);
      }
    } catch (e) {
      setWebhookMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshingWebhook(false);
    }
  };

  const filtered = useMemo<Row[]>(() => {
    if (!data) return [];
    let r = data.rows;
    if (chatIdFilter.trim()) {
      const id = Number(chatIdFilter.trim());
      if (Number.isFinite(id)) r = r.filter((x) => x.chatId === id);
    }
    if (q.trim()) {
      const ql = q.toLowerCase();
      r = r.filter(
        (x) =>
          (x.preview ?? "").toLowerCase().includes(ql) ||
          String(x.chatId ?? "").includes(ql) ||
          (x.businessConnectionId ?? "").toLowerCase().includes(ql),
      );
    }
    return r;
  }, [data, chatIdFilter, q]);

  const buckets = data?.buckets ?? [];

  return (
    <Shell>
      <PageTitle
        title="🪵 Debug Log"
        subtitle={`هر Update که آخرین یک ساعت به webhook رسیده. هر ۵ ثانیه auto-refresh.${
          data?.backend ? ` (storage: ${data.backend})` : ""
        }`}
      />

      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} disabled={loading} className={btn}>
            {loading ? "..." : "🔄 رفرش"}
          </button>
          <button
            onClick={refreshWebhook}
            disabled={refreshingWebhook}
            className="min-h-10 px-4 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sm text-sky-200 disabled:opacity-50"
            title="setWebhook رو با ALLOWED_UPDATES فعلی صدا می‌زنه. لازم بعد از هر اضافه شدن نوع جدید update."
          >
            {refreshingWebhook ? "..." : "📡 webhook رو refresh کن"}
          </button>
        </div>
        <div className="mt-2 text-xs text-[var(--color-text-dim)]">{fa(filtered.length)} نمایش</div>
        {webhookMsg && (
          <div role="status" className="text-xs leading-6 text-[var(--color-text-dim)] mt-2 px-1 break-all">
            {webhookMsg}
          </div>
        )}
      </Card>

      <Section icon="🔍" title="چرا ری‌اکشن نمی‌بینم؟" summary="محدودیت‌های Telegram Bot API">
        <div className="text-xs leading-7 text-[var(--color-text-dim)]">
          طبق Telegram Bot API:
          <br />• توی <b>گروه/کانال</b>: بات باید <b>administrator</b> باشه (فقط عضو کافی نیست) تا
          {" "}<code>message_reaction</code> فایر بشه.
          <br />• توی <b>چت Business</b>: ری‌اکشن owner روی پیام مشتری اصلاً به bot نمی‌رسه — این محدودیت Telegram هست. باید از دکمه «👌 ack» توی Follow-up استفاده کنی.
          <br />• <code>message_reaction_count</code> فقط برای <b>کانال‌ها</b> (anonymous aggregate) هست.
          <br />• اگه نوع update جدید اضافه شده، باید webhook رو refresh کنی.
        </div>
      </Section>

      <Card className="mb-4">
        <div className="flex flex-wrap justify-center gap-2 mb-3">
          <button onClick={() => setActiveType(null)} className={chip(activeType == null)}>
            همه
          </button>
          {buckets.map((b) => {
            const isReaction = REACTION_TYPES.has(b.updateType);
            return (
              <button
                key={b.updateType}
                onClick={() => setActiveType(b.updateType)}
                className={`${chip(activeType === b.updateType, isReaction)} break-all`}
              >
                {isReaction ? "🌟 " : ""}
                {b.updateType} · {fa(b.count)}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            type="text"
            dir="ltr"
            inputMode="numeric"
            value={chatIdFilter}
            onChange={(e) => setChatIdFilter(e.target.value)}
            placeholder="🔢 فیلتر chatId"
            aria-label="فیلتر chatId"
            className={field}
          />
          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 جستجو توی preview / bcId"
            aria-label="جستجو توی preview / bcId"
            className={field}
          />
        </div>
      </Card>

      {err && (
        <Card className="mb-4 !border-red-800 !bg-red-900/20">
          <div className="text-sm text-red-200">خطا: {err}</div>
          <button onClick={load} className={`${btn} mt-3`}>تلاش دوباره</button>
        </Card>
      )}

      {!data && !err ? (
        <Card>
          <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
        </Card>
      ) : filtered.length === 0 ? (
        !err && <EmptyState icon="🪵" title="هیچ لاگی نیست" hint="هنوز Updateای توی یک ساعت اخیر به webhook نرسیده، یا فیلترها همه رو حذف کرده." />
      ) : (
        // One card per update (instead of a 6-column table that scrolled sideways on phones).
        <div className="flex flex-col gap-2">
          {filtered.map((r) => {
            const isReaction = REACTION_TYPES.has(r.updateType);
            const expanded = expandedId === r.id;
            return (
              <Card key={r.id} className="!p-3">
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span
                    className={`inline-block text-xs px-2 py-0.5 rounded-lg border ${
                      isReaction
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                        : "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-dim)]"
                    }`}
                  >
                    {r.updateType}
                  </span>
                  <span className="text-xs text-[var(--color-text-dim)]">{relTime(new Date(r.receivedAt))}</span>
                </div>
                <p dir="auto" className="mt-2 text-sm leading-6 line-clamp-3 [overflow-wrap:anywhere]">
                  {r.preview || <span className="opacity-50 text-[var(--color-text-dim)]">(خالی)</span>}
                </p>
                <div className="mt-2 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-xs text-[var(--color-text-dim)]">
                  {r.chatId ? (
                    <Link href={`/chats/${r.chatId}`} className="inline-flex min-h-10 items-center text-[var(--color-accent)] hover:underline">
                      چت {r.chatId}
                    </Link>
                  ) : (
                    <span>چت —</span>
                  )}
                  {r.chatType && <span>{r.chatType}</span>}
                  <span>کاربر {r.userId ?? "—"}</span>
                  {r.businessConnectionId && (
                    <span dir="ltr" className="font-mono">bc {r.businessConnectionId.slice(0, 16)}…</span>
                  )}
                </div>
                <div className="mt-1">
                  <button onClick={() => setExpandedId(expanded ? null : r.id)} aria-expanded={expanded} className={btn}>
                    {expanded ? "▴ payload" : "▾ payload"}
                  </button>
                </div>
                {expanded && (
                  <pre
                    className="mt-2 text-start text-xs overflow-auto max-h-[400px] whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[var(--color-text-dim)] bg-[var(--color-surface-2)] rounded-xl p-3"
                    dir="ltr"
                  >
                    {JSON.stringify(r.payload, null, 2)}
                  </pre>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
