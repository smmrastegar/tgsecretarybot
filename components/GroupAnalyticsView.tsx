"use client";

import { useState } from "react";
import { Badge, Card, StatCard } from "@/components/Card";
import { relTime } from "@/lib/format";

export type TaskStatus = "announced" | "in_progress" | "done" | "stalled";

export type PersonRoleLabel =
  | "executor"
  | "reporter"
  | "supervisor"
  | "designer"
  | "support"
  | "stakeholder"
  | "other";

export type Task = {
  title: string;
  topicName: string | null;
  owner: string | null;
  announcedBy: string;
  announcedAt: string;
  dueAt: string | null;
  status: TaskStatus;
  priority?: "high" | "normal" | "low";
  isOverdue: boolean;
  staleDays: number | null;
  completedAt: string | null;
  durationHours: number | null;
  completedOnTime: boolean | null;
  delayHours: number | null;
  blockedReason: string | null;
  evidence: string[];
};

export type Person = {
  name: string;
  roleLabel: PersonRoleLabel;
  roleDescription: string;
  tasksAnnounced: number;
  tasksCompleted: number;
  onTimeRate: number | null;
};

export type Highlight = {
  kind: "overdue" | "stalled" | "risk" | "win" | "conflict";
  title: string;
  details: string;
  topicName: string | null;
};

export type TopicBreakdown = {
  topicName: string;
  messageCount: number;
  activeSenders: number;
  summary: string;
  openTasks: number;
  overdueTasks: number;
  keyPoints: string[];
};

export type CriticalItem = {
  kind: "overdue" | "conflict" | "stuck" | "escalation";
  title: string;
  details: string;
  topicName: string | null;
  people: string[];
  evidence: string[];
};

export type Analysis = {
  overview: string;
  stats: {
    totalTasks: number;
    announced: number;
    inProgress: number;
    done: number;
    stalled: number;
    overdue: number;
    conflicts: number;
    avgCompletionHours: number | null;
  };
  tasks: Task[];
  people: Person[];
  highlights: Highlight[];
  topicBreakdown: TopicBreakdown[];
  criticalForInbox: CriticalItem[];
  debug?: {
    rawResponse: string;
    parseStatus: "ok" | "empty_response" | "no_json" | "parse_error";
  };
};

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

const ROLE_LABELS: Record<PersonRoleLabel, string> = {
  executor: "مجری",
  reporter: "گزارش‌کننده",
  supervisor: "ناظر / مدیر",
  designer: "طراح",
  support: "پشتیبانی",
  stakeholder: "ذی‌نفع",
  other: "سایر",
};

const ROLE_TONES: Record<
  PersonRoleLabel,
  "info" | "success" | "warn" | "danger" | "neutral"
> = {
  executor: "success",
  reporter: "info",
  supervisor: "warn",
  designer: "info",
  support: "info",
  stakeholder: "neutral",
  other: "neutral",
};

const HIGHLIGHT_LABELS: Record<Highlight["kind"], string> = {
  overdue: "⏰ معوق",
  stalled: "🛑 متوقف",
  risk: "⚠️ ریسک",
  win: "✅ موفقیت",
  conflict: "⚔️ بحث/دعوا",
};

const HIGHLIGHT_TONES: Record<
  Highlight["kind"],
  "danger" | "warn" | "info" | "success"
> = {
  overdue: "danger",
  stalled: "warn",
  risk: "warn",
  win: "success",
  conflict: "danger",
};

const CRITICAL_LABELS: Record<CriticalItem["kind"], string> = {
  overdue: "⏰ معوق",
  conflict: "⚔️ بحث/دعوا",
  stuck: "🛑 گیر کرده",
  escalation: "📣 درخواست رسیدگی",
};

const CRITICAL_TONES: Record<CriticalItem["kind"], "danger" | "warn"> = {
  overdue: "danger",
  conflict: "danger",
  stuck: "warn",
  escalation: "warn",
};

export function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} دقیقه`;
  }
  if (hours < 48) return `${hours.toFixed(1)} ساعت`;
  const days = hours / 24;
  return `${days.toFixed(1)} روز`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  // Pre-2000 values are "from the beginning" sentinels (epoch), not real
  // timestamps — showing «۱۹۷۰» to a reader is worse than showing nothing.
  if (d.getTime() < Date.UTC(2000, 0, 1)) return "—";
  return d.toLocaleString("fa-IR");
}

export type CurrentTopic = {
  name: string;
  messageThreadId: number;
  archived: boolean;
};

export default function GroupAnalyticsView({
  analysis,
  messageCount,
  sinceIso,
  currentTopics,
}: {
  analysis: Analysis;
  messageCount: number;
  sinceIso: string | null;
  currentTopics?: CurrentTopic[];
}) {
  const overdueTasks = analysis.tasks.filter(
    (t) => t.isOverdue || t.status === "stalled",
  );
  const activeTasks = analysis.tasks.filter(
    (t) =>
      !t.isOverdue && t.status !== "stalled" && t.status !== "done",
  );
  const doneTasks = analysis.tasks.filter((t) => t.status === "done");

  // Live filter for topicBreakdown: a topic the operator just
  // archived shouldn't appear here even though the cached analysis
  // still has its entry. We also rename Topic #N entries to the
  // current display name when the operator has provided one.
  const archivedNames = new Set(
    (currentTopics ?? []).filter((t) => t.archived).map((t) => t.name),
  );
  // Also map old "Topic #N" labels to whatever name is now stored for
  // thread N — that's the rename path. We key by both the literal
  // "Topic #N" and the threadId numeric string so legacy cached
  // entries get fixed up on display.
  const renameMap = new Map<string, string>();
  for (const t of currentTopics ?? []) {
    renameMap.set(`Topic #${t.messageThreadId}`, t.name);
  }
  const renamedArchivedKeys = new Set<string>();
  for (const t of currentTopics ?? []) {
    if (t.archived) renamedArchivedKeys.add(`Topic #${t.messageThreadId}`);
  }
  const visibleTopicBreakdown = (analysis.topicBreakdown ?? [])
    .filter((tb) => {
      // Hide if the cached name OR the legacy-Topic-#N form maps
      // to a now-archived topic.
      if (archivedNames.has(tb.topicName)) return false;
      if (renamedArchivedKeys.has(tb.topicName)) return false;
      return true;
    })
    .map((tb) => ({
      ...tb,
      topicName: renameMap.get(tb.topicName) ?? tb.topicName,
    }));

  return (
    <div dir="rtl">
      {analysis.overview && (
        <Card className="mb-4">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">
            خلاصه‌ی وضعیت
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {analysis.overview}
          </p>
          <div className="text-[11px] text-[var(--color-text-dim)] mt-3">
            {messageCount.toLocaleString("fa-IR")} پیام
            {(() => {
              if (!sinceIso) return null;
              const d = new Date(sinceIso);
              // Skip epoch sentinels — "از ۱۹۷۰ تا الان" is meaningless.
              if (!Number.isFinite(d.getTime()) || d.getTime() < Date.UTC(2000, 0, 1)) {
                return null;
              }
              return <> · از {d.toLocaleDateString("fa-IR")} تا الان</>;
            })()}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
        <StatCard label="کل کارها" value={analysis.stats.totalTasks} />
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
        <StatCard label="اعلام‌شده" value={analysis.stats.announced} />
        <StatCard label="معوق / متوقف" value={analysis.stats.overdue + analysis.stats.stalled} />
        <StatCard label="بحث/دعوا" value={analysis.stats.conflicts ?? 0} />
        <StatCard
          label="میانگین زمان انجام"
          value={formatDuration(analysis.stats.avgCompletionHours)}
          hint="از زمان اعلام تا تموم"
        />
      </div>

      {analysis.criticalForInbox && analysis.criticalForInbox.length > 0 && (
        <Card className="mb-4 border-red-700">
          <div className="text-sm font-medium mb-3 text-red-300">
            🆘 موارد بحرانی — نیاز به رسیدگی مستقیم شما
          </div>
          <div className="text-[11px] text-[var(--color-text-dim)] mb-3">
            این موارد به کانال notes_inbox هم ارسال شدن.
          </div>
          <div className="flex flex-col gap-3">
            {analysis.criticalForInbox.map((c, i) => (
              <div
                key={i}
                className="border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0"
              >
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Badge tone={CRITICAL_TONES[c.kind]}>
                    {CRITICAL_LABELS[c.kind]}
                  </Badge>
                  <span className="font-medium">{c.title}</span>
                  {c.topicName && (
                    <span className="text-[10px] text-[var(--color-text-dim)]">
                      🧵 {c.topicName}
                    </span>
                  )}
                </div>
                {c.details && (
                  <p className="text-sm leading-relaxed">{c.details}</p>
                )}
                {c.people.length > 0 && (
                  <div className="text-[11px] text-[var(--color-text-dim)] mt-1">
                    👥 {c.people.join(" / ")}
                  </div>
                )}
                {c.evidence.length > 0 && (
                  <ul className="mt-1.5 text-[11px] text-[var(--color-text-dim)] list-disc pr-5 space-y-0.5">
                    {c.evidence.slice(0, 3).map((q, j) => (
                      <li key={j} className="break-words">
                        «{q}»
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.highlights.length > 0 && (
        <Card className="mb-4 border-amber-800">
          <div className="text-sm font-medium mb-3">🚨 نکات کلیدی</div>
          <div className="flex flex-col gap-2">
            {analysis.highlights.map((h, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-[var(--color-border)] last:border-0 pb-2 last:pb-0"
              >
                <Badge tone={HIGHLIGHT_TONES[h.kind]}>
                  {HIGHLIGHT_LABELS[h.kind]}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{h.title}</div>
                  {h.details && (
                    <div className="text-xs text-[var(--color-text-dim)] mt-0.5">
                      {h.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {visibleTopicBreakdown.length > 1 && (
        <Card className="mb-4">
          <div className="text-sm font-medium mb-3">🧵 تفکیک بر اساس تاپیک</div>
          <div className="flex flex-col gap-2">
            {visibleTopicBreakdown.map((t, i) => (
              <TopicBreakdownRow
                key={`${t.topicName}-${i}`}
                topic={t}
                tasks={analysis.tasks.filter(
                  (task) =>
                    (task.topicName ?? "General") === t.topicName,
                )}
              />
            ))}
          </div>
        </Card>
      )}

      {overdueTasks.length > 0 && (
        <Card className="mb-4 border-red-800">
          <div className="text-sm font-medium mb-3 text-red-300">
            ⏰ کارهای معوق و متوقف ({overdueTasks.length})
          </div>
          <div className="flex flex-col gap-3">
            {overdueTasks.map((t, i) => (
              <TaskRow key={`overdue-${i}`} task={t} emphasize />
            ))}
          </div>
        </Card>
      )}

      {activeTasks.length > 0 && (
        <Card className="mb-4">
          <div className="text-sm font-medium mb-3">📋 کارهای فعال</div>
          <div className="flex flex-col gap-3">
            {activeTasks.map((t, i) => (
              <TaskRow key={`active-${i}`} task={t} />
            ))}
          </div>
        </Card>
      )}

      {doneTasks.length > 0 && (
        <Card className="mb-4">
          <div className="text-sm font-medium mb-3">✅ کارهای تموم‌شده</div>
          <div className="flex flex-col gap-3">
            {doneTasks.map((t, i) => (
              <TaskRow key={`done-${i}`} task={t} />
            ))}
          </div>
        </Card>
      )}

      {analysis.people.length > 0 && (
        <Card>
          <div className="text-sm font-medium mb-3">👥 افراد و نقش‌ها</div>
          <div className="flex flex-col gap-3">
            {analysis.people.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className="border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.name}</span>
                    <Badge tone={ROLE_TONES[p.roleLabel]}>
                      {ROLE_LABELS[p.roleLabel]}
                    </Badge>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge tone="info">{p.tasksAnnounced} اعلام</Badge>
                    <Badge tone="success">{p.tasksCompleted} تموم</Badge>
                    {p.onTimeRate !== null && (
                      <Badge
                        tone={
                          p.onTimeRate >= 0.8
                            ? "success"
                            : p.onTimeRate >= 0.5
                              ? "warn"
                              : "danger"
                        }
                      >
                        {Math.round(p.onTimeRate * 100)}% به‌موقع
                      </Badge>
                    )}
                  </div>
                </div>
                {p.roleDescription && (
                  <p className="text-xs text-[var(--color-text-dim)] mt-1">
                    {p.roleDescription}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.tasks.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            کار مشخصی در این بازه پیدا نشد.
          </p>
        </Card>
      )}
    </div>
  );
}

function TaskRow({ task, emphasize }: { task: Task; emphasize?: boolean }) {
  return (
    <div
      className={`border-b border-[var(--color-border)] last:border-0 pb-3 last:pb-0 ${
        emphasize ? "bg-red-950/20 -mx-2 px-2 rounded" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="font-medium flex-1 min-w-0">
          {task.title}
          {task.topicName && (
            <span className="text-[10px] text-[var(--color-text-dim)] mr-2 ms-2">
              🧵 {task.topicName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {task.priority === "high" && (
            <Badge tone="danger">🔥 اولویت بالا</Badge>
          )}
          {task.priority === "low" && <Badge tone="neutral">🟢 کم‌اولویت</Badge>}
          {task.isOverdue && <Badge tone="danger">⏰ معوق</Badge>}
          <Badge tone={STATUS_TONES[task.status]}>
            {STATUS_LABELS[task.status]}
          </Badge>
        </div>
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
        {task.dueAt && (
          <span>
            مهلت: <span className="text-white">{formatTime(task.dueAt)}</span>
          </span>
        )}
        {task.status === "done" && (
          <span>
            انجام: {formatTime(task.completedAt)} ·{" "}
            <span className="text-emerald-300">
              {formatDuration(task.durationHours)}
            </span>
            {task.completedOnTime === false && (
              <span className="text-red-300 mr-2 ms-2">
                با تأخیر {formatDuration(task.delayHours)}
              </span>
            )}
          </span>
        )}
        {task.staleDays !== null && task.staleDays > 1 && task.status !== "done" && (
          <span className="text-amber-300">
            {Math.round(task.staleDays)} روز بدون فعالیت
          </span>
        )}
      </div>

      {task.blockedReason && (
        <div className="text-xs text-amber-300 mt-1.5">
          🚧 {task.blockedReason}
        </div>
      )}

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

function TopicBreakdownRow({
  topic,
  tasks,
}: {
  topic: TopicBreakdown;
  tasks: Task[];
}) {
  const [open, setOpen] = useState(false);
  const byStatus: Record<TaskStatus, number> = {
    announced: 0,
    in_progress: 0,
    done: 0,
    stalled: 0,
  };
  for (const t of tasks) byStatus[t.status]++;
  const peopleSet = new Set<string>();
  for (const t of tasks) {
    if (t.announcedBy) peopleSet.add(t.announcedBy);
    if (t.owner) peopleSet.add(t.owner);
  }
  const people = [...peopleSet];

  const sortedTasks = [...tasks].sort((a, b) => {
    const rank = (t: Task): number => {
      if (t.isOverdue) return 0;
      if (t.status === "stalled") return 1;
      if (t.status === "in_progress") return 2;
      if (t.status === "announced") return 3;
      return 4;
    };
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return b.announcedAt.localeCompare(a.announcedAt);
  });

  return (
    <div className="border border-[var(--color-border)] rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 hover:bg-[var(--color-surface-2)] text-right"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs text-[var(--color-text-dim)] shrink-0">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-medium truncate">{topic.topicName}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center shrink-0">
          <Badge tone="neutral">
            {topic.messageCount} پیام · {topic.activeSenders} نفر
          </Badge>
          {topic.openTasks > 0 && (
            <Badge tone="info">{topic.openTasks} باز</Badge>
          )}
          {topic.overdueTasks > 0 && (
            <Badge tone="danger">{topic.overdueTasks} معوق</Badge>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] p-3 bg-[var(--color-surface-2)]/30">
          {topic.summary && (
            <p className="text-xs leading-relaxed mb-3 whitespace-pre-wrap">
              {topic.summary}
            </p>
          )}

          {tasks.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {(
                [
                  ["announced", byStatus.announced, "info"],
                  ["in_progress", byStatus.in_progress, "warn"],
                  ["done", byStatus.done, "success"],
                  ["stalled", byStatus.stalled, "neutral"],
                ] as const
              ).map(([k, n, tone]) => (
                <div
                  key={k}
                  className="border border-[var(--color-border)] rounded-md px-2 py-1.5 flex items-center justify-between bg-[var(--color-surface)]"
                >
                  <Badge tone={tone}>{STATUS_LABELS[k]}</Badge>
                  <span className="text-sm font-semibold">{n}</span>
                </div>
              ))}
            </div>
          )}

          {people.length > 0 && (
            <div className="mb-3 text-[11px] text-[var(--color-text-dim)]">
              <span className="opacity-70">👥 افراد فعال: </span>
              <span className="text-white">{people.join(" · ")}</span>
            </div>
          )}

          {topic.keyPoints.length > 0 && (
            <ul className="text-[11px] text-[var(--color-text-dim)] list-disc pr-5 space-y-0.5 mb-3">
              {topic.keyPoints.slice(0, 6).map((p, j) => (
                <li key={j} className="break-words">
                  {p}
                </li>
              ))}
            </ul>
          )}

          {sortedTasks.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-dim)]">
              توی این تاپیک هیچ task شناسایی نشد.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {sortedTasks.map((t, i) => (
                <TaskRow
                  key={`${topic.topicName}-task-${i}`}
                  task={t}
                  emphasize={t.isOverdue || t.status === "stalled"}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
