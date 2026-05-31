"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, StatCard, Badge } from "@/components/Card";

type Overview = {
  totalCostUsd: number;
  totalTokens: number;
  totalCalls: number;
  last24hCostUsd: number;
};
type Row = {
  purpose?: string;
  model?: string;
  calls: number;
  totalCostUsd: number;
  totalTokens: number;
};
type DayRow = { day: string; totalCostUsd: number; calls: number };

const PURPOSE_LABEL: Record<string, string> = {
  classify: "Classify (urgent detection)",
  summary: "Group summaries",
  ai_chat: "AI chat replies",
  friendly_reply: "Friendly auto-reply",
  transcribe: "Voice transcription",
};

export default function CostsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [byPurpose, setByPurpose] = useState<Row[]>([]);
  const [byModel, setByModel] = useState<Row[]>([]);
  const [byDay, setByDay] = useState<DayRow[]>([]);
  const [predictN, setPredictN] = useState(1000);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/ai-usage?days=${days}`);
    const j = (await r.json()) as {
      overview: Overview | null;
      byPurpose: Row[];
      byModel: Row[];
      byDay: DayRow[];
    };
    setOverview(j.overview);
    setByPurpose(j.byPurpose);
    setByModel(j.byModel);
    setByDay(j.byDay);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCalls = byPurpose.reduce((s, r) => s + r.calls, 0);
  const totalCost = byPurpose.reduce((s, r) => s + r.totalCostUsd, 0);
  const avgCostPerCall = totalCalls > 0 ? totalCost / totalCalls : 0;

  // Per-purpose average (per call). For prediction we assume a sender's
  // message roughly causes one classify call; secretary forwards/AI replies
  // ratio comes from observed counts.
  const classifyRow = byPurpose.find((r) => r.purpose === "classify");
  const aiRow = byPurpose.find((r) => r.purpose === "ai_chat");
  const avgClassify = classifyRow && classifyRow.calls > 0
    ? classifyRow.totalCostUsd / classifyRow.calls
    : 0;
  const avgAi = aiRow && aiRow.calls > 0
    ? aiRow.totalCostUsd / aiRow.calls
    : 0;
  const aiRatio =
    totalCalls > 0 ? (aiRow?.calls ?? 0) / totalCalls : 0;

  const predictedCost = predictN * avgClassify + predictN * aiRatio * avgAi;

  const maxDayCost = byDay.reduce((m, d) => Math.max(m, d.totalCostUsd), 0.0001);

  return (
    <Shell>
      <PageTitle
        title="AI costs"
        subtitle="Where the OpenRouter / Groq spend goes."
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <option value={7}>last 7 days</option>
            <option value={30}>last 30 days</option>
            <option value={90}>last 90 days</option>
          </select>
        }
      />

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <StatCard
            label="Total cost"
            value={`$${overview.totalCostUsd.toFixed(4)}`}
            hint={`${overview.totalCalls} calls all-time`}
          />
          <StatCard
            label="Last 24h"
            value={`$${overview.last24hCostUsd.toFixed(4)}`}
          />
          <StatCard
            label="Avg / call"
            value={`$${avgCostPerCall.toFixed(5)}`}
          />
          <StatCard
            label="Tokens (period)"
            value={`${(byPurpose.reduce((s, r) => s + r.totalTokens, 0) / 1000).toFixed(1)}k`}
          />
        </div>
      )}

      {loading && <Card className="mb-4">Loading…</Card>}

      <Card className="mb-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
          Cost prediction
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span>If</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={predictN}
            onChange={(e) =>
              setPredictN(Math.max(1, Number(e.target.value) || 0))
            }
            className="w-24 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <span>more incoming messages arrive →</span>
          <Badge tone="info">
            estimated ${predictedCost.toFixed(4)}
          </Badge>
        </div>
        <p className="text-xs text-[var(--color-text-dim)] mt-2">
          Uses the per-call averages from the selected period (classify cost
          per message × N, plus the AI-reply share × N × avg AI reply cost).
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            By purpose
          </div>
          {byPurpose.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">No usage yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byPurpose.map((r) => (
                  <tr
                    key={r.purpose}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2 pr-2">
                      {PURPOSE_LABEL[r.purpose ?? ""] ?? r.purpose}
                    </td>
                    <td className="py-2 pr-2 text-right text-xs text-[var(--color-text-dim)]">
                      {r.calls} calls
                    </td>
                    <td className="py-2 text-right">
                      ${r.totalCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            By model
          </div>
          {byModel.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">No usage yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byModel.map((r) => (
                  <tr
                    key={r.model}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2 pr-2 break-all text-xs">
                      {r.model}
                    </td>
                    <td className="py-2 pr-2 text-right text-xs text-[var(--color-text-dim)]">
                      {r.calls}
                    </td>
                    <td className="py-2 text-right">
                      ${r.totalCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
          Daily spend
        </div>
        {byDay.length === 0 ? (
          <p className="text-sm text-[var(--color-text-dim)]">No usage yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {byDay.map((d) => (
              <div key={d.day} className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[var(--color-text-dim)] shrink-0">
                  {d.day}
                </span>
                <div className="flex-1 h-3 bg-[var(--color-surface-2)] rounded">
                  <div
                    className="h-full bg-[var(--color-accent)] rounded"
                    style={{
                      width: `${(d.totalCostUsd / maxDayCost) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-20 text-right tabular-nums">
                  ${d.totalCostUsd.toFixed(4)}
                </span>
                <span className="w-16 text-right text-[var(--color-text-dim)]">
                  {d.calls}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
