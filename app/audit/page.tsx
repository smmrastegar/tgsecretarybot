"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type Row = {
  id: number;
  createdAt: string;
  actorId: number | null;
  actorName: string | null;
  action: string;
  target: string | null;
  details: unknown;
};

const ACTION_TONE: Record<
  string,
  "neutral" | "success" | "warn" | "danger" | "info"
> = {
  "auth.login": "success",
  "auth.magic": "success",
  "auth.logout": "neutral",
  "settings.update": "info",
  "chatrule.update": "info",
  "message.handle": "success",
  "message.unhandle": "warn",
  "message.transcribe": "info",
  "groups.summary": "neutral",
};

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/audit");
    const j = (await r.json()) as { rows: Row[] };
    setRows(j.rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell>
      <PageTitle
        title="Audit log"
        subtitle="Every change made through the dashboard or by the cron."
        actions={
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            Refresh
          </button>
        }
      />

      {loading ? (
        <Card>Loading…</Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            No actions recorded yet.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Card key={r.id} className="!p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={ACTION_TONE[r.action] ?? "neutral"}>
                      {r.action}
                    </Badge>
                    {r.target && (
                      <span className="text-xs text-[var(--color-text-dim)]">
                        target: {r.target}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] mt-1">
                    {r.actorName ?? (r.actorId != null ? `user ${r.actorId}` : "system")}
                    {" · "}
                    {relTime(r.createdAt)}
                  </div>
                  {r.details != null && (
                    <pre className="mt-2 text-[11px] bg-[var(--color-surface-2)] rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(r.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
