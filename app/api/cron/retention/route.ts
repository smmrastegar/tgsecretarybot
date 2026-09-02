import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { hasDb, sql } from "@/lib/db";
import { reportError, reportWarn } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

// Append-only operational tables with no reader past a few weeks. Nothing
// ever pruned them, so processed_updates (a dedupe set for Telegram
// update ids) and media_routing_log (a debug trace) had grown to ~100k
// and ~30k rows with most of it months old.
//
// Cost tables keep 90 days because /costs reads them for trend lines;
// dedupe and debug tables keep 30. messages_log, chat_notes,
// system_errors and the like are NOT here on purpose — they are the
// product's memory, not its exhaust.
const POLICY: Array<{ table: string; column: string; keepDays: number }> = [
  { table: "processed_updates", column: "processed_at", keepDays: 30 },
  { table: "media_routing_log", column: "created_at", keepDays: 30 },
  { table: "telegram_debug_log", column: "received_at", keepDays: 30 },
  { table: "ai_usage", column: "created_at", keepDays: 90 },
  { table: "hikerapi_usage", column: "called_at", keepDays: 90 },
];

// One DELETE per table, capped per run so a first pass over a large
// backlog can't hold a lock for minutes. The cron runs daily; a backlog
// drains over a few days rather than in one long transaction.
const BATCH = 20_000;

async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const q = sql() as unknown as {
    query: (text: string, params?: unknown[]) => Promise<unknown[]>;
  };
  const deleted: Record<string, number> = {};
  const failed: Record<string, string> = {};
  for (const p of POLICY) {
    // Table and column names come from the constant above, never from
    // the request — safe to interpolate.
    const text = `
      DELETE FROM ${p.table}
      WHERE ctid IN (
        SELECT ctid FROM ${p.table}
        WHERE ${p.column} < NOW() - ($1 || ' days')::INTERVAL
        LIMIT $2
      )
      RETURNING 1`;
    try {
      const rows = await q.query(text, [String(p.keepDays), BATCH]);
      deleted[p.table] = rows.length;
    } catch (err) {
      failed[p.table] = err instanceof Error ? err.message : String(err);
      reportError("cron:retention", `${p.table} prune failed:`, err);
    }
  }
  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  const hitCap = Object.values(deleted).some((n) => n >= BATCH);
  if (hitCap) {
    // Not an error — just a note that there is more backlog than one
    // run drains, so the operator isn't surprised the count keeps
    // moving for a few days.
    reportWarn(
      "cron:retention",
      `pruned ${total} rows; at least one table hit the ${BATCH}-row cap, more will go next run`,
    );
  }
  return NextResponse.json({ ok: true, deleted, failed, hitCap });
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
