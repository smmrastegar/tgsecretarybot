"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type Check = { ok: boolean; detail?: string; ms: number };

type HealthResponse = {
  ok: boolean;
  checks: Record<string, Check>;
  activity: Record<string, string | number | null>;
};

const CHECK_LABELS: Record<string, string> = {
  database: "Database (Neon)",
  telegram: "Telegram Bot API",
  openrouter: "OpenRouter (AI)",
  activity: "DB activity query",
};

const CHECK_HINT: Record<string, string> = {
  database: "If this is red, nothing else works.",
  telegram: "If red: BOT_TOKEN bad or Telegram unreachable. Bot can't send/receive.",
  openrouter:
    "If red: AI key invalid or OOM. AI suggest / Full AI / Friendly auto-reply will all fail.",
  activity: "Reads message_log/ai_usage counters for the dashboards below.",
};

function fmtTimestamp(v: unknown): string {
  if (!v) return "—";
  try {
    return `${relTime(String(v))} (${new Date(String(v)).toLocaleString()})`;
  } catch {
    return String(v);
  }
}

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [refreshingWebhook, setRefreshingWebhook] = useState(false);

  async function refreshWebhook() {
    setRefreshingWebhook(true);
    try {
      const r = await fetch("/api/health/refresh-webhook", { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`Refresh failed: ${j.error ?? r.status}`);
      }
    } catch (err) {
      alert(`Refresh failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRefreshingWebhook(false);
      await load();
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      const j = (await r.json()) as HealthResponse;
      setData(j);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell>
      <PageTitle
        title="Health"
        subtitle="Live status of every external dependency. If the bot 'just stopped working', the red light is usually here."
        actions={
          <div className="flex gap-2">
            <button
              onClick={refreshWebhook}
              disabled={refreshingWebhook}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              title="Re-subscribe to all Telegram update types (use this if delete/edit events aren't being received)"
            >
              {refreshingWebhook ? "Refreshing…" : "Re-register webhook"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {loading ? "Checking…" : "Re-check"}
            </button>
          </div>
        }
      />

      {error && (
        <Card className="mb-4 border-red-800">
          <div className="text-red-300 text-sm font-medium mb-1">
            Health endpoint itself failed
          </div>
          <div className="text-xs text-[var(--color-text-dim)] break-all">
            {error}
          </div>
        </Card>
      )}

      {data && (
        <>
          <Card className="mb-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  data.ok ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {data.ok
                    ? "All systems operational"
                    : "Something is broken — see below"}
                </div>
                {lastChecked && (
                  <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                    last checked {lastChecked.toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            {Object.entries(data.checks).map(([key, c]) => (
              <Card key={key} className="!p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {CHECK_LABELS[key] ?? key}
                    </div>
                    {CHECK_HINT[key] && (
                      <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                        {CHECK_HINT[key]}
                      </div>
                    )}
                  </div>
                  <Badge tone={c.ok ? "success" : "danger"}>
                    {c.ok ? "ok" : "fail"}
                  </Badge>
                </div>
                {c.detail && (
                  <div
                    className={`text-xs mt-2 break-all ${
                      c.ok
                        ? "text-[var(--color-text-dim)]"
                        : "text-red-300"
                    }`}
                  >
                    {c.detail}
                  </div>
                )}
                <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                  {c.ms} ms
                </div>
              </Card>
            ))}
          </div>

          {data.activity && Object.keys(data.activity).length > 0 && (
            <Card>
              <div className="text-sm font-medium mb-3">Recent activity</div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Last incoming message
                  </dt>
                  <dd>{fmtTimestamp(data.activity.last_msg_at)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">Last AI call</dt>
                  <dd>{fmtTimestamp(data.activity.last_ai_at)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Messages last 1h
                  </dt>
                  <dd>{data.activity.msgs_1h ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    AI calls last 1h
                  </dt>
                  <dd>{data.activity.ai_1h ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    AI cost last 24h
                  </dt>
                  <dd>
                    ${Number(data.activity.ai_cost_24h ?? 0).toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Updates last 1h
                  </dt>
                  <dd>{data.activity.updates_1h ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Active business connections
                  </dt>
                  <dd>{data.activity.bcs_enabled ?? 0}</dd>
                </div>
              </dl>
            </Card>
          )}
        </>
      )}

      {loading && !data && <Card>Checking…</Card>}
    </Shell>
  );
}
