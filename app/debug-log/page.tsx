"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, TableWrap } from "@/components/Card";
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

export default function DebugLogPage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [chatIdFilter, setChatIdFilter] = useState("");
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={load}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-50"
          >
            {loading ? "..." : "🔄 رفرش"}
          </button>
          <span className="text-xs text-[var(--color-text-dim)] mr-auto">
            {filtered.length} نمایش
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setActiveType(null)}
            className={`text-[11px] px-2 py-1 rounded-md border ${
              activeType == null
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
            }`}
          >
            همه
          </button>
          {buckets.map((b) => {
            const isReaction = REACTION_TYPES.has(b.updateType);
            const isOn = activeType === b.updateType;
            return (
              <button
                key={b.updateType}
                onClick={() => setActiveType(b.updateType)}
                className={`text-[11px] px-2 py-1 rounded-md border ${
                  isOn
                    ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                    : isReaction
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                      : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
                }`}
              >
                {isReaction ? "🌟 " : ""}
                {b.updateType} · {b.count}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            type="text"
            value={chatIdFilter}
            onChange={(e) => setChatIdFilter(e.target.value)}
            placeholder="🔢 فیلتر chatId"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 جستجو توی preview / bcId"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          />
        </div>
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
                <th className="py-2 px-2">زمان</th>
                <th className="py-2 px-2">نوع</th>
                <th className="py-2 px-2">چت</th>
                <th className="py-2 px-2">کاربر</th>
                <th className="py-2 px-2">bcId</th>
                <th className="py-2 px-2">preview</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 px-2 text-center text-[var(--color-text-dim)]"
                  >
                    هیچ لاگی نیست.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isReaction = REACTION_TYPES.has(r.updateType);
                const expanded = expandedId === r.id;
                return (
                  <>
                    <tr
                      key={r.id}
                      className="border-b border-[var(--color-border)]/40 hover:bg-[var(--color-surface-2)]/50 cursor-pointer"
                      onClick={() =>
                        setExpandedId(expanded ? null : r.id)
                      }
                    >
                      <td className="py-2 px-2 text-[var(--color-text-dim)]">
                        {relTime(new Date(r.receivedAt))}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={`inline-block text-[10px] px-1.5 py-0.5 rounded-md border ${
                            isReaction
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                              : "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-dim)]"
                          }`}
                        >
                          {r.updateType}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        {r.chatId ? (
                          <Link
                            href={`/chats/${r.chatId}`}
                            className="text-[var(--color-accent)] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.chatId}
                          </Link>
                        ) : (
                          <span className="text-[var(--color-text-dim)]">—</span>
                        )}
                        {r.chatType && (
                          <div className="text-[10px] text-[var(--color-text-dim)]">
                            {r.chatType}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-[var(--color-text-dim)]">
                        {r.userId ?? "—"}
                      </td>
                      <td className="py-2 px-2 text-[var(--color-text-dim)] font-mono text-[10px]">
                        {r.businessConnectionId
                          ? r.businessConnectionId.slice(0, 16) + "…"
                          : "—"}
                      </td>
                      <td className="py-2 px-2 text-[var(--color-text-dim)]">
                        <div className="max-w-[40ch] truncate" title={r.preview ?? ""}>
                          {r.preview || (
                            <span className="opacity-50">(empty)</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${r.id}-payload`}>
                        <td
                          colSpan={6}
                          className="py-2 px-2 bg-[var(--color-surface-2)]/30"
                        >
                          <pre
                            className="text-[10px] overflow-auto max-h-[400px] whitespace-pre-wrap font-mono text-[var(--color-text-dim)]"
                            dir="ltr"
                          >
                            {JSON.stringify(r.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </Shell>
  );
}
