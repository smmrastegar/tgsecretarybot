"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, PageTitle, StatCard } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";

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

// Controls are >= 40 px tall; fields 44 px.
const field = "w-full min-h-11 text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]";
const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const btnPrimary = "min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50";

export default function RoadmapPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [view, setView] = useState<"open" | "done" | "all">("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/roadmap?status=${view === "open" ? "open" : view === "done" ? "done" : "all"}`),
        fetch("/api/metrics?days=14"),
      ]);
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
      const j1 = (await r1.json()) as { items: Item[] };
      const j2 = r2.ok ? ((await r2.json()) as { snapshots: Snapshot[] }) : { snapshots: [] };
      setItems(j1.items ?? []);
      setSnaps(j2.snapshots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    if (!(await confirmDialog("این آیتم حذف شود؟", { danger: true, confirmLabel: "حذف" }))) return;
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
        <Section icon="📈" title="۱۴ روز اخیر" summary={`${fa(snaps.length)} روز · پایداری، پیام، خطا، دیپلوی`}>
          {/* One card per day (instead of a 9-column table that scrolled sideways on phones). */}
          <div className="grid gap-2 md:grid-cols-2">
            {snaps.map((s) => (
              <div key={s.day} className="rounded-xl border border-[var(--color-border)] px-3 py-2">
                <div className="text-sm font-mono mb-1.5" dir="ltr">{s.day}</div>
                <div className="grid grid-cols-4 gap-x-2 gap-y-2 tabular-nums">
                  {(
                    [
                      ["پایداری", fa(s.metrics.derived?.stabilityScore ?? 0)],
                      ["پیام", fa(s.metrics.work?.messages ?? 0)],
                      ["فوروارد", fa(s.metrics.work?.ruleForwarded ?? 0)],
                      ["خلاصه", fa(s.metrics.work?.threadSummaries ?? 0)],
                      ["خطا", fa(s.metrics.reliability?.errors ?? 0)],
                      ["دیپلوی", fa(s.metrics.reliability?.deploysOk ?? 0)],
                      ["تحویل", fa(s.metrics.improvement?.done?.length ?? 0)],
                      ["AI $", (s.metrics.cost?.aiCostUsd ?? 0).toFixed(2)],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-xs text-[var(--color-text-dim)]">{label}</div>
                      <div className="text-sm">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        icon="➕"
        title="آیتم جدید"
        summary="فیچر، رفع باگ یا بهبود تازه ثبت کن"
        open={showAdd}
        onOpenChange={setShowAdd}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان (مثلاً: چرخش توکن‌های MCP)"
            aria-label="عنوان"
            dir="auto"
            className={`md:col-span-2 ${field}`}
          />
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="جزئیات، معیار پذیرش، لینک‌ها…"
            aria-label="جزئیات"
            dir="auto"
            rows={3}
            className={`md:col-span-2 leading-6 ${field}`}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as Item["kind"])} aria-label="نوع" className={field}>
            {(Object.keys(KIND) as Item["kind"][]).map((k) => (
              <option key={k} value={k}>{KIND[k].emoji} {KIND[k].label}</option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} aria-label="اولویت" className={field}>
            {[1, 2, 3].map((p) => (
              <option key={p} value={p}>{PRIORITY[p]}</option>
            ))}
          </select>
          <label className="md:col-span-2 text-sm flex flex-col gap-1.5">
            برنامه برای روز:
            <input type="date" dir="ltr" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} className={field} />
          </label>
          <div className="md:col-span-2 flex gap-2">
            <button onClick={add} disabled={saving || !title.trim()} className={btnPrimary}>
              {saving ? "در حال ذخیره…" : "ثبت"}
            </button>
            <button onClick={() => setShowAdd(false)} className={btn}>انصراف</button>
          </div>
        </div>
      </Section>

      <div role="tablist" className="grid grid-cols-3 gap-2 my-4">
        {(["open", "done", "all"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`min-h-11 rounded-xl border text-sm ${
              view === v
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {v === "open" ? "باز" : v === "done" ? "انجام‌شده" : "همه"}
          </button>
        ))}
      </div>

      {loading && items.length === 0 && !error ? (
        <Card>در حال بارگذاری…</Card>
      ) : error ? (
        <Card className="!border-red-800 !bg-red-900/20">
          <p className="text-sm text-red-200">بارگذاری نقشه‌ی راه ناموفق بود ({error})</p>
          <button onClick={load} className={`${btn} mt-3`}>تلاش دوباره</button>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🗺"
          title="هنوز آیتمی نیست"
          hint="اولین فیچر یا باگ رو ثبت کن؛ برای این که توی گزارش فردا بیاد، براش تاریخ بذار."
          action={<button onClick={() => setShowAdd(true)} className={btnPrimary}>+ آیتم جدید</button>}
        />
      ) : (
        order.map((st) =>
          groups[st].length === 0 ? null : (
            <div key={st} className="mb-5">
              <h2 className="text-sm font-semibold mb-2 flex items-center justify-center gap-2">
                <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge>
                <span className="text-xs text-[var(--color-text-dim)]">{fa(groups[st].length)}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {groups[st].map((it) => (
                  <Card key={it.id} className="!p-3">
                    <div className="text-sm font-medium leading-7 [overflow-wrap:anywhere]">
                      {KIND[it.kind].emoji} {it.title}
                    </div>
                    <div className="text-xs text-[var(--color-text-dim)] mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
                      <span>{PRIORITY[it.priority]}</span>
                      <span>{KIND[it.kind].label}</span>
                      {it.plannedFor && <span>📅 {it.plannedFor}</span>}
                      {it.commitSha && <span className="font-mono">{it.commitSha.slice(0, 7)}</span>}
                      {it.source !== "owner" && <span>منبع: {it.source}</span>}
                      {it.doneAt && <span>✔ {it.doneAt.slice(0, 10)}</span>}
                    </div>
                    {it.details && editing !== it.id && (
                      <p className="text-xs leading-6 text-[var(--color-text-dim)] mt-2 whitespace-pre-wrap">{it.details}</p>
                    )}
                    {it.outcome && (
                      <p className="text-xs leading-6 mt-2 whitespace-pre-wrap">📝 {it.outcome}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        value={it.status}
                        onChange={(e) => patch(it.id, { status: e.target.value })}
                        aria-label="وضعیت"
                        className={`${field} flex-1 min-w-0`}
                      >
                        {(Object.keys(STATUS) as Item["status"][]).map((s) => (
                          <option key={s} value={s}>{STATUS[s].label}</option>
                        ))}
                      </select>
                      <button onClick={() => setEditing(editing === it.id ? null : it.id)} aria-label="ویرایش" aria-expanded={editing === it.id} className={`${btn} px-3`}>✎</button>
                      <button onClick={() => remove(it.id)} aria-label="حذف" className={`${btn} px-3 !border-red-900 text-red-300`}>🗑</button>
                    </div>
                    {editing === it.id && (
                      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <select
                            value={it.priority}
                            onChange={(e) => patch(it.id, { priority: Number(e.target.value) })}
                            aria-label="اولویت"
                            className={field}
                          >
                            {[1, 2, 3].map((p) => (
                              <option key={p} value={p}>{PRIORITY[p]}</option>
                            ))}
                          </select>
                          <input
                            type="date"
                            dir="ltr"
                            aria-label="برنامه برای روز"
                            value={it.plannedFor ?? ""}
                            onChange={(e) => patch(it.id, { plannedFor: e.target.value || null, ...(e.target.value && it.status === "idea" ? { status: "planned" } : {}) })}
                            className={field}
                          />
                        </div>
                        <EditBox
                          item={it}
                          onSave={async (b) => {
                            await patch(it.id, b);
                            setEditing(null);
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      </div>
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
    <div className="grid gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="عنوان" dir="auto" className={field} />
      <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="جزئیات" aria-label="جزئیات" dir="auto" className={`leading-6 ${field}`} />
      <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} placeholder="نتیجه / چی تحویل شد" aria-label="نتیجه" dir="auto" className={`leading-6 ${field}`} />
      <select value={kind} onChange={(e) => setKind(e.target.value as Item["kind"])} aria-label="نوع" className={field}>
        {(Object.keys(KIND) as Item["kind"][]).map((k) => (
          <option key={k} value={k}>{KIND[k].emoji} {KIND[k].label}</option>
        ))}
      </select>
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => onSave({ title, details: details || null, outcome: outcome || null, kind })}
          className={btnPrimary}
        >
          ذخیره
        </button>
        <button onClick={onCancel} className={btn}>انصراف</button>
      </div>
    </div>
  );
}
