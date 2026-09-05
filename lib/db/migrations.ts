// Forward-only schema migrations, tracked in schema_migrations.
//
// ensureSchema() in core.ts is ~240 idempotent CREATE/ALTER statements
// guarded by a single SCHEMA_VERSION string: forget to bump the string
// and the new DDL silently never runs. That happened twice in one week.
//
// New schema changes go HERE instead. Each migration has a stable id and
// runs exactly once, in order, whether or not SCHEMA_VERSION changed —
// the runner is invoked on both the fast path and the full path. The
// existing ensureSchema DDL is left in place: it is idempotent, proven
// against the live database, and rewriting it would be pure risk.
//
// Rules:
//   * ids sort lexically → use YYYY-MM-DD-NNN-short-name
//   * a migration must be safe to run against production data
//   * never edit a migration that has shipped; add a new one
//   * keep ensureSchema's DDL list closed — additions go in MIGRATIONS

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { reportError } from "../report";

type Q = NeonQueryFunction<false, false>;

export type Migration = {
  id: string;
  up: (q: Q) => Promise<void>;
};

export const MIGRATIONS: Migration[] = [
  {
    // A scoped token could write to exactly one chat, and only inside
    // one topic of it. The DevOps agent needs full write in a second
    // group while keeping the topic-confined write in the first, so
    // write_chat_ids lists chats it may post to in any topic.
    id: "2026-09-05-001-mcp-write-chat-ids",
    up: async (q) => {
      await q`ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS write_chat_ids TEXT`;
    },
  },
  // Example of the shape — the table it creates is the runner's own.
  {
    id: "2026-09-02-000-schema-migrations-bootstrap",
    up: async (q) => {
      await q`SELECT 1`;
    },
  },
];

let ran: Promise<void> | null = null;

export async function runMigrations(q: Q): Promise<void> {
  if (ran) return ran;
  ran = (async () => {
    await q`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    const rows = (await q`SELECT id FROM schema_migrations`) as Array<{ id: string }>;
    const done = new Set(rows.map((r) => r.id));
    const pending = MIGRATIONS.filter((m) => !done.has(m.id)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const m of pending) {
      try {
        await m.up(q);
        await q`INSERT INTO schema_migrations (id) VALUES (${m.id}) ON CONFLICT DO NOTHING`;
      } catch (err) {
        // Stop at the first failure so later migrations never run against
        // a half-applied predecessor. The next boot retries from here.
        reportError("db:migrations", `migration ${m.id} failed:`, err);
        throw err;
      }
    }
  })().catch((err) => {
    ran = null; // allow a retry on the next call
    throw err;
  });
  return ran;
}
