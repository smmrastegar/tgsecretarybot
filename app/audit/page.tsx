"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type AuditRow = {
  id: number;
  createdAt: string;
  actorId: number | null;
  actorName: string | null;
  action: string;
  target: string | null;
  details: unknown;
};

type ErrorRow = {
  id: number;
  createdAt: string;
  level: "warn" | "error";
  source: string;
  message: string;
  stack: string | null;
  scope: string | null;
  details: unknown;
};

type SourceCount = { source: string; count: number };

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

type Tab = "errors" | "audit";

export default function SystemLogPage() {
  const [tab, setTab] = useState<Tab>("errors");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [loading, setLoading] = useState(true);

  // Error filters
  const [level, setLevel] = useState<"" | "error" | "warn">("");
  const [source, setSource] = useState<string>("");
  const [q, setQ] = useState("");
  const [sinceDays, setSinceDays] = useState<number | null>(null);

  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ kind: "both", limit: "300" });
      if (level) p.set("level", level);
      if (source) p.set("source", source);
      if (q.trim()) p.set("q", q.trim());
      if (sinceDays) p.set("days", String(sinceDays));
      const r = await fetch(`/api/audit?${p}`);
      if (r.ok) {
        const j = (await r.json()) as {
          rows: AuditRow[];
          errors: ErrorRow[];
          sources: SourceCount[];
        };
        setAudit(j.rows ?? []);
        setErrors(j.errors ?? []);
        setSources(j.sources ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [level, source, q, sinceDays]);

  // Initial + debounced re-fetch on filter change
  useEffect(() => {
    const t = setTimeout(load, q.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const totalErrors = errors.length;
  const errorOnly = useMemo(
    () => errors.filter((e) => e.level === "error").length,
    [errors],
  );
  const warnOnly = useMemo(
    () => errors.filter((e) => e.level === "warn").length,
    [errors],
  );

  async function copyError(e: ErrorRow) {
    const text = [
      `[${e.level.toUpperCase()}] ${e.source}`,
      `time: ${e.createdAt}`,
      e.scope ? `scope: ${e.scope}` : null,
      "",
      e.message,
      "",
      e.stack ? `stack:\n${e.stack}` : null,
      e.details
        ? `details:\n${JSON.stringify(e.details, null, 2)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(e.id);
      setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1500);
    } catch {
      // best-effort
    }
  }

  return (
    <Shell>
      <PageTitle
        title="🪵 System Log"
        subtitle="هم تغییرات audit (هرچی از طریق dashboard یا cron انجام شد) هم خطاهای سیستم — با فیلتر، جستجو، و دکمه کپی برای هر خطا."
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {loading ? "..." : "🔄 رفرش"}
          </button>
        }
      />

      <div className="flex gap-2 mb-3 flex-wrap" role="tablist">
        <button
          onClick={() => setTab("errors")}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            tab === "errors"
              ? "bg-rose-500/10 border-rose-500/40 text-rose-200"
              : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
          }`}
        >
          ⚠️ خطاهای سیستم ({totalErrors})
        </button>
        <button
          onClick={() => setTab("audit")}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            tab === "audit"
              ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
              : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
          }`}
        >
          📋 Audit ({audit.length})
        </button>
      </div>

      {tab === "errors" && (
        <>
          <Card className="mb-3">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(
                [
                  ["", `همه (${totalErrors})`],
                  ["error", `❌ error (${errorOnly})`],
                  ["warn", `⚠ warn (${warnOnly})`],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setLevel(v as "" | "error" | "warn")}
                  className={`text-[11px] px-2 py-1 rounded-md border ${
                    level === v
                      ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                      : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                onClick={() => setSource("")}
                className={`text-[11px] px-2 py-1 rounded-md border ${
                  source === ""
                    ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                    : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
                }`}
              >
                همه subsystems
              </button>
              {sources.map((s) => (
                <button
                  key={s.source}
                  onClick={() => setSource(s.source)}
                  className={`text-[10px] px-2 py-1 rounded-md border font-mono ${
                    source === s.source
                      ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                      : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
                  }`}
                >
                  {s.source} · {s.count}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="🔍 جستجو در message / stack / scope"
                className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              />
              <select
                value={sinceDays ?? ""}
                onChange={(e) =>
                  setSinceDays(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              >
                <option value="">از همیشه</option>
                <option value="1">۲۴ ساعت اخیر</option>
                <option value="3">۳ روز اخیر</option>
                <option value="7">۷ روز اخیر</option>
                <option value="30">۳۰ روز اخیر</option>
              </select>
            </div>
          </Card>

          {loading && errors.length === 0 ? (
            <Card>
              <div className="text-xs text-[var(--color-text-dim)]">...</div>
            </Card>
          ) : errors.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                هیچ خطایی با این فیلتر ثبت نشده.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {errors.map((e) => {
                const tone =
                  e.level === "error" ? "danger" : ("warn" as const);
                return (
                  <Card key={e.id} className="!p-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <Badge tone={tone}>{e.level.toUpperCase()}</Badge>
                        <span className="text-[11px] font-mono text-[var(--color-text-dim)]">
                          {e.source}
                        </span>
                        {e.scope && (
                          <span className="text-[10px] text-[var(--color-text-dim)] font-mono">
                            {e.scope}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-[var(--color-text-dim)]">
                          {relTime(e.createdAt)}
                        </span>
                        <button
                          onClick={() => copyError(e)}
                          className={`text-[10px] px-2 py-1 rounded-md border ${
                            copied === e.id
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                              : "bg-[var(--color-surface-2)] border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                          }`}
                        >
                          {copied === e.id ? "✓ کپی شد" : "📋 کپی"}
                        </button>
                      </div>
                    </div>
                    <div
                      dir="auto"
                      className="text-xs leading-relaxed mb-2 font-mono whitespace-pre-wrap break-all"
                    >
                      {e.message}
                    </div>
                    {e.stack && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-[var(--color-text-dim)] cursor-pointer hover:text-white">
                          ▾ stack trace
                        </summary>
                        <pre
                          dir="ltr"
                          className="mt-1 text-[10px] bg-[var(--color-surface-2)] rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[var(--color-text-dim)]"
                        >
                          {e.stack}
                        </pre>
                      </details>
                    )}
                    {e.details != null && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-[var(--color-text-dim)] cursor-pointer hover:text-white">
                          ▾ details
                        </summary>
                        <pre
                          dir="ltr"
                          className="mt-1 text-[10px] bg-[var(--color-surface-2)] rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[var(--color-text-dim)]"
                        >
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "audit" && (
        <>
          {audit.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                هنوز هیچ تغییری ثبت نشده.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {audit.map((r) => (
                <Card key={r.id} className="!p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={ACTION_TONE[r.action] ?? "neutral"}>
                          {r.action}
                        </Badge>
                        {r.target && (
                          <span className="text-xs text-[var(--color-text-dim)] font-mono">
                            target: {r.target}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-dim)] mt-1">
                        {r.actorName ??
                          (r.actorId != null ? `user ${r.actorId}` : "system")}
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
        </>
      )}
    </Shell>
  );
}
