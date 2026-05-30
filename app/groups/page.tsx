"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime, truncate } from "@/lib/format";

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

export default function GroupsPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/groups");
    const j = (await r.json()) as { summaries: Summary[] };
    setSummaries(j.summaries);
    setLoading(false);
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
      setMsg(`Summarized ${j.summarized ?? 0} of ${j.chats ?? 0} groups.`);
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Shell>
      <PageTitle
        title="Group analyzer"
        subtitle="Daily AI summaries of your group chats."
        actions={
          <button
            disabled={running}
            onClick={runNow}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Running…" : "Summarize now (24h)"}
          </button>
        }
      />

      {msg && (
        <Card className="mb-6">
          <p className="text-sm text-[var(--color-text-dim)]">{msg}</p>
        </Card>
      )}

      {loading ? (
        <Card>Loading…</Card>
      ) : summaries.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            No summaries yet. The daily cron runs at 03:00 UTC, or click{" "}
            <em>Summarize now</em> to generate one manually.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {summaries.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between mb-3 gap-3">
                <div>
                  <div className="font-medium">
                    {s.chatTitle ?? `chat ${s.chatId}`}
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] mt-1">
                    {new Date(s.periodStart).toLocaleString()} —{" "}
                    {new Date(s.periodEnd).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone="neutral">
                    {s.messageCount} msg · {s.activeSenders} ppl
                  </Badge>
                  {s.mentionsOwner && <Badge tone="warn">mentions you</Badge>}
                </div>
              </div>
              <p className="text-sm leading-relaxed mb-3 whitespace-pre-wrap">
                {s.summary || (
                  <span className="text-[var(--color-text-dim)]">
                    No summary text.
                  </span>
                )}
              </p>
              {s.topics.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs text-[var(--color-text-dim)] mb-1">
                    Topics
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.topics.map((t, i) => (
                      <Badge key={i} tone="info">
                        {truncate(t, 40)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {s.actionItems.length > 0 && (
                <div>
                  <div className="text-xs text-[var(--color-text-dim)] mb-1">
                    Action items
                  </div>
                  <ul className="text-sm list-disc pl-5 space-y-0.5">
                    {s.actionItems.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-xs text-[var(--color-text-dim)] mt-3">
                Created {relTime(s.createdAt)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
