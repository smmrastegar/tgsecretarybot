"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Card, PageTitle } from "@/components/Card";
import GroupAnalyticsView, { type Analysis } from "@/components/GroupAnalyticsView";

type PublicResponse = {
  ok: boolean;
  empty?: boolean;
  chatTitle: string | null;
  sinceIso: string | null;
  messageCount: number;
  analysis: Analysis | null;
  cachedAt?: string;
  ageDays?: number | null;
  requestedDays?: number;
  servedDays?: number | null;
  fellBack?: boolean;
  availableWindows?: number[];
  error?: string;
};

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: "۳ روز", days: 3 },
  { label: "۷ روز", days: 7 },
  { label: "۱۴ روز", days: 14 },
  { label: "۳۰ روز", days: 30 },
  { label: "🗂 از ابتدا", days: 0 },
];

function faDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
}

function windowLabel(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days === 0) return "از ابتدا";
  return WINDOWS.find((w) => w.days === days)?.label ?? `${days} روز`;
}

// How stale is this snapshot? Drives the colour of the freshness banner.
function freshness(ageDays: number | null | undefined) {
  if (ageDays == null) return null;
  if (ageDays <= 1) return { tone: "ok", text: ageDays === 0 ? "امروز" : "دیروز" };
  if (ageDays <= 7) return { tone: "ok", text: `${ageDays} روز پیش` };
  if (ageDays <= 30) return { tone: "warn", text: `${ageDays} روز پیش` };
  return { tone: "stale", text: `${ageDays} روز پیش` };
}

export default function PublicGroupAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { token } = use(params);
  const sp = use(searchParams);
  const initialDays =
    sp.days === "0" || sp.days === "all" ? 0 : sp.days ? Number(sp.days) || 0 : 0;

  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState<PublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/public/groups/${token}?days=${windowDays}`);
        const j = (await r.json()) as PublicResponse;
        if (!r.ok) throw new Error(j.error ?? "دریافت گزارش ناموفق بود");
        setData(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load(days);
  }, [days, load]);

  // Only offer windows that actually have a cached report. Before the
  // first response we optimistically show all of them.
  const availables = data?.availableWindows;
  const shown = availables?.length
    ? WINDOWS.filter((w) => availables.includes(w.days))
    : WINDOWS;
  const active = data?.servedDays ?? days;
  const fresh = freshness(data?.ageDays);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]" dir="rtl">
      <main className="max-w-4xl mx-auto p-4 md:p-8">
        <PageTitle
          title={data?.chatTitle ? `📊 ${data.chatTitle}` : "📊 گزارش گروه"}
          subtitle="نمای فقط-خواندنی از گزارش این گروه"
          actions={
            shown.length > 1 ? (
              <div className="flex gap-2 flex-wrap">
                {shown.map((w) => {
                  const on = active === w.days;
                  return (
                    <button
                      key={w.days}
                      onClick={() => setDays(w.days)}
                      disabled={loading}
                      className={`text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
                        on
                          ? "bg-[var(--color-accent)] text-white border-transparent"
                          : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            ) : null
          }
        />

        {/* Freshness / scope — the viewer must know what they're looking at */}
        {data?.analysis && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed flex flex-wrap items-center gap-x-3 gap-y-1 ${
              fresh?.tone === "stale"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : fresh?.tone === "warn"
                  ? "border-amber-500/25 bg-amber-500/5 text-amber-100/90"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
            }`}
          >
            <span>
              <span className="opacity-70">بازه:</span>{" "}
              <b className="text-[var(--color-text)]">{windowLabel(active)}</b>
            </span>
            <span className="opacity-40">·</span>
            <span>
              <span className="opacity-70">پیام‌های بررسی‌شده:</span>{" "}
              <b className="text-[var(--color-text)]">
                {data.messageCount.toLocaleString("fa-IR")}
              </b>
            </span>
            {data.sinceIso && (
              <>
                <span className="opacity-40">·</span>
                <span>از {faDate(data.sinceIso)}</span>
              </>
            )}
            {data.cachedAt && (
              <>
                <span className="opacity-40">·</span>
                <span>
                  <span className="opacity-70">تولید گزارش:</span> {faDate(data.cachedAt)}
                  {fresh ? ` (${fresh.text})` : ""}
                </span>
              </>
            )}
            {fresh?.tone === "stale" && (
              <span className="w-full">
                ⚠️ این گزارش به‌روز نیست و ممکنه وضعیت فعلی گروه را نشون نده.
              </span>
            )}
            {data.fellBack && (
              <span className="w-full opacity-90">
                برای بازه‌ی «{windowLabel(data.requestedDays)}» گزارشی موجود نبود؛ نزدیک‌ترین
                بازه‌ی موجود («{windowLabel(active)}») نمایش داده شده.
              </span>
            )}
          </div>
        )}

        {err && (
          <Card className="mb-4 border-red-800">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-red-300">{err}</p>
              <button
                onClick={() => load(days)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                تلاش دوباره
              </button>
            </div>
          </Card>
        )}

        {/* Loading only takes over the screen on the FIRST load; later it
            dims the existing report instead of blanking the page. */}
        {loading && !data && (
          <Card>
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-1/3 rounded bg-[var(--color-surface-2)]" />
              <div className="h-3 w-full rounded bg-[var(--color-surface-2)]" />
              <div className="h-3 w-5/6 rounded bg-[var(--color-surface-2)]" />
            </div>
          </Card>
        )}

        {!loading && data?.empty && (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)] leading-relaxed">
              هنوز گزارشی برای این گروه منتشر نشده. لطفاً بعداً دوباره سر بزن.
            </p>
          </Card>
        )}

        {data?.analysis && (
          <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <GroupAnalyticsView
              analysis={data.analysis}
              messageCount={data.messageCount}
              sinceIso={data.sinceIso}
            />
          </div>
        )}
      </main>
    </div>
  );
}
