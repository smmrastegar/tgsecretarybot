// The improvement backlog: every feature, fix and improvement the
// system should get, with a status that moves idea → planned →
// in_progress → done. The daily metrics report reads it (what shipped
// yesterday, what is planned today) and the daily improvement session
// works from it, so it is the single agenda for the program.
import { ensureSchema, hasDb, sql } from "./core";
import { num, str, strOrNull, type Row } from "./row";

export const ROADMAP_KINDS = ["feature", "fix", "improvement", "chore"] as const;
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];
export const ROADMAP_STATUSES = ["idea", "planned", "in_progress", "done", "dropped"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapItem = {
  id: number;
  kind: RoadmapKind;
  title: string;
  details: string | null;
  /** 1 = high, 2 = normal, 3 = low */
  priority: number;
  status: RoadmapStatus;
  source: string;
  plannedFor: string | null;
  commitSha: string | null;
  outcome: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
};

const SELECT = `
  SELECT id, kind, title, details, priority, status, source,
         planned_for::text, commit_sha, outcome, created_by,
         created_at::text, updated_at::text, done_at::text
    FROM improvement_items`;

function map(r: Row): RoadmapItem {
  const kind = str(r, "kind") as RoadmapKind;
  const status = str(r, "status") as RoadmapStatus;
  return {
    id: num(r, "id"),
    kind: (ROADMAP_KINDS as readonly string[]).includes(kind) ? kind : "improvement",
    title: str(r, "title"),
    details: strOrNull(r, "details"),
    priority: num(r, "priority", 2),
    status: (ROADMAP_STATUSES as readonly string[]).includes(status) ? status : "idea",
    source: str(r, "source"),
    plannedFor: strOrNull(r, "planned_for"),
    commitSha: strOrNull(r, "commit_sha"),
    outcome: strOrNull(r, "outcome"),
    createdBy: strOrNull(r, "created_by"),
    createdAt: str(r, "created_at"),
    updatedAt: str(r, "updated_at"),
    doneAt: strOrNull(r, "done_at"),
  };
}

function q() {
  return sql() as unknown as {
    query: (text: string, params?: unknown[]) => Promise<unknown[]>;
  };
}

export async function listRoadmap(opts?: {
  status?: RoadmapStatus | "open" | "all";
  limit?: number;
}): Promise<RoadmapItem[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const status = opts?.status ?? "open";
  const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));
  let where = "";
  const params: unknown[] = [];
  if (status === "open") {
    where = `WHERE status IN ('idea','planned','in_progress')`;
  } else if (status !== "all") {
    params.push(status);
    where = `WHERE status = $1`;
  }
  params.push(limit);
  const rows = await q().query(
    `${SELECT} ${where}
     ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 WHEN 'idea' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
              priority ASC, planned_for ASC NULLS LAST, id DESC
     LIMIT $${params.length}`,
    params,
  );
  return (rows as Row[]).map(map);
}

export async function getRoadmapItem(id: number): Promise<RoadmapItem | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await q().query(`${SELECT} WHERE id = $1`, [id]);
  const r = rows[0] as Row | undefined;
  return r ? map(r) : null;
}

export async function addRoadmapItem(input: {
  kind?: string;
  title: string;
  details?: string | null;
  priority?: number;
  status?: string;
  source?: string;
  plannedFor?: string | null;
  createdBy?: string | null;
}): Promise<RoadmapItem> {
  await ensureSchema();
  const kind = (ROADMAP_KINDS as readonly string[]).includes(input.kind ?? "")
    ? input.kind
    : "improvement";
  const status = (ROADMAP_STATUSES as readonly string[]).includes(input.status ?? "")
    ? input.status
    : "idea";
  const priority = Math.min(3, Math.max(1, Math.round(input.priority ?? 2)));
  const rows = await sql()`
    INSERT INTO improvement_items
      (kind, title, details, priority, status, source, planned_for, created_by)
    VALUES (${kind}, ${input.title.trim().slice(0, 200)}, ${input.details ?? null},
            ${priority}, ${status}, ${input.source ?? "owner"},
            ${input.plannedFor ?? null}, ${input.createdBy ?? null})
    RETURNING id`;
  const id = num(rows[0] as Row, "id");
  return (await getRoadmapItem(id))!;
}

export async function updateRoadmapItem(
  id: number,
  patch: {
    kind?: string;
    title?: string;
    details?: string | null;
    priority?: number;
    status?: string;
    plannedFor?: string | null;
    commitSha?: string | null;
    outcome?: string | null;
  },
): Promise<RoadmapItem | null> {
  await ensureSchema();
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.kind != null && (ROADMAP_KINDS as readonly string[]).includes(patch.kind)) {
    set("kind", patch.kind);
  }
  if (patch.title != null && patch.title.trim()) set("title", patch.title.trim().slice(0, 200));
  if (patch.details !== undefined) set("details", patch.details);
  if (patch.priority != null) set("priority", Math.min(3, Math.max(1, Math.round(patch.priority))));
  if (patch.status != null && (ROADMAP_STATUSES as readonly string[]).includes(patch.status)) {
    set("status", patch.status);
    if (patch.status === "done") sets.push("done_at = COALESCE(done_at, NOW())");
    else if (patch.status !== "dropped") sets.push("done_at = NULL");
  }
  if (patch.plannedFor !== undefined) set("planned_for", patch.plannedFor);
  if (patch.commitSha !== undefined) set("commit_sha", patch.commitSha);
  if (patch.outcome !== undefined) set("outcome", patch.outcome);
  if (sets.length === 0) return getRoadmapItem(id);
  sets.push("updated_at = NOW()");
  params.push(id);
  await q().query(
    `UPDATE improvement_items SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params,
  );
  return getRoadmapItem(id);
}

export async function deleteRoadmapItem(id: number): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM improvement_items WHERE id = ${id}`;
}

/** Items finished within [from, to) and items planned for a given day. */
export async function roadmapDigest(from: Date, to: Date, plannedDay: string): Promise<{
  done: RoadmapItem[];
  planned: RoadmapItem[];
  inProgress: RoadmapItem[];
  openCount: number;
}> {
  if (!hasDb()) return { done: [], planned: [], inProgress: [], openCount: 0 };
  await ensureSchema();
  const done = (await q().query(
    `${SELECT} WHERE status = 'done' AND done_at >= $1 AND done_at < $2 ORDER BY done_at`,
    [from.toISOString(), to.toISOString()],
  )) as Row[];
  const planned = (await q().query(
    `${SELECT} WHERE status = 'planned' AND planned_for <= $1::date ORDER BY priority, id`,
    [plannedDay],
  )) as Row[];
  const inProgress = (await q().query(
    `${SELECT} WHERE status = 'in_progress' ORDER BY priority, id`,
  )) as Row[];
  const open = (await q().query(
    `SELECT COUNT(*)::int AS n FROM improvement_items WHERE status IN ('idea','planned','in_progress')`,
  )) as Row[];
  return {
    done: done.map(map),
    planned: planned.map(map),
    inProgress: inProgress.map(map),
    openCount: num(open[0] ?? {}, "n"),
  };
}

// --- daily metrics snapshots ---

export async function saveMetricsSnapshot(day: string, metrics: unknown): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO system_metrics_daily (day, metrics, computed_at)
    VALUES (${day}::date, ${JSON.stringify(metrics)}::jsonb, NOW())
    ON CONFLICT (day) DO UPDATE SET metrics = EXCLUDED.metrics, computed_at = NOW()`;
}

export async function listMetricsSnapshots(days = 30): Promise<Array<{ day: string; metrics: Record<string, unknown>; computedAt: string }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT day::text, metrics, computed_at::text
      FROM system_metrics_daily
     ORDER BY day DESC
     LIMIT ${Math.min(365, Math.max(1, days))}`;
  return (rows as Row[]).map((r) => ({
    day: str(r, "day"),
    metrics: (typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics) as Record<string, unknown>,
    computedAt: str(r, "computed_at"),
  }));
}
