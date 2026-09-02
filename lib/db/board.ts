// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { config } from "../config";
import { cached, ensureSchema, hasDb, sql } from "./core";

// --- Editable group task board ---
export type BoardTask = {
  id: number;
  chatId: number;
  title: string;
  status: string;
  assignee: string | null;
  topic: string | null;
  note: string | null;
  position: number;
  source: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  commentCount: number;
  priority: string | null;
  labels: string[];
  dueDate: string | null;
};

export const BOARD_STATUSES = ["todo", "doing", "blocked", "done"] as const;

// Configurable label palette (multi-select per task) + priority levels
// (single-select). Priority keys are fixed; labels have arbitrary ids.
export type BoardLabel = { id: string; name: string; color: string };
export type BoardPriority = { key: string; label: string; color: string };
export const DEFAULT_BOARD_LABELS: BoardLabel[] = [
  { id: "bug", name: "باگ", color: "#ef4444" },
  { id: "feature", name: "قابلیت", color: "#3b82f6" },
  { id: "urgent", name: "فوری", color: "#f59e0b" },
  { id: "backend", name: "بک‌اند", color: "#8b5cf6" },
  { id: "design", name: "دیزاین", color: "#ec4899" },
];
export const DEFAULT_BOARD_PRIORITIES: BoardPriority[] = [
  { key: "low", label: "کم", color: "#22c55e" },
  { key: "normal", label: "عادی", color: "#3b82f6" },
  { key: "high", label: "زیاد", color: "#f59e0b" },
  { key: "critical", label: "بحرانی", color: "#ef4444" },
];

export function parseBoardLabels(raw: string | null): BoardLabel[] {
  if (!raw) return DEFAULT_BOARD_LABELS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_BOARD_LABELS;
    const out: BoardLabel[] = [];
    for (const l of parsed) {
      if (l && typeof l === "object" && typeof l.id === "string" && l.id) {
        out.push({
          id: l.id.slice(0, 40),
          name: (String(l.name ?? "").trim() || l.id).slice(0, 40),
          color: /^#[0-9a-fA-F]{3,8}$/.test(l.color ?? "") ? l.color : "#64748b",
        });
      }
    }
    return out;
  } catch {
    return DEFAULT_BOARD_LABELS;
  }
}

export function parseBoardPriorities(raw: string | null): BoardPriority[] {
  let stored: Record<string, { label?: string; color?: string }> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (p && typeof p === "object" && typeof p.key === "string") {
            stored[p.key] = { label: p.label, color: p.color };
          }
        }
      }
    } catch {
      /* corrupt → defaults */
    }
  }
  return DEFAULT_BOARD_PRIORITIES.map((d) => {
    const s = stored[d.key];
    return {
      key: d.key,
      label: (s?.label ?? "").toString().trim().slice(0, 30) || d.label,
      color: /^#[0-9a-fA-F]{3,8}$/.test(s?.color ?? "") ? s!.color! : d.color,
    };
  });
}

// The four status keys are fixed (data integrity), but their display
// labels + colours are operator-editable via board_columns.
export type BoardColumn = { key: string; label: string; color: string };
export const DEFAULT_BOARD_COLUMNS: BoardColumn[] = [
  { key: "todo", label: "برای انجام", color: "#64748b" },
  { key: "doing", label: "در حال انجام", color: "#f59e0b" },
  { key: "blocked", label: "متوقف / بلاک", color: "#ef4444" },
  { key: "done", label: "انجام‌شده", color: "#22c55e" },
];

// Parse a stored board_columns JSON string into a full column list,
// always covering every fixed status key (falls back to the default
// label/colour for any key the stored value omits or corrupts).
export function parseBoardColumns(raw: string | null): BoardColumn[] {
  let stored: Record<string, { label?: string; color?: string }> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (c && typeof c === "object" && typeof c.key === "string") {
            stored[c.key] = { label: c.label, color: c.color };
          }
        }
      }
    } catch {
      /* corrupt → defaults */
    }
  }
  return DEFAULT_BOARD_COLUMNS.map((d) => {
    const s = stored[d.key];
    return {
      key: d.key,
      label: (s?.label ?? "").toString().trim().slice(0, 40) || d.label,
      color: /^#[0-9a-fA-F]{3,8}$/.test(s?.color ?? "") ? s!.color! : d.color,
    };
  });
}

// Fetch the operator's custom AI-categorisation prompt for a chat, if
// any. Cached briefly so the analyzer doesn't hit the DB per batch.
export const boardPromptCache = new Map<number, { prompt: string | null; at: number }>();
export async function getBoardPromptForChat(
  chatId: number,
): Promise<string | null> {
  if (!hasDb()) return null;
  const now = Date.now();
  const hit = boardPromptCache.get(chatId);
  if (hit && now - hit.at < 60_000) return hit.prompt;
  try {
    await ensureSchema();
    const rows = await sql()`
      SELECT board_prompt FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
    const p = (rows[0] as { board_prompt?: string | null })?.board_prompt ?? null;
    const prompt = p && p.trim() ? p.trim() : null;
    boardPromptCache.set(chatId, { prompt, at: now });
    return prompt;
  } catch {
    return hit?.prompt ?? null;
  }
}

// --- Board membership (Telegram-login + owner approval) ---
export type BoardMemberStatus = "pending" | "approved" | "rejected";
export type BoardMember = {
  chatId: number;
  tgId: number;
  username: string | null;
  name: string | null;
  status: BoardMemberStatus;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

function rowToBoardMember(r: Record<string, unknown>): BoardMember {
  return {
    chatId: Number(r.chat_id),
    tgId: Number(r.tg_id),
    username: (r.tg_username as string) ?? null,
    name: (r.tg_name as string) ?? null,
    status: (String(r.status ?? "pending") as BoardMemberStatus),
    decidedBy: (r.decided_by as string) ?? null,
    createdAt: r.created_at as Date,
    decidedAt: (r.decided_at as Date) ?? null,
  };
}

// Record (or refresh) a Telegram-verified access request for a board.
// Keeps an existing decision; only refreshes the display name/username.
// Returns the current member row plus whether this created a new
// pending request (so the caller knows to ping the owner).
export async function requestBoardAccess(args: {
  chatId: number;
  tgId: number;
  username?: string | null;
  name?: string | null;
  autoApprove?: boolean;
}): Promise<{ member: BoardMember; isNew: boolean }> {
  await ensureSchema();
  const existing = await sql()`
    SELECT * FROM board_members WHERE chat_id = ${args.chatId} AND tg_id = ${args.tgId} LIMIT 1`;
  if (existing[0]) {
    const rows = await sql()`
      UPDATE board_members SET
        tg_username = ${args.username ?? null},
        tg_name = ${args.name ?? null}
      WHERE chat_id = ${args.chatId} AND tg_id = ${args.tgId}
      RETURNING *`;
    return { member: rowToBoardMember(rows[0]!), isNew: false };
  }
  const status: BoardMemberStatus = args.autoApprove ? "approved" : "pending";
  const rows = await sql()`
    INSERT INTO board_members (chat_id, tg_id, tg_username, tg_name, status, decided_by, decided_at)
    VALUES (${args.chatId}, ${args.tgId}, ${args.username ?? null}, ${args.name ?? null},
            ${status}, ${args.autoApprove ? "owner" : null},
            ${args.autoApprove ? new Date() : null})
    RETURNING *`;
  return { member: rowToBoardMember(rows[0]!), isNew: !args.autoApprove };
}

export async function getBoardMember(
  chatId: number,
  tgId: number,
): Promise<BoardMember | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM board_members WHERE chat_id = ${chatId} AND tg_id = ${tgId} LIMIT 1`;
  return rows[0] ? rowToBoardMember(rows[0]) : null;
}

export async function setBoardMemberStatus(args: {
  chatId: number;
  tgId: number;
  status: BoardMemberStatus;
  decidedBy: string;
}): Promise<BoardMember | null> {
  await ensureSchema();
  const rows = await sql()`
    UPDATE board_members SET
      status = ${args.status},
      decided_by = ${args.decidedBy},
      decided_at = NOW()
    WHERE chat_id = ${args.chatId} AND tg_id = ${args.tgId}
    RETURNING *`;
  return rows[0] ? rowToBoardMember(rows[0]) : null;
}

export async function listBoardMembers(chatId: number): Promise<BoardMember[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM board_members WHERE chat_id = ${chatId}
     ORDER BY (status = 'pending') DESC, created_at DESC`;
  return rows.map(rowToBoardMember);
}

function rowToBoardTask(r: Record<string, unknown>): BoardTask {
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    title: String(r.title ?? ""),
    status: String(r.status ?? "todo"),
    assignee: (r.assignee as string) ?? null,
    topic: (r.topic as string) ?? null,
    note: (r.note as string) ?? null,
    position: Number(r.position ?? 0),
    source: String(r.source ?? "manual"),
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    commentCount: Number(r.comment_count ?? 0),
    priority: (r.priority as string) ?? null,
    labels: Array.isArray(r.labels)
      ? (r.labels as unknown[]).map((x) => String(x))
      : [],
    dueDate:
      r.due_date == null
        ? null
        : r.due_date instanceof Date
          ? r.due_date.toISOString().slice(0, 10)
          : String(r.due_date).slice(0, 10),
  };
}

export async function listBoardTasks(chatId: number): Promise<BoardTask[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT t.*, COALESCE(c.n, 0) AS comment_count
      FROM group_board_tasks t
      LEFT JOIN (
        SELECT task_id, COUNT(*)::int AS n
          FROM board_task_comments WHERE chat_id = ${chatId}
         GROUP BY task_id
      ) c ON c.task_id = t.id
     WHERE t.chat_id = ${chatId}
     ORDER BY t.position ASC, t.id ASC`;
  return rows.map(rowToBoardTask);
}

// --- Board task comments ---
export type BoardTaskComment = {
  id: number;
  taskId: number;
  author: string | null;
  body: string;
  createdAt: Date;
};

export async function listTaskComments(
  chatId: number,
  taskId: number,
): Promise<BoardTaskComment[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, task_id, author, body, created_at
      FROM board_task_comments
     WHERE chat_id = ${chatId} AND task_id = ${taskId}
     ORDER BY created_at ASC, id ASC`;
  return rows.map((r) => ({
    id: Number(r.id),
    taskId: Number(r.task_id),
    author: (r.author as string) ?? null,
    body: String(r.body ?? ""),
    createdAt: r.created_at as Date,
  }));
}

export async function addTaskComment(args: {
  chatId: number;
  taskId: number;
  author: string | null;
  body: string;
}): Promise<BoardTaskComment | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Guard: the task must belong to this chat.
  const t = await sql()`
    SELECT 1 FROM group_board_tasks WHERE id = ${args.taskId} AND chat_id = ${args.chatId} LIMIT 1`;
  if (t.length === 0) return null;
  const rows = await sql()`
    INSERT INTO board_task_comments (chat_id, task_id, author, body)
    VALUES (${args.chatId}, ${args.taskId}, ${args.author ?? null}, ${args.body.slice(0, 2000)})
    RETURNING id, task_id, author, body, created_at`;
  const r = rows[0]!;
  return {
    id: Number(r.id),
    taskId: Number(r.task_id),
    author: (r.author as string) ?? null,
    body: String(r.body ?? ""),
    createdAt: r.created_at as Date,
  };
}

// --- Board content tabs ---
// kind = "filter": a live view of the real board tasks, filtered by
//   config {statuses[], priorities[], overdue}. Fully interrelated with
//   the kanban — editing a task here edits it everywhere.
// kind = "list": a structured, manageable list. config {fields:[]} names
//   the columns; items is an array of { id, values: string[] } rows.
export type TabFilterConfig = { statuses?: string[]; priorities?: string[]; overdue?: boolean };
export type TabListConfig = { fields?: string[] };
export type TabListItem = { id: string; values: string[] };
export type BoardTab = {
  id: number;
  title: string;
  icon: string | null;
  kind: string;
  config: Record<string, unknown>;
  items: TabListItem[];
  position: number;
  source: string;
};

function asObj(v: unknown): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asItems(v: unknown): TabListItem[] {
  let arr: unknown = v;
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? `r${i}`),
      values: Array.isArray(o.values) ? (o.values as unknown[]).map((x) => String(x ?? "")) : [],
    };
  });
}

function rowToBoardTab(r: Record<string, unknown>): BoardTab {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    icon: (r.icon as string) ?? null,
    kind: String(r.kind ?? "list"),
    config: asObj(r.config),
    items: asItems(r.items),
    position: Number(r.position ?? 0),
    source: String(r.source ?? "manual"),
  };
}

export async function listBoardTabs(chatId: number): Promise<BoardTab[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM board_tabs WHERE chat_id = ${chatId} ORDER BY position ASC, id ASC`;
  return rows.map(rowToBoardTab);
}

export async function getBoardTab(id: number, chatId: number): Promise<BoardTab | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM board_tabs WHERE id = ${id} AND chat_id = ${chatId} LIMIT 1`;
  return rows[0] ? rowToBoardTab(rows[0]) : null;
}

export async function createBoardTab(args: {
  chatId: number;
  title: string;
  icon?: string | null;
  kind?: string;
  config?: Record<string, unknown> | null;
  items?: TabListItem[] | null;
  source?: string;
}): Promise<BoardTab | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const configJson = args.config != null ? JSON.stringify(args.config) : null;
  const itemsJson = args.items != null ? JSON.stringify(args.items) : null;
  const rows = await sql()`
    INSERT INTO board_tabs (chat_id, title, icon, kind, config, items, source, position)
    VALUES (${args.chatId}, ${args.title.slice(0, 80)}, ${args.icon ?? null},
            ${args.kind ?? "list"}, ${configJson}::jsonb, ${itemsJson}::jsonb,
            ${args.source ?? "manual"},
            COALESCE((SELECT MAX(position) + 1 FROM board_tabs WHERE chat_id = ${args.chatId}), 0))
    RETURNING *`;
  return rows[0] ? rowToBoardTab(rows[0]) : null;
}

export async function updateBoardTab(args: {
  id: number;
  chatId: number;
  title?: string;
  icon?: string | null;
  config?: Record<string, unknown>;
  items?: TabListItem[];
  position?: number;
}): Promise<BoardTab | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const configJson = args.config !== undefined ? JSON.stringify(args.config) : null;
  const itemsJson = args.items !== undefined ? JSON.stringify(args.items) : null;
  const rows = await sql()`
    UPDATE board_tabs SET
      title    = COALESCE(${args.title ?? null}, title),
      icon     = CASE WHEN ${args.icon !== undefined} THEN ${args.icon ?? null} ELSE icon END,
      config   = CASE WHEN ${args.config !== undefined} THEN ${configJson}::jsonb ELSE config END,
      items    = CASE WHEN ${args.items !== undefined} THEN ${itemsJson}::jsonb ELSE items END,
      position = COALESCE(${args.position ?? null}, position),
      updated_at = NOW()
    WHERE id = ${args.id} AND chat_id = ${args.chatId}
    RETURNING *`;
  return rows[0] ? rowToBoardTab(rows[0]) : null;
}

export async function deleteBoardTab(args: { id: number; chatId: number }): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    DELETE FROM board_tabs WHERE id = ${args.id} AND chat_id = ${args.chatId} RETURNING id`;
  return rows.length > 0;
}

// Seed the default structured tabs once from the latest AI analysis.
// Task-type sections become LIVE filter tabs over the real board tasks;
// the rest become editable structured lists.
export async function seedBoardTabsOnce(chatId: number): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const already = await sql()`SELECT 1 FROM board_tabs_seeded WHERE chat_id = ${chatId} LIMIT 1`;
  if (already.length > 0) return 0;

  const cached = await sql()`
    SELECT analysis FROM group_analytics WHERE chat_id = ${chatId}
     ORDER BY created_at DESC LIMIT 1`;
  const a = (cached[0] as { analysis?: unknown })?.analysis as
    | Record<string, unknown>
    | undefined;
  const asArr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const join = (v: unknown): string => (Array.isArray(v) ? (v as unknown[]).map(String).join("، ") : "");
  const n = (v: unknown): number => Number(v ?? 0);
  let rid = 0;
  const row = (...values: string[]): TabListItem => ({ id: `s${rid++}`, values });
  const ROLE_FA: Record<string, string> = {
    executor: "مجری", reporter: "گزارش‌گر", supervisor: "ناظر", designer: "طراح",
    support: "پشتیبان", stakeholder: "ذی‌نفع", other: "سایر",
  };

  // Rich, pre-filled, EDITABLE lists mirroring the well-populated report.
  const criticalItems = asArr(a?.criticalForInbox).map((c) =>
    row(s(c.title), s(c.kind), join(c.people), s(c.details)),
  );
  const highlightItems = asArr(a?.highlights).map((h) =>
    row(s(h.title), s(h.kind), s(h.details), s(h.topicName)),
  );
  const topicItems = asArr(a?.topicBreakdown).map((t) =>
    row(
      s(t.topicName),
      s(t.summary),
      join(t.keyPoints),
      `${n(t.openTasks)} باز / ${n(t.overdueTasks)} معوق`,
    ),
  );
  const peopleItems = asArr(a?.people).map((p) =>
    row(
      s(p.name),
      ROLE_FA[s(p.roleLabel)] ?? s(p.roleLabel),
      s(p.roleDescription),
      `اعلام ${n(p.tasksAnnounced)} / انجام ${n(p.tasksCompleted)}`,
    ),
  );

  // Drop any column that is empty across every row, so tabs never show a
  // sea of blank cells (keeps at least the first column).
  const compact = (
    fields: string[],
    items: TabListItem[],
  ): { fields: string[]; items: TabListItem[] } => {
    const keep = fields.map((_, ci) => ci === 0 || items.some((it) => (it.values[ci] ?? "").trim() !== ""));
    return {
      fields: fields.filter((_, ci) => keep[ci]),
      items: items.map((it) => ({ ...it, values: it.values.filter((_, ci) => keep[ci]) })),
    };
  };
  const crit = compact(["عنوان", "نوع", "افراد درگیر", "توضیح"], criticalItems);
  const hl = compact(["نکته", "نوع", "توضیح", "تاپیک"], highlightItems);
  const tp = compact(["تاپیک", "خلاصه", "نکات کلیدی", "تسک‌ها"], topicItems);
  const pe = compact(["نام", "نقش", "توضیح نقش", "کارنامه"], peopleItems);

  const defs: Array<Parameters<typeof createBoardTab>[0]> = [
    { chatId, source: "ai", icon: "🆘", title: "موارد بحرانی — نیاز به رسیدگی مستقیم شما", kind: "list", config: { fields: crit.fields }, items: crit.items },
    { chatId, source: "ai", icon: "🚨", title: "نکات کلیدی", kind: "list", config: { fields: hl.fields }, items: hl.items },
    { chatId, source: "ai", icon: "🧵", title: "تفکیک بر اساس تاپیک", kind: "list", config: { fields: tp.fields }, items: tp.items },
    { chatId, source: "ai", icon: "⏰", title: "کارهای معوق و متوقف", kind: "filter", config: { statuses: ["blocked"], overdue: true }, items: [] },
    { chatId, source: "ai", icon: "📋", title: "کارهای فعال", kind: "filter", config: { statuses: ["doing"] }, items: [] },
    { chatId, source: "ai", icon: "👥", title: "افراد و نقش‌ها", kind: "list", config: { fields: pe.fields }, items: pe.items },
  ];
  for (const d of defs) await createBoardTab(d);
  await sql()`INSERT INTO board_tabs_seeded (chat_id) VALUES (${chatId}) ON CONFLICT DO NOTHING`;
  return defs.length;
}

export async function getBoardTask(
  id: number,
  chatId: number,
): Promise<BoardTask | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM group_board_tasks WHERE id = ${id} AND chat_id = ${chatId} LIMIT 1`;
  return rows[0] ? rowToBoardTask(rows[0]) : null;
}

export async function createBoardTask(args: {
  chatId: number;
  title: string;
  status?: string;
  assignee?: string | null;
  topic?: string | null;
  note?: string | null;
  priority?: string | null;
  labels?: string[] | null;
  dueDate?: string | null;
  source?: string;
  createdBy?: string | null;
}): Promise<BoardTask | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const status = (BOARD_STATUSES as readonly string[]).includes(args.status ?? "")
    ? args.status
    : "todo";
  const labelsJson = Array.isArray(args.labels) ? JSON.stringify(args.labels) : null;
  const rows = await sql()`
    INSERT INTO group_board_tasks (chat_id, title, status, assignee, topic, note, priority, labels, due_date, source, created_by, position)
    VALUES (${args.chatId}, ${args.title.slice(0, 500)}, ${status},
            ${args.assignee ?? null}, ${args.topic ?? null}, ${args.note ?? null},
            ${args.priority ?? null}, ${labelsJson}::jsonb, ${args.dueDate ?? null},
            ${args.source ?? "manual"}, ${args.createdBy ?? null},
            COALESCE((SELECT MAX(position) + 1 FROM group_board_tasks WHERE chat_id = ${args.chatId}), 0))
    RETURNING *`;
  return rows[0] ? rowToBoardTask(rows[0]) : null;
}

export async function updateBoardTask(args: {
  id: number;
  chatId: number;
  title?: string;
  status?: string;
  assignee?: string | null;
  topic?: string | null;
  note?: string | null;
  priority?: string | null;
  labels?: string[] | null;
  dueDate?: string | null;
}): Promise<BoardTask | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const labelsJson =
    args.labels !== undefined && args.labels !== null ? JSON.stringify(args.labels) : null;
  const rows = await sql()`
    UPDATE group_board_tasks SET
      title    = COALESCE(${args.title ?? null}, title),
      status   = COALESCE(${args.status ?? null}, status),
      assignee = CASE WHEN ${args.assignee !== undefined} THEN ${args.assignee ?? null} ELSE assignee END,
      topic    = CASE WHEN ${args.topic !== undefined} THEN ${args.topic ?? null} ELSE topic END,
      note     = CASE WHEN ${args.note !== undefined} THEN ${args.note ?? null} ELSE note END,
      priority = CASE WHEN ${args.priority !== undefined} THEN ${args.priority ?? null} ELSE priority END,
      labels   = CASE WHEN ${args.labels !== undefined} THEN ${labelsJson}::jsonb ELSE labels END,
      due_date = CASE WHEN ${args.dueDate !== undefined} THEN ${args.dueDate ?? null} ELSE due_date END,
      updated_at = NOW()
    WHERE id = ${args.id} AND chat_id = ${args.chatId}
    RETURNING *`;
  return rows[0] ? rowToBoardTask(rows[0]) : null;
}

export async function deleteBoardTask(args: {
  id: number;
  chatId: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    DELETE FROM group_board_tasks WHERE id = ${args.id} AND chat_id = ${args.chatId}
    RETURNING id`;
  return rows.length > 0;
}

// Seed the board once from the latest AI analysis's tasks, so a brand
// new board opens pre-populated instead of empty. No-op if already
// seeded or if the board already has rows.
export async function seedBoardFromAnalysisOnce(chatId: number): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const already = await sql()`SELECT 1 FROM group_board_seeded WHERE chat_id = ${chatId} LIMIT 1`;
  if (already.length > 0) return 0;
  const existing = await sql()`SELECT COUNT(*)::int AS n FROM group_board_tasks WHERE chat_id = ${chatId}`;
  if (Number((existing[0] as { n: number })?.n ?? 0) > 0) {
    await sql()`INSERT INTO group_board_seeded (chat_id) VALUES (${chatId}) ON CONFLICT DO NOTHING`;
    return 0;
  }
  const cached = await sql()`
    SELECT analysis FROM group_analytics WHERE chat_id = ${chatId}
     ORDER BY created_at DESC LIMIT 1`;
  const analysis = (cached[0] as { analysis?: unknown })?.analysis as
    | { tasks?: Array<Record<string, unknown>> }
    | undefined;
  const tasks = Array.isArray(analysis?.tasks) ? analysis!.tasks! : [];
  let inserted = 0;
  for (const t of tasks.slice(0, 300)) {
    const title = String(
      (t.title ?? t.task ?? t.text ?? t.description ?? "") as string,
    ).trim();
    if (!title) continue;
    const rawStatus = String((t.status ?? t.state ?? "") as string).toLowerCase();
    const status = rawStatus.includes("done")
      ? "done"
      : rawStatus.includes("progress") || rawStatus.includes("doing")
        ? "doing"
        : rawStatus.includes("block") || rawStatus.includes("stop")
          ? "blocked"
          : "todo";
    await createBoardTask({
      chatId,
      title,
      status,
      assignee: (t.assignee ?? t.owner ?? t.who ?? null) as string | null,
      topic: (t.topic ?? t.category ?? null) as string | null,
      source: "ai",
    });
    inserted++;
  }
  await sql()`INSERT INTO group_board_seeded (chat_id) VALUES (${chatId}) ON CONFLICT DO NOTHING`;
  return inserted;
}

// --- Board audit log + revert ---
export type BoardEvent = {
  id: number;
  chatId: number;
  taskId: number | null;
  action: string;
  actor: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reverted: boolean;
  createdAt: Date;
};

function rowToBoardEvent(r: Record<string, unknown>): BoardEvent {
  const j = (v: unknown): Record<string, unknown> | null => {
    if (v == null) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return v as Record<string, unknown>;
  };
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    taskId: r.task_id == null ? null : Number(r.task_id),
    action: String(r.action ?? ""),
    actor: (r.actor as string) ?? null,
    summary: String(r.summary ?? ""),
    before: j(r.before_json),
    after: j(r.after_json),
    reverted: Boolean(r.reverted),
    createdAt: r.created_at as Date,
  };
}

export async function logBoardEvent(args: {
  chatId: number;
  taskId: number | null;
  action: string;
  actor: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO group_board_events (chat_id, task_id, action, actor, summary, before_json, after_json)
    VALUES (${args.chatId}, ${args.taskId}, ${args.action}, ${args.actor}, ${args.summary},
            ${args.before != null ? JSON.stringify(args.before) : null}::jsonb,
            ${args.after != null ? JSON.stringify(args.after) : null}::jsonb)`;
}

export async function listBoardEvents(
  chatId: number,
  limit = 100,
): Promise<BoardEvent[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM group_board_events WHERE chat_id = ${chatId}
     ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return rows.map(rowToBoardEvent);
}

export async function getBoardEvent(
  id: number,
  chatId: number,
): Promise<BoardEvent | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM group_board_events WHERE id = ${id} AND chat_id = ${chatId} LIMIT 1`;
  return rows[0] ? rowToBoardEvent(rows[0]) : null;
}

export async function markBoardEventReverted(id: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`UPDATE group_board_events SET reverted = TRUE WHERE id = ${id}`;
}

// Re-insert a task with a specific set of fields (used when reverting a
// delete — the id will be new, but the content is restored).
export async function restoreBoardTask(args: {
  chatId: number;
  before: Record<string, unknown>;
}): Promise<BoardTask | null> {
  const b = args.before;
  return createBoardTask({
    chatId: args.chatId,
    title: String(b.title ?? ""),
    status: String(b.status ?? "todo"),
    assignee: (b.assignee as string) ?? null,
    topic: (b.topic as string) ?? null,
    note: (b.note as string) ?? null,
    priority: (b.priority as string) ?? null,
    labels: Array.isArray(b.labels) ? (b.labels as unknown[]).map(String) : null,
    dueDate: (b.dueDate as string) ?? (b.due_date as string) ?? null,
    source: String(b.source ?? "manual"),
    createdBy: (b.createdBy as string) ?? (b.created_by as string) ?? null,
  });
}

export async function findChatByAnalyticsShareToken(
  token: string,
): Promise<{ chatId: number; chatTitle: string | null } | null> {
  if (!hasDb() || !token) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_title FROM chat_rules
    WHERE analytics_share_token = ${token} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
  };
}
