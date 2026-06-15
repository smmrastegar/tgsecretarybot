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
  error?: string;
};

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: "۳ روز", days: 3 },
  { label: "۷ روز", days: 7 },
  { label: "۱۴ روز", days: 14 },
  { label: "۳۰ روز", days: 30 },
];

export default function PublicGroupAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { token } = use(params);
  const sp = use(searchParams);
  const initialDays = Number(sp.days) || 7;
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
        if (!r.ok) throw new Error(j.error ?? "failed");
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

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
      dir="rtl"
    >
      <main className="max-w-4xl mx-auto p-4 md:p-8">
        <PageTitle
          title={
            data?.chatTitle ? `📊 ${data.chatTitle}` : `📊 گزارش گروه`
          }
          subtitle="نمای فقط-خواندنی از گزارش این گروه. این لینک عمومی هست — هر کس داشته باشه می‌تونه ببینه."
          actions={
            <div className="flex gap-2 flex-wrap">
              {WINDOWS.map((w) => (
                <button
                  key={w.days}
                  onClick={() => setDays(w.days)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${
                    days === w.days
                      ? "bg-[var(--color-accent)] text-white border-transparent"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          }
        />

        {err && (
          <Card className="mb-4 border-red-800">
            <p className="text-sm text-red-300">{err}</p>
          </Card>
        )}

        {loading && (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
          </Card>
        )}

        {data?.empty && (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">
              برای این بازه گزارشی هنوز تولید نشده. صاحب اکانت باید یه بار از /groups/&lt;id&gt;
              «پردازش مجدد» رو با این بازه بزنه تا کش پر بشه.
            </p>
          </Card>
        )}

        {data?.analysis && (
          <>
            {data.cachedAt && (
              <div className="text-[11px] text-[var(--color-text-dim)] mb-3">
                💾 آخرین آپدیت کش: {new Date(data.cachedAt).toLocaleString()}
              </div>
            )}
            <GroupAnalyticsView
              analysis={data.analysis}
              messageCount={data.messageCount}
              sinceIso={data.sinceIso}
            />
          </>
        )}
      </main>
    </div>
  );
}
