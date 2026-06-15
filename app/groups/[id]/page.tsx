"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Badge, Card, PageTitle, StatCard } from "@/components/Card";
import { relTime } from "@/lib/format";

type TaskStatus = "announced" | "in_progress" | "done" | "stalled";

type Task = {
  title: string;
  owner: string | null;
  announcedBy: string;
  announcedAt: string;
  status: TaskStatus;
  completedAt: string | null;
  durationHours: number | null;
  evidence: string[];
};

type Person = {
  name: string;
  role: string;
  tasksAnnounced: number;
  tasksCompleted: number;
};

type Analysis = {
  overview: string;
  stats: {
    totalTasks: number;
    announced: number;
    inProgress: number;
    done: number;
    stalled: number;
    avgCompletionHours: number | null;
  };
  tasks: Task[];
  people: Person[];
};

type AnalyticsResponse = {
  ok: boolean;
  empty?: boolean;
  chatTitle: string | null;
  sinceIso: string;
  messageCount: number;
  analysis: Analysis | null;
  error?: string;
};

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: "۳ روز", days: 3 },
  { label: "۷ روز", days: 7 },
  { label: "۱۴ روز", days: 14 },
  { label: "۳۰ روز", days: 30 },
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  announced: "اعلام‌شده",
  in_progress: "در حال انجام",
  done: "تموم",
  stalled: "متوقف",
};

const STATUS_TONES: Record<TaskStatus, "neutral" | "info" | "success" | "warn"> = {
  announced: "info",
  in_progress: "warn",
  done: "success",
  stalled: "neutral",
};

function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} دقیقه`;
  }
  if (hours < 48) return `${hours.toFixed(1)} ساعت`;
  const days = hours / 24;
  return `${days.toFixed(1)} روز`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function GroupAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const chatId = Number(id);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  const run = useCallback(
    async (windowDays: number) => {
      setRunning(true);
      setErr(null);
      try {
        const r = await fetch(
          `/api/groups/${chatId}/analytics?days=${windowDays}`,
          { method: "POST" },
        );
        const j = (await r.json()) as AnalyticsResponse;
        if (!r.ok) throw new Error(j.error ?? "failed");
        setData(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [chatId],
  );

  useEffect(() => {
    if (Number.isFinite(chatId)) run(days);
  }, [chatId, days, run]);

  const analysis = data?.analysis ?? null;
  const tasks = analysis?.tasks ?? [];
  const people = analysis?.people ?? [];

  return (
    <Shell>
      <PageTitle
        title={
          data?.chatTitle
            ? `📊 ${data.chatTitle}`
            : `📊 گروه ${chatId}`
        }
        subtitle="تحلیل کارهای مطرح شده، در حال انجام و تموم‌شده در بازه‌ی انتخاب‌شده."
        actions={
          <div className="flex gap-2 flex-wrap">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setDays(w.days)}
                disabled={running}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  days === w.days
                    ? "bg-[var(--color-accent)] text-white border-transparent"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                } disabled:opacity-50`}
              >
                {w.label}
              </button>
            ))}
            <button
              onClick={() => run(days)}
              disabled={running}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {running ? "در حال پردازش…" : "↻ به‌روزرسانی"}
            </button>
            <Link
              href="/groups"
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              ← خلاصه‌ها
            </Link>
          </div>
        }
      />

      {err && (
        <Card className="mb-4 border-red-800">
          <p className="text-sm text-red-300">{err}</p>
        </Card>
      )}

      {running && !data && (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            در حال پردازش پیام‌های گروه… (بسته به حجم پیام‌ها چند ثانیه طول می‌کشه)
          </p>
        </Card>
      )}

      {data?.empty && (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هیچ پیامی در این بازه پیدا نشد.
          </p>
        </Card>
      )}

      {analysis && (
        <>
          {analysis.overview && (
            <Card className="mb-4">
              <div className="text-xs text-[var(--color-text-dim)] mb-2">
                خلاصه‌ی وضعیت
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {analysis.overview}
              </p>
              <div className="text-[11px] text-[var(--color-text-dim)] mt-3">
                {data?.messageCount ?? 0} پیام · از{" "}
                {data?.sinceIso
                  ? new Date(data.sinceIso).toLocaleDateString()
                  : "—"}{" "}
                تا الان
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard
              label="کل کارها"
              value={analysis.stats.totalTasks}
            />
            <StatCard
              label="تموم"
              value={analysis.stats.done}
              hint={
                analysis.stats.totalTasks > 0
                  ? `${Math.round((analysis.stats.done / analysis.stats.totalTasks) * 100)}%`
                  : undefined
              }
            />
            <StatCard
              label="در حال انجام"
              value={analysis.stats.inProgress}
            />
            <StatCard
              label="اعلام‌شده"
              value={analysis.stats.announced}
            />
            <StatCard
              label="میانگین زمان انجام"
              value={formatDuration(analysis.stats.avgCompletionHours)}
              hint="از زمان اعلام تا تموم"
            />
          </div>

          {tasks.length > 0 && (
            <Card className="mb-4">
              <div className="text-sm font-medium mb-3">کارها</div>
              <div className="flex flex-col gap-3">
                {tasks.map((t, i) => (
                  <TaskRow key={`${t.title}-${i}`} task={t} />
                ))}
              </div>
            </Card>
          )}

          {people.length > 0 && (
            <Card>
              <div className="text-sm font-medium mb-3">افراد فعال</div>
              <div className="flex flex-col gap-3">
                {people.map((p, i) => (
                  <div
                    key={`${p.name}-${i}`}
                    className="border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium">{p.name}</div>
                      <div className="flex gap-1.5">
                        <Badge tone="info">
                          {p.tasksAnnounced} اعلام
                        </Badge>
                        <Badge tone="success">
                          {p.tasksCompleted} تموم‌شده
                        </Badge>
                      </div>
                    </div>
                    {p.role && (
                      <p className="text-xs text-[var(--color-text-dim)] mt-1">
                        {p.role}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tasks.length === 0 && (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                کار مشخصی در این بازه پیدا نشد.
              </p>
            </Card>
          )}
        </>
      )}
    </Shell>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <div className="border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="font-medium flex-1 min-w-0">{task.title}</div>
        <Badge tone={STATUS_TONES[task.status]}>
          {STATUS_LABELS[task.status]}
        </Badge>
      </div>

      <div className="text-xs text-[var(--color-text-dim)] mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        <span>
          اعلام: <span className="text-white">{task.announcedBy}</span> ·{" "}
          {relTime(task.announcedAt)}
        </span>
        {task.owner && task.owner !== task.announcedBy && (
          <span>
            مسئول: <span className="text-white">{task.owner}</span>
          </span>
        )}
        {task.status === "done" && (
          <span>
            انجام: {formatTime(task.completedAt)} ·{" "}
            <span className="text-emerald-300">
              {formatDuration(task.durationHours)}
            </span>
          </span>
        )}
      </div>

      {task.evidence.length > 0 && (
        <ul className="mt-2 text-xs text-[var(--color-text-dim)] list-disc pr-5 space-y-0.5">
          {task.evidence.slice(0, 4).map((e, i) => (
            <li key={i} className="break-words">
              «{e}»
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
