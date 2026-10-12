"use client";

import { useState, type ReactNode } from "react";
import { normalizeEvidence } from "@/lib/evidence";
import { Card } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
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

type Tone = "neutral" | "info" | "ok" | "warn" | "bad";

const STATUS_LABELS: Record<TaskStatus, string> = {
  announced: "اعلام‌شده",
  in_progress: "در حال انجام",
  done: "تموم",
  stalled: "متوقف",
};

const STATUS_TONES: Record<TaskStatus, Tone> = {
  announced: "info",
  in_progress: "warn",
  done: "ok",
  stalled: "bad",
};

// Left-edge accent of a task row: one glance tells the state apart.
const STATUS_ACCENT: Record<TaskStatus, string> = {
  announced: "border-s-sky-400/70",
  in_progress: "border-s-amber-400/70",
  done: "border-s-emerald-400/70",
  stalled: "border-s-rose-400/70",
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

const ROLE_TONES: Record<PersonRoleLabel, Tone> = {
  executor: "ok",
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

const HIGHLIGHT_TONES: Record<Highlight["kind"], Tone> = {
  overdue: "bad",
  stalled: "warn",
  risk: "warn",
  win: "ok",
  conflict: "bad",
};

const HIGHLIGHT_ACCENT: Record<Highlight["kind"], string> = {
  overdue: "border-s-rose-400/70",
  stalled: "border-s-amber-400/70",
  risk: "border-s-amber-400/70",
  win: "border-s-emerald-400/70",
  conflict: "border-s-rose-400/70",
};

const CRITICAL_LABELS: Record<CriticalItem["kind"], string> = {
  overdue: "⏰ معوق",
  conflict: "⚔️ بحث/دعوا",
  stuck: "🛑 گیر کرده",
  escalation: "📣 درخواست رسیدگی",
};

const CRITICAL_TONES: Record<CriticalItem["kind"], Tone> = {
  overdue: "bad",
  conflict: "bad",
  stuck: "warn",
  escalation: "warn",
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
  info: "bg-sky-500/15 text-sky-300",
  ok: "bg-emerald-500/15 text-emerald-300",
  warn: "bg-amber-500/15 text-amber-200",
  bad: "bg-rose-500/15 text-rose-300",
};

// Persian digits everywhere (counts, percentages, durations).
const fa = (n: number, maxFraction = 0) =>
  n.toLocaleString("fa-IR", { maximumFractionDigits: maxFraction });

// Show a long list in pages instead of hundreds of rows at once.
const PAGE = 20;

export function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${fa(mins)} دقیقه`;
  }
  if (hours < 48) return `${fa(hours, 1)} ساعت`;
  const days = hours / 24;
  return `${fa(days, 1)} روز`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  // Pre-2000 values are "from the beginning" sentinels (epoch), not real
  // timestamps — showing «۱۹۷۰» to a reader is worse than showing nothing.
  if (d.getTime() < Date.UTC(2000, 0, 1)) return "—";
  // A month name keeps the date from being scrambled by bidi around "/" and ":".
  return d.toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
}

export type CurrentTopic = {
  name: string;
  messageThreadId: number;
  archived: boolean;
};

function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center max-w-full px-2 py-0.5 rounded-full text-xs font-medium tabular-nums ${TONE_CLASS[tone]}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-[var(--color-text-dim)] transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  wide,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-3 text-center min-h-[5.25rem] flex flex-col items-center justify-center ${
        wide ? "col-span-full" : ""
      }`}
    >
      <div className="text-xs text-[var(--color-text-dim)] leading-5">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums leading-8 ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-xs text-[var(--color-text-dim)] leading-5">{hint}</div>}
    </div>
  );
}

// Quoted messages behind a finding. One quote per line, speaker on top.
function Quotes({ items, max }: { items: string[]; max: number }) {
  const list = normalizeEvidence(items).slice(0, max);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((q, i) => (
        <li
          key={i}
          className="rounded-lg bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-text-dim)] text-center [overflow-wrap:anywhere]"
        >
          {q.speaker && (
            <b dir="auto" className="block text-[var(--color-text)]">
              {q.speaker}
            </b>
          )}
          <span dir="auto" className="block">
            «{q.text}»
          </span>
        </li>
      ))}
    </ul>
  );
}

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

  const since = (() => {
    if (!sinceIso) return null;
    const d = new Date(sinceIso);
    // Skip epoch sentinels — "از ۱۹۷۰ تا الان" is meaningless.
    if (!Number.isFinite(d.getTime()) || d.getTime() < Date.UTC(2000, 0, 1)) {
      return null;
    }
    return d.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
  })();

  const st = analysis.stats;
  const donePct = st.totalTasks > 0 ? Math.round((st.done / st.totalTasks) * 100) : 0;
  const highlights = analysis.highlights ?? [];
  const critical = analysis.criticalForInbox ?? [];
  const topicMessages = visibleTopicBreakdown.reduce((n, t) => n + t.messageCount, 0);

  return (
    <div dir="rtl">
      {analysis.overview && (
        <Card className="mb-3">
          <div className="text-xs text-[var(--color-text-dim)]">خلاصه‌ی وضعیت</div>
          <p className="mt-2 text-sm leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {analysis.overview}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <Chip>{fa(messageCount)} پیام</Chip>
            {since && <Chip>از {since} تا الان</Chip>}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
        <Tile label="کل کارها" value={fa(st.totalTasks)} />
        <Tile
          label="تموم"
          value={fa(st.done)}
          tone="text-emerald-300"
          hint={st.totalTasks > 0 ? `${fa(donePct)}٪` : undefined}
        />
        <Tile label="در حال انجام" value={fa(st.inProgress)} tone="text-amber-200" />
        <Tile label="اعلام‌شده" value={fa(st.announced)} tone="text-sky-300" />
        <Tile label="معوق / متوقف" value={fa(st.overdue + st.stalled)} tone="text-rose-300" />
        <Tile label="بحث/دعوا" value={fa(st.conflicts ?? 0)} />
        <Tile
          wide
          label="میانگین زمان انجام"
          value={formatDuration(st.avgCompletionHours)}
          hint="از زمان اعلام تا تموم"
        />
      </div>

      {critical.length > 0 && (
        <Card className="mb-3 border-rose-500/50">
          <div className="text-sm font-semibold text-rose-300">🆘 موارد بحرانی — نیاز به رسیدگی مستقیم شما</div>
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-dim)]">
            این موارد به کانال notes_inbox هم ارسال شدن.
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {critical.map((c, i) => (
              <div
                key={i}
                className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3 flex flex-col items-center gap-2 min-w-0"
              >
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Chip tone={CRITICAL_TONES[c.kind]}>{CRITICAL_LABELS[c.kind]}</Chip>
                  {c.topicName && <Chip>🧵 {c.topicName}</Chip>}
                </div>
                <div dir="auto" className="text-sm font-medium leading-6 [overflow-wrap:anywhere]">
                  {c.title}
                </div>
                {c.details && (
                  <p dir="auto" className="text-sm leading-7 text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
                    {c.details}
                  </p>
                )}
                {c.people.length > 0 && (
                  <div className="text-xs leading-5 text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
                    👥 {c.people.join(" / ")}
                  </div>
                )}
                {c.evidence.length > 0 && (
                  <div className="w-full">
                    <Quotes items={c.evidence} max={3} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {highlights.length > 0 && (
        <Section
          icon="🚨"
          title="نکات کلیدی"
          summary={`${fa(highlights.length)} مورد · ${highlights[0]?.title ?? ""}`}
          defaultOpen
        >
          <div className="flex flex-col gap-2">
            {highlights.map((h, i) => (
              <div
                key={i}
                className={`rounded-xl border border-[var(--color-border)] border-s-[3px] ${HIGHLIGHT_ACCENT[h.kind]} bg-[var(--color-surface-2)]/40 px-3 py-3 flex flex-col items-center gap-1.5 min-w-0`}
              >
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Chip tone={HIGHLIGHT_TONES[h.kind]}>{HIGHLIGHT_LABELS[h.kind]}</Chip>
                  {h.topicName && <Chip>🧵 {h.topicName}</Chip>}
                </div>
                <div dir="auto" className="text-sm font-medium leading-6 [overflow-wrap:anywhere]">
                  {h.title}
                </div>
                {h.details && (
                  <div dir="auto" className="text-xs leading-6 text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
                    {h.details}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {visibleTopicBreakdown.length > 1 && (
        <Section
          icon="🧵"
          title="تفکیک بر اساس تاپیک"
          summary={`${fa(visibleTopicBreakdown.length)} تاپیک · ${fa(topicMessages)} پیام`}
        >
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
        </Section>
      )}

      {overdueTasks.length > 0 && (
        <Section
          icon="⏰"
          title="کارهای معوق و متوقف"
          summary="نیازمند پیگیری"
          badge={<Chip tone="bad">{fa(overdueTasks.length)}</Chip>}
          defaultOpen
        >
          <TaskList tasks={overdueTasks} keyPrefix="overdue" emphasize />
        </Section>
      )}

      {activeTasks.length > 0 && (
        <Section
          icon="📋"
          title="کارهای فعال"
          summary="اعلام‌شده و در حال انجام"
          badge={<Chip tone="info">{fa(activeTasks.length)}</Chip>}
        >
          <TaskList tasks={activeTasks} keyPrefix="active" />
        </Section>
      )}

      {doneTasks.length > 0 && (
        <Section
          icon="✅"
          title="کارهای تموم‌شده"
          summary={
            st.avgCompletionHours != null
              ? `میانگین زمان انجام ${formatDuration(st.avgCompletionHours)}`
              : "انجام‌شده در این بازه"
          }
          badge={<Chip tone="ok">{fa(doneTasks.length)}</Chip>}
        >
          <TaskList tasks={doneTasks} keyPrefix="done" />
        </Section>
      )}

      {analysis.people.length > 0 && (
        <Section
          icon="👥"
          title="افراد و نقش‌ها"
          summary={`${fa(analysis.people.length)} نفر`}
        >
          <div className="flex flex-col gap-2">
            {analysis.people.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-3 flex flex-col items-center gap-1.5 min-w-0"
              >
                <div dir="auto" className="text-sm font-medium leading-6 [overflow-wrap:anywhere]">
                  {p.name}
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Chip tone={ROLE_TONES[p.roleLabel]}>{ROLE_LABELS[p.roleLabel]}</Chip>
                  <Chip tone="info">{fa(p.tasksAnnounced)} اعلام</Chip>
                  <Chip tone="ok">{fa(p.tasksCompleted)} تموم</Chip>
                  {p.onTimeRate !== null && (
                    <Chip tone={p.onTimeRate >= 0.8 ? "ok" : p.onTimeRate >= 0.5 ? "warn" : "bad"}>
                      {fa(Math.round(p.onTimeRate * 100))}٪ به‌موقع
                    </Chip>
                  )}
                </div>
                {p.roleDescription && (
                  <p dir="auto" className="text-xs leading-6 text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
                    {p.roleDescription}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.tasks.length === 0 && (
        <EmptyState
          icon="📋"
          title="کار مشخصی در این بازه پیدا نشد."
          hint="بازه‌ی بزرگ‌تری مثل «از ابتدا» را امتحان کن یا پردازش مجدد بزن."
        />
      )}
    </div>
  );
}

// A page of task rows with a "show more" button for long lists.
function TaskList({
  tasks,
  keyPrefix,
  emphasize,
}: {
  tasks: Task[];
  keyPrefix: string;
  emphasize?: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <div className="flex flex-col gap-2">
      {tasks.slice(0, limit).map((t, i) => (
        <TaskRow key={`${keyPrefix}-${i}`} task={t} emphasize={emphasize} />
      ))}
      {tasks.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="w-full min-h-11 rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
        >
          نمایش بیشتر ({fa(tasks.length - limit)} مورد دیگر)
        </button>
      )}
    </div>
  );
}

// One task: a tappable row (title, status chips, one meta line) that opens to its dates and quotes.
function TaskRow({ task, emphasize }: { task: Task; emphasize?: boolean }) {
  const [open, setOpen] = useState(false);
  const hot = emphasize ?? (task.isOverdue || task.status === "stalled");
  const who = task.owner ?? task.announcedBy;
  const details: Array<[string, ReactNode]> = [];
  if (task.announcedBy) details.push(["اعلام‌کننده", task.announcedBy]);
  if (task.owner && task.owner !== task.announcedBy) details.push(["مسئول", task.owner]);
  details.push(["زمان اعلام", formatTime(task.announcedAt)]);
  if (task.dueAt) details.push(["مهلت", formatTime(task.dueAt)]);
  if (task.status === "done") {
    details.push(["انجام", formatTime(task.completedAt)]);
    details.push([
      "مدت انجام",
      <span key="d" className="text-emerald-300">
        {formatDuration(task.durationHours)}
      </span>,
    ]);
    if (task.completedOnTime === false) {
      details.push([
        "تأخیر",
        <span key="l" className="text-rose-300">
          {formatDuration(task.delayHours)}
        </span>,
      ]);
    }
  }
  if (task.staleDays !== null && task.staleDays > 1 && task.status !== "done") {
    details.push([
      "بدون فعالیت",
      <span key="s" className="text-amber-300">
        {fa(Math.round(task.staleDays))} روز
      </span>,
    ]);
  }

  return (
    <div
      className={`rounded-xl border border-[var(--color-border)] border-s-[3px] ${
        hot ? "border-s-rose-400/70 bg-rose-500/5" : `${STATUS_ACCENT[task.status]} bg-[var(--color-surface-2)]/40`
      } overflow-hidden min-w-0`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-14 px-3 py-2.5 flex flex-col items-center gap-1.5 text-center active:bg-[var(--color-surface-2)]"
      >
        <span
          dir="auto"
          className={`block w-full text-sm font-medium leading-6 [overflow-wrap:anywhere] ${open ? "" : "line-clamp-2"}`}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap justify-center gap-1.5 max-w-full">
          <Chip tone={STATUS_TONES[task.status]}>{STATUS_LABELS[task.status]}</Chip>
          {task.isOverdue && <Chip tone="bad">⏰ معوق</Chip>}
          {task.priority === "high" && <Chip tone="bad">🔥 اولویت بالا</Chip>}
          {task.priority === "low" && <Chip>🟢 کم‌اولویت</Chip>}
          {task.topicName && <Chip>🧵 {task.topicName}</Chip>}
        </span>
        <span className="flex items-center justify-center gap-1 max-w-full text-xs leading-5 text-[var(--color-text-dim)]">
          <span className="truncate">
            {who} · {relTime(task.announcedAt)}
          </span>
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-3 py-3 flex flex-col gap-3 text-center">
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 [&>div:last-child:nth-child(odd)]:col-span-2 sm:[&>div:last-child:nth-child(odd)]:col-span-1">
            {details.map(([k, v], i) => (
              <div
                key={i}
                className="rounded-lg bg-[var(--color-surface)] px-2 py-1.5 min-w-0"
              >
                <dt className="text-xs leading-5 text-[var(--color-text-dim)]">{k}</dt>
                <dd dir="auto" className="text-sm leading-6 [overflow-wrap:anywhere]">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          {task.blockedReason && (
            <div dir="auto" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-200 [overflow-wrap:anywhere]">
              🚧 {task.blockedReason}
            </div>
          )}
          {task.evidence.length > 0 && <Quotes items={task.evidence} max={4} />}
        </div>
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
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 overflow-hidden min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-14 px-3 py-2.5 flex flex-col items-center gap-1.5 text-center active:bg-[var(--color-surface-2)]"
      >
        <span className="flex items-center justify-center gap-1.5 max-w-full">
          <span dir="auto" className="truncate text-sm font-medium">
            {topic.topicName}
          </span>
          <Chevron open={open} />
        </span>
        <span className="flex flex-wrap justify-center gap-1.5 max-w-full">
          <Chip>
            {fa(topic.messageCount)} پیام · {fa(topic.activeSenders)} نفر
          </Chip>
          {topic.openTasks > 0 && <Chip tone="info">{fa(topic.openTasks)} باز</Chip>}
          {topic.overdueTasks > 0 && <Chip tone="bad">{fa(topic.overdueTasks)} معوق</Chip>}
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-3 py-3 flex flex-col gap-3 text-center">
          {topic.summary && (
            <p dir="auto" className="text-sm leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {topic.summary}
            </p>
          )}

          {tasks.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["announced", byStatus.announced],
                  ["in_progress", byStatus.in_progress],
                  ["done", byStatus.done],
                  ["stalled", byStatus.stalled],
                ] as const
              ).map(([k, n]) => (
                <div
                  key={k}
                  className="rounded-lg bg-[var(--color-surface)] px-2 py-2 flex flex-col items-center gap-1"
                >
                  <Chip tone={STATUS_TONES[k]}>{STATUS_LABELS[k]}</Chip>
                  <span className="text-lg font-semibold tabular-nums leading-6">{fa(n)}</span>
                </div>
              ))}
            </div>
          )}

          {people.length > 0 && (
            <div className="text-xs leading-6 text-[var(--color-text-dim)] [overflow-wrap:anywhere]">
              <div>👥 افراد فعال</div>
              <div className="text-[var(--color-text)]">{people.join(" · ")}</div>
            </div>
          )}

          {topic.keyPoints.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {topic.keyPoints.slice(0, 6).map((p, j) => (
                <li
                  key={j}
                  dir="auto"
                  className="rounded-lg bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-text-dim)] [overflow-wrap:anywhere]"
                >
                  {p}
                </li>
              ))}
            </ul>
          )}

          {sortedTasks.length === 0 ? (
            <p className="text-xs leading-6 text-[var(--color-text-dim)]">
              توی این تاپیک هیچ task شناسایی نشد.
            </p>
          ) : (
            <TaskList
              tasks={sortedTasks}
              keyPrefix={`${topic.topicName}-task`}
            />
          )}
        </div>
      )}
    </div>
  );
}
