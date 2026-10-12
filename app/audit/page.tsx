"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
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
  level: "info" | "warn" | "error";
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

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Controls are >= 40 px tall; fields 44 px.
const btn = "min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const chip = (on: boolean) =>
  `min-h-10 px-3 rounded-xl border text-sm ${
    on
      ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
      : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
  }`;
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2";
// Log text (messages, stacks, JSON) is code-like and mixed-direction, so it stays start-aligned inside the centred cards.
const pre = "mt-1 text-start text-xs bg-[var(--color-surface-2)] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono";
const summaryCls = "min-h-10 flex items-center justify-center text-xs text-[var(--color-text-dim)] cursor-pointer hover:text-white";

export default function SystemLogPage() {
  const [tab, setTab] = useState<Tab>("errors");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Error filters
  const [level, setLevel] = useState<"" | "error" | "warn" | "info">("");
  const [source, setSource] = useState<string>("");
  const [q, setQ] = useState("");
  const [sinceDays, setSinceDays] = useState<number | null>(null);

  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const p = new URLSearchParams({ kind: "both", limit: "300" });
      if (level) p.set("level", level);
      if (source) p.set("source", source);
      if (q.trim()) p.set("q", q.trim());
      if (sinceDays) p.set("days", String(sinceDays));
      const r = await fetch(`/api/audit?${p}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        rows: AuditRow[];
        errors: ErrorRow[];
        sources: SourceCount[];
      };
      setAudit(j.rows ?? []);
      setErrors(j.errors ?? []);
      setSources(j.sources ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
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

  const activeFilters = [source ? `subsystem: ${source}` : "", sinceDays ? `${fa(sinceDays)} روز` : ""].filter(Boolean);

  return (
    <Shell>
      <PageTitle
        title="🪵 لاگ سیستم"
        subtitle="هم تغییرات audit (هرچی از طریق dashboard یا cron انجام شد) هم خطاهای سیستم — با فیلتر، جستجو، و دکمه کپی برای هر خطا."
        actions={
          <button onClick={load} disabled={loading} className={btn}>
            {loading ? "..." : "🔄 رفرش"}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-2 mb-4" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "errors"}
          onClick={() => setTab("errors")}
          className={`min-h-12 px-2 rounded-xl border text-sm ${
            tab === "errors"
              ? "bg-rose-500/10 border-rose-500/40 text-rose-200"
              : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
          }`}
        >
          ⚠️ خطاهای سیستم ({fa(totalErrors)})
        </button>
        <button
          role="tab"
          aria-selected={tab === "audit"}
          onClick={() => setTab("audit")}
          className={`min-h-12 px-2 rounded-xl border text-sm ${
            tab === "audit"
              ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
              : "bg-[var(--color-surface-2)] border-[var(--color-border)]"
          }`}
        >
          📋 Audit ({fa(audit.length)})
        </button>
      </div>

      {loadError && (
        <Card className="mb-3 !border-red-800 !bg-red-900/20">
          <p className="text-sm text-red-200">بارگذاری لاگ ناموفق بود ({loadError})</p>
          <button onClick={load} className={`${btn} mt-3`}>تلاش دوباره</button>
        </Card>
      )}

      {tab === "errors" && (
        <>
          <Card className="mb-3">
            <div className="flex flex-wrap justify-center gap-2 mb-3">
              {(
                [
                  ["", `همه (${fa(totalErrors)})`],
                  ["error", `❌ error (${fa(errorOnly)})`],
                  ["warn", `⚠ warn (${fa(warnOnly)})`],
                  ["info", "ℹ info"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setLevel(v as "" | "error" | "warn" | "info")}
                  className={chip(level === v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 جستجو در message / stack / scope"
              aria-label="جستجو در message / stack / scope"
              className={field}
            />
            <div className="mt-3">
              <Section icon="🎚" title="فیلتر بیشتر" summary={activeFilters.length ? activeFilters.join(" · ") : "subsystem و بازه‌ی زمانی"} className="!mb-0">
                <div className="text-sm mb-2">زیرسیستم</div>
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                  <button onClick={() => setSource("")} className={chip(source === "")}>
                    همه‌ی subsystemها
                  </button>
                  {sources.map((s) => (
                    <button
                      key={s.source}
                      onClick={() => setSource(s.source)}
                      className={`${chip(source === s.source)} font-mono max-w-full break-all`}
                    >
                      {s.source} · {fa(s.count)}
                    </button>
                  ))}
                </div>
                <div className="text-sm mb-2">بازه‌ی زمانی</div>
                <select
                  value={sinceDays ?? ""}
                  aria-label="بازه‌ی زمانی"
                  onChange={(e) =>
                    setSinceDays(
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                  className={field}
                >
                  <option value="">از همیشه</option>
                  <option value="1">۲۴ ساعت اخیر</option>
                  <option value="3">۳ روز اخیر</option>
                  <option value="7">۷ روز اخیر</option>
                  <option value="30">۳۰ روز اخیر</option>
                </select>
              </Section>
            </div>
          </Card>

          {loading && errors.length === 0 && !loadError ? (
            <Card>
              <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
            </Card>
          ) : errors.length === 0 ? (
            !loadError && <EmptyState icon="✅" title="هیچ خطایی با این فیلتر ثبت نشده" hint="فیلترها رو عوض کن یا بازه‌ی زمانی رو بازتر کن." />
          ) : (
            <div className="flex flex-col gap-3">
              {errors.map((e) => {
                const tone =
                  e.level === "error" ? "danger" : e.level === "info" ? "info" : ("warn" as const);
                return (
                  <Card key={e.id} className="!p-3">
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <Badge tone={tone}>{e.level.toUpperCase()}</Badge>
                      <span className="text-xs text-[var(--color-text-dim)]">{relTime(e.createdAt)}</span>
                    </div>
                    <div dir="ltr" className="mt-1.5 text-xs font-mono text-[var(--color-text-dim)] break-all">
                      {e.source}
                      {e.scope && <span className="opacity-80"> · {e.scope}</span>}
                    </div>
                    <div
                      dir="auto"
                      className="text-xs leading-6 my-2 font-mono whitespace-pre-wrap [overflow-wrap:anywhere] text-start"
                    >
                      {e.message}
                    </div>
                    {e.stack && (
                      <details className="mt-1">
                        <summary className={summaryCls}>
                          ▾ stack trace
                        </summary>
                        <pre dir="ltr" className={`${pre} text-[var(--color-text-dim)]`}>
                          {e.stack}
                        </pre>
                      </details>
                    )}
                    {e.details != null && (
                      <details className="mt-1">
                        <summary className={summaryCls}>
                          ▾ جزئیات
                        </summary>
                        <pre dir="ltr" className={`${pre} text-[var(--color-text-dim)]`}>
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      </details>
                    )}
                    <div className="mt-2">
                      <button
                        onClick={() => copyError(e)}
                        className={`${btn} ${
                          copied === e.id
                            ? "!bg-emerald-500/15 !border-emerald-500/40 text-emerald-200"
                            : "bg-[var(--color-surface-2)]"
                        }`}
                      >
                        {copied === e.id ? "✓ کپی شد" : "📋 کپی"}
                      </button>
                    </div>
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
            !loadError && !loading && <EmptyState icon="📋" title="هنوز هیچ تغییری ثبت نشده" hint="هر تغییری که از داشبورد یا cron انجام بشه اینجا میاد." />
          ) : (
            <div className="flex flex-col gap-3">
              {audit.map((r) => (
                <Card key={r.id} className="!p-3">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <Badge tone={ACTION_TONE[r.action] ?? "neutral"}>
                      {r.action}
                    </Badge>
                  </div>
                  {r.target && (
                    <div dir="ltr" className="mt-1.5 text-xs text-[var(--color-text-dim)] font-mono break-all">
                      هدف: {r.target}
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-text-dim)] mt-1">
                    {r.actorName ??
                      (r.actorId != null ? `user ${r.actorId}` : "system")}
                    {" · "}
                    {relTime(r.createdAt)}
                  </div>
                  {r.details != null && (
                    <pre dir="ltr" className={`${pre} mt-2`}>
                      {JSON.stringify(r.details, null, 2)}
                    </pre>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
