"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, PageTitle, StatCard } from "@/components/Card";

// نقشه‌ی راه: دستور کار برنامه‌ی بهبود روزانه. هر آیتم یک فیچر، رفع
// باگ یا بهبود است که از «ایده» به «برنامه‌ریزی‌شده» و «انجام‌شده» می‌رسد.
// گزارش روزانه‌ی بهره‌وری از همین جدول می‌خواند.

type Item = {
  id: number;
  kind: "feature" | "fix" | "improvement" | "chore";
  title: string;
  details: string | null;
  priority: number;
  status: "idea" | "planned" | "in_progress" | "done" | "dropped";
  source: string;
  plannedFor: string | null;
  commitSha: string | null;
  outcome: string | null;
  createdAt: string;
  doneAt: string | null;
};

type Snapshot = {
  day: string;
  metrics: {
    work?: { messages?: number; ruleForwarded?: number; threadSummaries?: number };
    reliability?: { errors?: number; deploysOk?: number };
    cost?: { aiCostUsd?: number };
    improvement?: { done?: Array<unknown>; openCount?: number };
    derived?: { stabilityScore?: number };
  };
};

const KIND: Record<Item["kind"], { label: string; emoji: string }> = {
  feature: { label: "فیچر", emoji: "✨" },
  fix: { label: "رفع باگ", emoji: "🐛" },
  improvement: { label: "بهبود", emoji: "🔧" },
  chore: { label: "نگهداری", emoji: "🧹" },
};
const STATUS: Record<Item["status"], { label: string; tone: "neutral" | "info" | "warn" | "success" | "danger" }> = {
  idea: { label: "ایده", tone: "neutral" },
  planned: { label: "برنامه‌ریزی‌شده", tone: "info" },
  in_progress: { label: "در حال انجام", tone: "warn" },
  done: { label: "انجام‌شده", tone: "success" },
  dropped: { label: "کنار گذاشته", tone: "danger" },
};
const PRIORITY: Record<number, string> = { 1: "🔴 بالا", 2: "🟡 عادی", 3: "🟢 پایین" };
const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

export default function RoadmapPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [view, setView] = useState<"open" | "done" | "all">("open");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [kind, setKind] = useState<Item["kind"]>("improvement");
  const [priority, setPriority] = useState(2);
  const [plannedFor, setPlannedFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/roadmap?status=${view === "open" ? "open" : view === "done" ? "done" : "all"}`),
        fetch("/api/metrics?days=14"),
      ]);
      const j1 = (await r1.json()) as { items: Item[] };
      const j2 = (await r2.json()) as { snapshots: Snapshot[] };
      setItems(j1.items ?? []);
      setSnaps(j2.snapshots ?? []);
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          details,
          kind,
          priority,
          status: plannedFor ? "planned" : "idea",
          plannedFor: plannedFor || null,
        }),
      });
      setTitle("");
      setDetails("");
      setPlannedFor("");
      setShowAdd(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    await fetch(`/api/roadmap/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function remove(id: number) {
    if (!confirm("این آیتم حذف شود؟")) return;
    await fetch(`/api/roadmap/${id}`, { method: "DELETE" });
    await load();
  }

  const latest = snaps[0];
  const groups = useMemo(() => {
    const g: Record<Item["status"], Item[]> = { in_progress: [], planned: [], idea: [], done: [], dropped: [] };
    for (const it of items) g[it.status].push(it);
    return g;
  }, [items]);
  const order: Item["status"][] =
    view === "open" ? ["in_progress", "planned", "idea"] : view === "done" ? ["done"] : ["in_progress", "planned", "idea", "done", "dropped"];

  return (
    <Shell>
      <PageTitle
        title="نقشه‌ی راه و بهره‌وری"
        subtitle="دستور کار برنامه‌ی بهبود روزانه: فیچرهای جدید، رفع باگ‌ها و بهبود فیچرهای قبلی. گزارش بهره‌وری هر شب از همین جا می‌خواند."
        actions={
          <div className="flex gap-2 flex-wrap">
            {(["open", "done", "all"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  view === v
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white"
                    : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {v === "open" ? "باز" : v === "done" ? "انجام‌شده" : "همه"}
              </button>
            ))}
            <button
              onClick={() => setShowAdd((s) => !s)}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
            >
              + آیتم جدید
            </button>
          </div>
        }
      />

      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard
            label={`امتیاز پایداری (${latest.day})`}
            value={`${fa(latest.metrics.derived?.stabilityScore ?? 0)}/۱۰۰`}
            hint="۱۰۰ منهای خطاها و فوروارد‌های ناموفق"
          />
          <StatCard label="پیام‌های پردازش‌شده" value={fa(latest.metrics.work?.messages ?? 0)} hint="در آخرین روز کامل" />
          <StatCard label="خطاهای سیستم" value={fa(latest.metrics.reliability?.errors ?? 0)} hint={`دیپلوی موفق: ${fa(latest.metrics.reliability?.deploysOk ?? 0)}`} />
          <StatCard
            label="هزینه‌ی AI"
            value={`$${(latest.metrics.cost?.aiCostUsd ?? 0).toFixed(2)}`}
            hint={`${fa(latest.metrics.improvement?.done?.length ?? 0)} آیتم تحویل‌شده · ${fa(latest.metrics.improvement?.openCount ?? 0)} باز`}
          />
        </div>
      )}

      {snaps.length > 1 && (
        <Card className="mb-4 !p-3 overflow-x-auto">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">۱۴ روز اخیر</div>
          <table className="text-xs w-full min-w-[520px]">
            <thead>
              <tr className="text-[var(--color-text-dim)]">
                <th className="text-right py-1">روز</th>
                <th className="text-right">پایداری</th>
                <th className="text-right">پیام</th>
                <th className="text-right">فوروارد</th>
                <th className="text-right">خلاصه</th>
                <th className="text-right">خطا</th>
                <th className="text-right">دیپلوی</th>
                <th className="text-right">تحویل</th>
                <th className="text-right">AI $</th>
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.day} className="border-t border-[var(--color-border)]">
                  <td className="py-1 font-mono">{s.day}</td>
                  <td>{fa(s.metrics.derived?.stabilityScore ?? 0)}</td>
                  <td>{fa(s.metrics.work?.messages ?? 0)}</td>
                  <td>{fa(s.metrics.work?.ruleForwarded ?? 0)}</td>
                  <td>{fa(s.metrics.work?.threadSummaries ?? 0)}</td>
                  <td>{fa(s.metrics.reliability?.errors ?? 0)}</td>
                  <td>{fa(s.metrics.reliability?.deploysOk ?? 0)}</td>
                  <td>{fa(s.metrics.improvement?.done?.length ?? 0)}</td>
                  <td>{(s.metrics.cost?.aiCostUsd ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showAdd && (
        <Card className="mb-4">
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان (مثلاً: چرخش توکن‌های MCP)"
              className="md:col-span-2 text-sm px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
            />
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="جزئیات، معیار پذیرش، لینک‌ها…"
              rows={3}
              className="md:col-span-2 text-sm px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
            />
            <select value={kind} onChange={(e) => setKind(e.target.value as Item["kind"])} className="text-sm px-2 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              {(Object.keys(KIND) as Item["kind"][]).map((k) => (
                <option key={k} value={k}>{KIND[k].emoji} {KIND[k].label}</option>
              ))}
            </select>
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="text-sm px-2 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              {[1, 2, 3].map((p) => (
                <option key={p} value={p}>{PRIORITY[p]}</option>
              ))}
            </select>
            <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
              برنامه برای روز:
              <input type="date" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">انصراف</button>
              <button onClick={add} disabled={saving || !title.trim()} className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50">
                {saving ? "در حال ذخیره…" : "ثبت"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <Card>در حال بارگذاری…</Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هنوز آیتمی نیست. با «+ آیتم جدید» اولین فیچر یا باگ رو ثبت کن؛ برای این که توی گزارش فردا بیاد، براش تاریخ بذار.
          </p>
        </Card>
      ) : (
        order.map((st) =>
          groups[st].length === 0 ? null : (
            <div key={st} className="mb-5">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge>
                <span className="text-xs text-[var(--color-text-dim)]">{fa(groups[st].length)}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {groups[st].map((it) => (
                  <Card key={it.id} className="!p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {KIND[it.kind].emoji} {it.title}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-dim)] mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          <span>{PRIORITY[it.priority]}</span>
                          <span>{KIND[it.kind].label}</span>
                          {it.plannedFor && <span>📅 {it.plannedFor}</span>}
                          {it.commitSha && <span className="font-mono">{it.commitSha.slice(0, 7)}</span>}
                          {it.source !== "owner" && <span>منبع: {it.source}</span>}
                          {it.doneAt && <span>✔ {it.doneAt.slice(0, 10)}</span>}
                        </div>
                        {it.details && editing !== it.id && (
                          <p className="text-xs text-[var(--color-text-dim)] mt-1.5 whitespace-pre-wrap">{it.details}</p>
                        )}
                        {it.outcome && (
                          <p className="text-xs mt-1.5 whitespace-pre-wrap">📝 {it.outcome}</p>
                        )}
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        <select
                          value={it.status}
                          onChange={(e) => patch(it.id, { status: e.target.value })}
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                        >
                          {(Object.keys(STATUS) as Item["status"][]).map((s) => (
                            <option key={s} value={s}>{STATUS[s].label}</option>
                          ))}
                        </select>
                        <select
                          value={it.priority}
                          onChange={(e) => patch(it.id, { priority: Number(e.target.value) })}
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                        >
                          {[1, 2, 3].map((p) => (
                            <option key={p} value={p}>{PRIORITY[p]}</option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={it.plannedFor ?? ""}
                          onChange={(e) => patch(it.id, { plannedFor: e.target.value || null, ...(e.target.value && it.status === "idea" ? { status: "planned" } : {}) })}
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                        />
                        <button onClick={() => setEditing(editing === it.id ? null : it.id)} className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)]">✎</button>
                        <button onClick={() => remove(it.id)} className="text-[11px] px-2 py-1 rounded-md border border-red-900 text-red-300">🗑</button>
                      </div>
                    </div>
                    {editing === it.id && (
                      <EditBox
                        item={it}
                        onSave={async (b) => {
                          await patch(it.id, b);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ),
        )
      )}
    </Shell>
  );
}

function EditBox({
  item,
  onSave,
  onCancel,
}: {
  item: Item;
  onSave: (b: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(item.details ?? "");
  const [outcome, setOutcome] = useState(item.outcome ?? "");
  const [kind, setKind] = useState<Item["kind"]>(item.kind);
  return (
    <div className="mt-3 grid gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
      <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="جزئیات" className="text-sm px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
      <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} placeholder="نتیجه / چی تحویل شد" className="text-sm px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
      <div className="flex gap-2 items-center flex-wrap">
        <select value={kind} onChange={(e) => setKind(e.target.value as Item["kind"])} className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
          {(Object.keys(KIND) as Item["kind"][]).map((k) => (
            <option key={k} value={k}>{KIND[k].emoji} {KIND[k].label}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">انصراف</button>
        <button
          onClick={() => onSave({ title, details: details || null, outcome: outcome || null, kind })}
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
        >
          ذخیره
        </button>
      </div>
    </div>
  );
}
