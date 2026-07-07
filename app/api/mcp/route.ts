import { config } from "@/lib/config";
import {
  ensureSchema,
  getChatRule,
  hasDb,
  listChatMessagesForAnalysis,
  listForumTopics,
  sql,
  upsertGroupAnalytics,
} from "@/lib/db";
import { analyzeGroupTasksV2, analyzeSiteChange } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";
import { fetchMonitoredPage } from "@/lib/site-monitor";
import { getPool, makeCaptureClient, makeMysqlClient } from "@/lib/sql-driver";
import { getPgPool, makePgClient } from "@/lib/pg-driver";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { SiteMonitor } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ──────────────────────────────────────────────────────────────────
// Model Context Protocol (MCP) server — stateless Streamable HTTP.
//
// Exposes the bot's Postgres database to an MCP client (Claude
// Desktop / Claude.ai connectors, Cursor, VS Code, mcp-remote, …) so
// the operator can analyse the data conversationally.
//
// Transport: each POST carries one JSON-RPC 2.0 message; we answer
// with a single application/json response (no SSE needed for these
// request/response tools). Notifications (no id) get 202 + empty body.
//
// Auth: Authorization: Bearer <MCP_SECRET>. Without MCP_SECRET set the
// endpoint is hard-disabled.
// ──────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "tgsecretarybot";
const SERVER_VERSION = "0.2.0";

// Max rows returned by query/execute so a `SELECT *` on messages_log
// can't blow up the response. Clients can paginate with LIMIT/OFFSET.
const MAX_ROWS = 2000;

type JsonRpcReq = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function ok(id: string | number | null | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}
function err(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

// Reject anything that isn't a single read-only statement. Used by the
// `query` tool; `execute` skips this.
const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COMMENT|REINDEX|VACUUM|COPY|MERGE|CALL|DO)\b/i;
function assertReadOnly(q: string): void {
  const trimmed = q.trim().replace(/;+\s*$/, "");
  if (/;/.test(trimmed)) {
    throw new Error("only a single statement is allowed");
  }
  if (!/^\s*(SELECT|WITH|TABLE|VALUES|EXPLAIN|SHOW)\b/i.test(trimmed)) {
    throw new Error("query must start with SELECT / WITH / EXPLAIN / SHOW");
  }
  if (WRITE_KEYWORDS.test(trimmed)) {
    throw new Error(
      "write keywords are not allowed in query() — use execute() for writes",
    );
  }
}

type ToolResult = { rows: unknown[]; rowCount: number; truncated: boolean };

async function runSql(text: string): Promise<ToolResult> {
  if (!hasDb()) throw new Error("DATABASE_URL not configured");
  // neon()'s tagged-template function also exposes .query(text, params)
  // for plain string execution.
  const q = sql() as unknown as {
    query: (t: string, p?: unknown[]) => Promise<unknown[]>;
  };
  const rows = (await q.query(text)) ?? [];
  const arr = Array.isArray(rows) ? rows : [];
  const truncated = arr.length > MAX_ROWS;
  return {
    rows: truncated ? arr.slice(0, MAX_ROWS) : arr,
    rowCount: arr.length,
    truncated,
  };
}

// Parameterised query for the curated tools — uses $1/$2 placeholders
// so group_id etc. can't be injected.
async function runParams(text: string, params: unknown[]): Promise<unknown[]> {
  if (!hasDb()) throw new Error("DATABASE_URL not configured");
  const q = sql() as unknown as {
    query: (t: string, p?: unknown[]) => Promise<unknown[]>;
  };
  return (await q.query(text, params)) ?? [];
}

const TOOLS = [
  {
    name: "list_tables",
    description:
      "List all tables in the public schema with their row-count estimate. Start here to see what data is available.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "describe_table",
    description:
      "Show the columns (name, type, nullable, default) of one table. Use after list_tables to learn a table's shape before querying it.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name in the public schema" },
      },
      required: ["table"],
      additionalProperties: false,
    },
  },
  {
    name: "query",
    description:
      "Run a READ-ONLY SQL query (SELECT / WITH / EXPLAIN / SHOW) against the Postgres database and return rows as JSON. Single statement only; write keywords are rejected. Results are capped at 2000 rows — use LIMIT/OFFSET to paginate. This is the main tool for analysing the data.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single read-only SQL statement" },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    name: "execute",
    description:
      "Run a WRITE SQL statement (INSERT / UPDATE / DELETE / DDL). DANGEROUS — this mutates the production database and is NOT reversible. Only use when the user has explicitly asked to change data. Returns affected rows when the statement uses RETURNING.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SQL statement to execute" },
        confirm: {
          type: "boolean",
          description:
            "Must be true to actually run. A guard against accidental writes.",
        },
      },
      required: ["sql", "confirm"],
      additionalProperties: false,
    },
  },
  // ─── Curated group-analysis tools ──────────────────────────────
  {
    name: "list_groups",
    description:
      "List every group / supergroup the bot has seen, with message count, distinct sender count, first/last activity, and whether a cached AI task-analysis exists. Use this to pick a group_id for the other group_* tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "group_overview",
    description:
      "Activity snapshot for ONE group: total messages, distinct senders, date range, per-topic message counts, top 15 senders by volume, and daily message counts for the last 30 days.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: {
          type: "number",
          description: "chat_id of the group (negative number)",
        },
      },
      required: ["group_id"],
      additionalProperties: false,
    },
  },
  {
    name: "group_tasks",
    description:
      "Return the cached AI task-analysis for a group — overview, stats, and the full task list (title, status, owner, announced/completed times, overdue flag, topic). This is the output of the group analyzer. window_days=0 is the all-time analysis. If no cache exists, returns an empty result and you should tell the user to open the group's analytics page once to build it.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: { type: "number", description: "chat_id of the group" },
        window_days: {
          type: "number",
          description:
            "Which cached window to read (0 = all-time, 7 / 14 / 30 = bounded). Defaults to whichever window has the most messages.",
        },
      },
      required: ["group_id"],
      additionalProperties: false,
    },
  },
  {
    name: "group_topic_messages",
    description:
      "Raw messages for ONE group, optionally filtered to one topic, newest first. Use to read what people actually said when the task analysis isn't enough. Capped at 500 messages.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: { type: "number", description: "chat_id of the group" },
        topic: {
          type: "string",
          description:
            "Optional forum topic name to filter to (matches forum_topics.name). Omit for all topics.",
        },
        limit: {
          type: "number",
          description: "Max messages to return (default 200, max 500)",
        },
      },
      required: ["group_id"],
      additionalProperties: false,
    },
  },
  {
    name: "group_members",
    description:
      "Member roster for a group: numeric user_id, @username, name, status (member/admin/…), is_premium, message count, first/last seen. Combines chat_member events with message senders.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: { type: "number", description: "chat_id of the group" },
      },
      required: ["group_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_message",
    description:
      "Send a text message AS THE BOT to a Telegram chat (group/user) the bot is a member of. Supports HTML parse_mode (<b>, <i>, <code>, <a href>). Use to post reports into a group. Max 4096 chars per message — split long content into multiple calls.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: ["number", "string"],
          description:
            "Target chat_id (group is negative) or '@username' (only works via business connection / public peers)",
        },
        text: { type: "string", description: "Message text (HTML allowed)" },
        parse_mode: {
          type: "string",
          description: "'HTML' (default) or 'MarkdownV2' or 'none'",
        },
        message_thread_id: {
          type: "number",
          description:
            "Optional forum topic thread id to post INTO a specific topic of a supergroup. Omit for the General channel.",
        },
        business_connection_id: {
          type: "string",
          description:
            "Optional. When set, the message is sent ON BEHALF OF the connected business account (i.e. appears FROM the owner, not the bot) — use this to reply inside the owner's personal DMs.",
        },
      },
      required: ["chat_id", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "send_photo",
    description:
      "Send a photo (by public URL) AS THE BOT to a Telegram chat, with an optional HTML caption. Use for charts / diagrams that illustrate a report. The URL must be publicly fetchable by Telegram's servers.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "number", description: "Target chat_id" },
        photo_url: { type: "string", description: "Public image URL" },
        caption: {
          type: "string",
          description: "Optional HTML caption (max 1024 chars)",
        },
        message_thread_id: {
          type: "number",
          description: "Optional forum topic thread id (post into a topic)",
        },
        business_connection_id: {
          type: "string",
          description:
            "Optional. Send on behalf of the connected business account (appears FROM the owner).",
        },
      },
      required: ["chat_id", "photo_url"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_message",
    description:
      "Delete a message the bot sent (by chat_id + message_id). Use to clean up mistakes.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "number", description: "chat_id" },
        message_id: { type: "number", description: "message_id to delete" },
      },
      required: ["chat_id", "message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "find_chat",
    description:
      "Find a chat (DM or group) by a person's name or group title (case-insensitive substring). Returns chat_id, chat_type, display name/title, business_connection_id (needed to reply as the owner), message count, first/last seen. One call instead of writing SQL — use before chat_messages / send_*.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name / title substring to search" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "chat_messages",
    description:
      "Recent messages for ANY chat (DM or group) by chat_id, newest first by default. Returns sender, from_owner flag, text (or transcript / media placeholder), time. Use for sentiment / summary / analysis of a person's chat.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "number", description: "chat_id" },
        limit: { type: "number", description: "max messages (default 30, max 300)" },
        order: { type: "string", description: "'desc' (newest first, default) or 'asc'" },
      },
      required: ["chat_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_chart",
    description:
      "Build a chart from a Chart.js config object (rendered server-side via QuickChart) and send it as a photo to a chat. Saves building chart URLs by hand. Pass the Chart.js spec in `chart` (e.g. {type:'line',data:{...},options:{...}}). Use Latin/number labels for axes (Persian renders poorly in charts) and put Persian text in the caption.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "number", description: "target chat_id" },
        chart: {
          type: "object",
          description: "Chart.js config object (type/data/options)",
        },
        caption: { type: "string", description: "Optional HTML caption" },
        business_connection_id: {
          type: "string",
          description: "Optional — send as the owner's business account",
        },
        message_thread_id: {
          type: "number",
          description: "Optional forum topic id",
        },
      },
      required: ["chat_id", "chart"],
      additionalProperties: false,
    },
  },
  {
    name: "site_probe",
    description:
      "TEST a site-monitor config from the server (which has internet access): log in with the given credentials and fetch the target page, returning login status, cookie count, a text preview, and the AI verdict — WITHOUT saving anything. Use to verify the login field names are right before creating the monitor.",
    inputSchema: {
      type: "object",
      properties: {
        login_url: { type: "string" },
        check_url: { type: "string" },
        username: { type: "string" },
        password: { type: "string" },
        username_field: { type: "string", description: "form field name for username (default 'username')" },
        password_field: { type: "string", description: "form field name for password (default 'password')" },
        extra_fields_json: { type: "string", description: "optional JSON of extra form fields" },
      },
      required: ["login_url", "check_url"],
      additionalProperties: false,
    },
  },
  // ─── Postgres → Postgres migration (move to a new self-hosted PG).
  // Runs from Vercel which has the source (Neon) connection + can
  // reach the target. No dialect translation — both are Postgres. ──
  {
    name: "pg_probe",
    description:
      "Test a target PostgreSQL URL from the server: connect + return version + table count.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "postgresql://… URL" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "pg_init_schema",
    description:
      "Create ALL app tables on the target PostgreSQL (runs ensureSchema against it, verbatim — no translation). Fast on real Postgres. Idempotent.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "pg_migrate_table",
    description:
      "Copy rows from the SOURCE db (app's current Neon DB) into the target PostgreSQL for ONE table. Keyset-paginated by id when present (pass after_id to continue). ON CONFLICT DO NOTHING so re-runs are safe. Run pg_init_schema first.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "target postgresql:// URL" },
        table: { type: "string" },
        after_id: { type: "number" },
        limit: { type: "number", description: "rows/batch (default 1000, max 5000)" },
        truncate: { type: "boolean", description: "TRUNCATE target first (first batch only)" },
      },
      required: ["url", "table"],
      additionalProperties: false,
    },
  },
  {
    name: "pg_counts",
    description:
      "Compare row counts between the SOURCE db and the target PostgreSQL for every table (or one).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        table: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  // ─── TiDB / MySQL migration tools (run from Vercel, which can
  // reach BOTH the current Neon DB and the target TiDB) ───────────
  {
    name: "tidb_probe",
    description:
      "Test connectivity to a target MySQL/TiDB from the server. Pass its mysql:// URL; returns the server version + a table count, or the connection error.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "mysql://user:pass@host:port/db" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "tidb_init_schema",
    description:
      "Create ALL app tables on the target TiDB/MySQL (runs ensureSchema translated to MySQL DDL). Idempotent (CREATE TABLE IF NOT EXISTS). Do this before migrating data.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "target mysql:// URL" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "tidb_exec",
    description:
      "Run one SQL statement against the target TiDB/MySQL URL (for verification, manual DDL fixes, spot-checks). Returns rows or affected-row info.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        sql: { type: "string" },
      },
      required: ["url", "sql"],
      additionalProperties: false,
    },
  },
  {
    name: "db_list_tables",
    description:
      "List the SOURCE database's tables (the DB the app currently uses — Neon during migration) with row counts. Use to plan the migration.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "db_migrate_table",
    description:
      "Copy rows from the SOURCE db (app's current DB) into the target TiDB for ONE table. Keyset-paginated by `id` when present (pass after_id from the previous call's last_id to continue); full-copy otherwise. Uses INSERT IGNORE so re-runs are safe. Call tidb_init_schema first.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "target mysql:// URL" },
        table: { type: "string", description: "table name" },
        after_id: { type: "number", description: "keyset cursor (default 0)" },
        limit: { type: "number", description: "rows per batch (default 500, max 2000)" },
        truncate: { type: "boolean", description: "TRUNCATE the target table first (only pass on the first batch)" },
      },
      required: ["url", "table"],
      additionalProperties: false,
    },
  },
  {
    name: "db_counts",
    description:
      "Compare row counts between the SOURCE db and the target TiDB for every table (or one table). Use to verify a migration is complete.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        table: { type: "string", description: "optional single table" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "group_reanalyze",
    description:
      "Re-run the AI task analyzer on a group RIGHT NOW using the CURRENT forum-topic names + operator-written topic notes, then cache and return the fresh result (overview, stats, tasks). Use this after the operator has renamed topics or added topic descriptions so the analysis reflects them. window_days=0 (default) is all-time. Takes 20-60s for an active group.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: { type: "number", description: "chat_id of the group" },
        window_days: {
          type: "number",
          description: "0 = all-time (default), or 7 / 14 / 30 for a window",
        },
      },
      required: ["group_id"],
      additionalProperties: false,
    },
  },
] as const;

function toolText(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_tables": {
      const r = await runSql(`
        SELECT c.relname AS table,
               c.reltuples::bigint AS est_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`);
      return toolText(r.rows);
    }
    case "describe_table": {
      const table = String(args.table ?? "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error("invalid table name");
      }
      const q = sql() as unknown as {
        query: (t: string, p?: unknown[]) => Promise<unknown[]>;
      };
      const rows = await q.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      return toolText(rows);
    }
    case "query": {
      const text = String(args.sql ?? "");
      assertReadOnly(text);
      const r = await runSql(text);
      return toolText(r);
    }
    case "execute": {
      const text = String(args.sql ?? "");
      if (args.confirm !== true) {
        throw new Error("refused: pass confirm=true to run a write statement");
      }
      const r = await runSql(text);
      return toolText({ rowCount: r.rowCount, returned: r.rows });
    }

    // ─── Curated group tools ─────────────────────────────────────
    case "list_groups": {
      const rows = await runParams(
        `SELECT
           m.chat_id,
           (ARRAY_AGG(m.chat_title ORDER BY m.created_at DESC)
              FILTER (WHERE m.chat_title IS NOT NULL))[1] AS title,
           (ARRAY_AGG(m.chat_type  ORDER BY m.created_at DESC))[1]  AS chat_type,
           COUNT(*)::int                          AS messages,
           COUNT(DISTINCT m.sender_id)::int       AS senders,
           MIN(m.created_at)                      AS first_seen,
           MAX(m.created_at)                      AS last_seen,
           EXISTS (
             SELECT 1 FROM group_analytics g WHERE g.chat_id = m.chat_id
           )                                      AS has_cached_analysis
         FROM messages_log m
         WHERE m.chat_type IN ('group', 'supergroup')
         GROUP BY m.chat_id
         ORDER BY MAX(m.created_at) DESC`,
        [],
      );
      return toolText(rows);
    }

    case "group_overview": {
      const gid = Number(args.group_id);
      if (!Number.isFinite(gid)) throw new Error("group_id required");
      const [summary, topics, topSenders, daily] = await Promise.all([
        runParams(
          `SELECT
             (ARRAY_AGG(chat_title ORDER BY created_at DESC)
                FILTER (WHERE chat_title IS NOT NULL))[1] AS title,
             COUNT(*)::int                    AS messages,
             COUNT(DISTINCT sender_id)::int   AS senders,
             MIN(created_at)                  AS first_seen,
             MAX(created_at)                  AS last_seen
           FROM messages_log WHERE chat_id = $1`,
          [gid],
        ),
        runParams(
          `SELECT
             COALESCE(ft.name, CASE WHEN m.message_thread_id IS NULL
               THEN 'General' ELSE 'Topic #' || m.message_thread_id END) AS topic,
             COUNT(*)::int AS messages,
             COUNT(DISTINCT m.sender_id)::int AS senders
           FROM messages_log m
           LEFT JOIN forum_topics ft
             ON ft.chat_id = m.chat_id
            AND ft.message_thread_id = m.message_thread_id
           WHERE m.chat_id = $1
           GROUP BY 1
           ORDER BY messages DESC`,
          [gid],
        ),
        runParams(
          `SELECT
             sender_id,
             (ARRAY_AGG(sender_name ORDER BY created_at DESC)
                FILTER (WHERE sender_name IS NOT NULL))[1] AS name,
             (ARRAY_AGG(sender_username ORDER BY created_at DESC)
                FILTER (WHERE sender_username IS NOT NULL))[1] AS username,
             COUNT(*)::int AS messages
           FROM messages_log
           WHERE chat_id = $1 AND sender_id IS NOT NULL
             AND COALESCE(from_owner, FALSE) = FALSE
           GROUP BY sender_id
           ORDER BY messages DESC
           LIMIT 15`,
          [gid],
        ),
        runParams(
          `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                  COUNT(*)::int AS messages
           FROM messages_log
           WHERE chat_id = $1 AND created_at > NOW() - INTERVAL '30 days'
           GROUP BY 1 ORDER BY 1`,
          [gid],
        ),
      ]);
      return toolText({
        summary: summary[0] ?? null,
        topics,
        top_senders: topSenders,
        daily_last_30d: daily,
      });
    }

    case "group_tasks": {
      const gid = Number(args.group_id);
      if (!Number.isFinite(gid)) throw new Error("group_id required");
      const windowDays =
        args.window_days != null ? Number(args.window_days) : null;
      const rows =
        windowDays != null
          ? await runParams(
              `SELECT chat_title, window_days, since_iso, message_count,
                      analysis, created_at
               FROM group_analytics
               WHERE chat_id = $1 AND window_days = $2 LIMIT 1`,
              [gid, windowDays],
            )
          : await runParams(
              `SELECT chat_title, window_days, since_iso, message_count,
                      analysis, created_at
               FROM group_analytics
               WHERE chat_id = $1
               ORDER BY message_count DESC LIMIT 1`,
              [gid],
            );
      if (rows.length === 0) {
        return toolText({
          cached: false,
          note: "No cached analysis for this group. Open the group's analytics page in the dashboard once (or hit «🔁 تحلیل روی این پیام‌ها») to build it.",
        });
      }
      const r = rows[0] as Record<string, unknown>;
      // analysis is jsonb — already an object from neon.
      const analysis = r.analysis as
        | { overview?: string; stats?: unknown; tasks?: unknown[] }
        | null;
      return toolText({
        cached: true,
        chat_title: r.chat_title,
        window_days: r.window_days,
        since: r.since_iso,
        message_count: r.message_count,
        computed_at: r.created_at,
        overview: analysis?.overview ?? "",
        stats: analysis?.stats ?? null,
        tasks: analysis?.tasks ?? [],
      });
    }

    case "group_topic_messages": {
      const gid = Number(args.group_id);
      if (!Number.isFinite(gid)) throw new Error("group_id required");
      const topic =
        typeof args.topic === "string" && args.topic.trim()
          ? args.topic.trim()
          : null;
      const limit = Math.min(
        Math.max(Number(args.limit ?? 200) || 200, 1),
        500,
      );
      const rows = await runParams(
        `SELECT m.created_at, m.sender_name, m.sender_username,
                m.from_owner,
                COALESCE(ft.name, CASE WHEN m.message_thread_id IS NULL
                  THEN 'General' ELSE 'Topic #' || m.message_thread_id END) AS topic,
                COALESCE(NULLIF(m.message_text, ''),
                         '[' || COALESCE(m.media_kind, 'media') || ']') AS text
         FROM messages_log m
         LEFT JOIN forum_topics ft
           ON ft.chat_id = m.chat_id
          AND ft.message_thread_id = m.message_thread_id
         WHERE m.chat_id = $1
           AND ($2::text IS NULL OR COALESCE(ft.name,
                CASE WHEN m.message_thread_id IS NULL THEN 'General'
                     ELSE 'Topic #' || m.message_thread_id END) = $2)
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [gid, topic, limit],
      );
      return toolText({ count: rows.length, messages: rows });
    }

    case "group_members": {
      const gid = Number(args.group_id);
      if (!Number.isFinite(gid)) throw new Error("group_id required");
      const rows = await runParams(
        `WITH senders AS (
           SELECT sender_id::bigint AS user_id,
             (ARRAY_AGG(sender_name ORDER BY created_at DESC)
                FILTER (WHERE sender_name IS NOT NULL))[1] AS name,
             (ARRAY_AGG(sender_username ORDER BY created_at DESC)
                FILTER (WHERE sender_username IS NOT NULL))[1] AS username,
             COUNT(*)::int AS msg_count,
             MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
           FROM messages_log
           WHERE chat_id = $1 AND sender_id IS NOT NULL
             AND COALESCE(from_owner, FALSE) = FALSE
           GROUP BY sender_id
         ),
         members AS (
           SELECT user_id, first_name, last_name, username, is_bot,
                  is_premium, status, first_seen_at, last_seen_at
           FROM chat_members WHERE chat_id = $1
         )
         SELECT
           COALESCE(s.user_id, m.user_id) AS user_id,
           COALESCE(s.name, NULLIF(TRIM(CONCAT(COALESCE(m.first_name,''),' ',
             COALESCE(m.last_name,''))), '')) AS name,
           COALESCE(s.username, m.username) AS username,
           m.status, COALESCE(m.is_bot, FALSE) AS is_bot,
           COALESCE(m.is_premium, FALSE) AS is_premium,
           COALESCE(s.msg_count, 0) AS messages
         FROM senders s
         FULL OUTER JOIN members m ON m.user_id = s.user_id
         ORDER BY messages DESC NULLS LAST`,
        [gid],
      );
      return toolText({ count: rows.length, members: rows });
    }

    case "send_message": {
      // chat_id may be a numeric id OR an "@username" string (only
      // resolvable when sending via a business connection / public peer).
      const rawCid = args.chat_id as unknown;
      const chatTarget =
        typeof rawCid === "string" && rawCid.trim().startsWith("@")
          ? rawCid.trim()
          : Number(rawCid);
      if (
        chatTarget === "" ||
        (typeof chatTarget === "number" && !Number.isFinite(chatTarget))
      ) {
        throw new Error("chat_id required (number or @username)");
      }
      const text = String(args.text ?? "");
      if (!text.trim()) throw new Error("text required");
      const pm = String(args.parse_mode ?? "HTML");
      const body: Record<string, unknown> = {
        chat_id: chatTarget,
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
      };
      if (pm !== "none") body.parse_mode = pm;
      if (args.message_thread_id != null) {
        body.message_thread_id = Number(args.message_thread_id);
      }
      if (args.business_connection_id) {
        body.business_connection_id = String(args.business_connection_id);
      }
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const j = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!j.ok) throw new Error(`telegram: ${j.description ?? "send failed"}`);
      return toolText({ ok: true, message_id: j.result?.message_id });
    }

    case "send_photo": {
      const chatId = Number(args.chat_id);
      if (!Number.isFinite(chatId)) throw new Error("chat_id required");
      const photo = String(args.photo_url ?? "");
      if (!photo) throw new Error("photo_url required");
      const body: Record<string, unknown> = { chat_id: chatId, photo };
      if (args.caption) {
        body.caption = String(args.caption).slice(0, 1024);
        body.parse_mode = "HTML";
      }
      if (args.message_thread_id != null) {
        body.message_thread_id = Number(args.message_thread_id);
      }
      if (args.business_connection_id) {
        body.business_connection_id = String(args.business_connection_id);
      }
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const j = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!j.ok) throw new Error(`telegram: ${j.description ?? "send failed"}`);
      return toolText({ ok: true, message_id: j.result?.message_id });
    }

    case "delete_message": {
      const chatId = Number(args.chat_id);
      const messageId = Number(args.message_id);
      if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
        throw new Error("chat_id and message_id required");
      }
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/deleteMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        },
      );
      const j = (await res.json()) as { ok: boolean; description?: string };
      return toolText({ ok: j.ok, error: j.description });
    }

    case "find_chat": {
      const nm = String(args.name ?? "").trim();
      if (!nm) throw new Error("name required");
      const like = `%${nm}%`;
      const rows = await runParams(
        `SELECT chat_id,
                (ARRAY_AGG(chat_type ORDER BY created_at DESC))[1] AS chat_type,
                (ARRAY_AGG(COALESCE(chat_title, sender_name) ORDER BY created_at DESC))[1] AS name,
                (ARRAY_AGG(business_connection_id ORDER BY created_at DESC)
                   FILTER (WHERE business_connection_id IS NOT NULL))[1] AS business_connection_id,
                COUNT(*)::int AS messages,
                MIN(created_at) AS first_seen,
                MAX(created_at) AS last_seen
         FROM messages_log
         WHERE chat_title ILIKE $1 OR sender_name ILIKE $1
         GROUP BY chat_id
         ORDER BY MAX(created_at) DESC
         LIMIT 25`,
        [like],
      );
      return toolText(rows);
    }

    case "chat_messages": {
      const cid = Number(args.chat_id);
      if (!Number.isFinite(cid)) throw new Error("chat_id required");
      const limit = Math.min(Math.max(Number(args.limit ?? 30) || 30, 1), 300);
      const asc = String(args.order ?? "desc").toLowerCase() === "asc";
      const rows = await runParams(
        `SELECT created_at, from_owner, sender_name,
                COALESCE(NULLIF(message_text, ''), transcript,
                  '[' || COALESCE(media_kind, 'media') || ']') AS text
         FROM messages_log
         WHERE chat_id = $1
         ORDER BY created_at ${asc ? "ASC" : "DESC"}
         LIMIT $2`,
        [cid, limit],
      );
      return toolText({ count: rows.length, messages: rows });
    }

    case "send_chart": {
      const cid = Number(args.chat_id);
      if (!Number.isFinite(cid)) throw new Error("chat_id required");
      const chart = args.chart;
      if (!chart || typeof chart !== "object") {
        throw new Error("chart (Chart.js config object) required");
      }
      const url =
        "https://quickchart.io/chart?w=640&h=400&c=" +
        encodeURIComponent(JSON.stringify(chart));
      const body: Record<string, unknown> = { chat_id: cid, photo: url };
      if (args.caption) {
        body.caption = String(args.caption).slice(0, 1024);
        body.parse_mode = "HTML";
      }
      if (args.business_connection_id) {
        body.business_connection_id = String(args.business_connection_id);
      }
      if (args.message_thread_id != null) {
        body.message_thread_id = Number(args.message_thread_id);
      }
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const j = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!j.ok) throw new Error(`telegram: ${j.description ?? "send failed"}`);
      return toolText({ ok: true, message_id: j.result?.message_id });
    }

    case "site_probe": {
      const m = {
        id: 0,
        name: "probe",
        loginUrl: String(args.login_url ?? ""),
        checkUrl: String(args.check_url ?? ""),
        username: args.username ? String(args.username) : null,
        password: args.password ? String(args.password) : null,
        usernameField: args.username_field ? String(args.username_field) : "username",
        passwordField: args.password_field ? String(args.password_field) : "password",
        extraFieldsJson: args.extra_fields_json ? String(args.extra_fields_json) : null,
      } as unknown as SiteMonitor;
      const page = await fetchMonitoredPage(m);
      const analysis =
        page.status === "ok"
          ? await analyzeSiteChange({ monitorName: "probe", url: m.checkUrl, text: page.text })
          : null;
      return toolText({
        status: page.status,
        error: page.error,
        loginInfo: page.loginInfo,
        textLength: page.text.length,
        textPreview: page.text.slice(0, 1800),
        analysis,
      });
    }

    case "pg_probe": {
      const pool = await getPgPool(String(args.url ?? ""));
      const ver = await pool.query("SELECT version() AS v");
      const t = await pool.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
      );
      return toolText({ ok: true, version: ver.rows[0]?.v, tables: t.rows[0]?.n ?? 0 });
    }

    case "pg_init_schema": {
      const client = makePgClient(String(args.url ?? "")) as unknown as NeonQueryFunction<false, false>;
      await ensureSchema(client);
      const pool = await getPgPool(String(args.url ?? ""));
      const t = await pool.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
      );
      return toolText({ ok: true, tables: t.rows[0]?.n ?? 0 });
    }

    case "pg_migrate_table": {
      const targetUrl = String(args.url ?? "");
      const table = String(args.table ?? "");
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("invalid table name");
      const limit = Math.min(Math.max(Number(args.limit ?? 1000) || 1000, 1), 5000);
      const afterId = Number(args.after_id ?? 0) || 0;
      const src = sql() as unknown as {
        query: (t: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
      };
      const target = await getPgPool(targetUrl);

      if (args.truncate === true) {
        await target.query(`TRUNCATE TABLE "${table}" CASCADE`).catch(() => {});
      }
      const colRows = await src.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [table],
      );
      const cols = colRows.map((r) => String(r.column_name));
      if (cols.length === 0) throw new Error("table not found in source");
      const hasId = cols.includes("id");
      const rows = hasId
        ? await src.query(`SELECT * FROM "${table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`, [afterId, limit])
        : await src.query(`SELECT * FROM "${table}"`);
      if (rows.length === 0) {
        return toolText({ ok: true, table, copied: 0, done: true, last_id: afterId });
      }
      // Multi-row INSERT with $-placeholders. jsonb/objects → keep as-is
      // (pg serialises objects to json); Date/primitives pass through.
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const params: unknown[] = [];
      const tuples = rows.map((r) => {
        const ph = cols.map((c) => {
          const v = r[c];
          params.push(v != null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);
          return `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      });
      await target.query(
        `INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
        params,
      );
      const lastId = hasId ? Number(rows[rows.length - 1]!.id) : afterId;
      return toolText({ ok: true, table, copied: rows.length, last_id: lastId, done: hasId ? rows.length < limit : true });
    }

    case "pg_counts": {
      const target = await getPgPool(String(args.url ?? ""));
      const one = args.table ? String(args.table) : null;
      const tables = one
        ? [one]
        : (
            await runSql(`SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)
          ).rows.map((r) => String((r as { table: string }).table));
      const src = sql() as unknown as {
        query: (t: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
      };
      const out: Array<Record<string, unknown>> = [];
      for (const table of tables) {
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
        let s: number | string = "?", d: number | string = "?";
        try { s = Number((await src.query(`SELECT COUNT(*)::int AS n FROM "${table}"`))[0]?.n ?? 0); } catch { s = "err"; }
        try { d = Number((await target.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0]?.n ?? 0); } catch { d = "missing"; }
        out.push({ table, source: s, target: d, match: s === d });
      }
      return toolText(out);
    }

    case "tidb_probe": {
      const pool = await getPool(String(args.url ?? ""));
      const [ver] = await pool.query("SELECT VERSION() AS v");
      const [tbls] = await pool.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()",
      );
      return toolText({
        ok: true,
        version: (ver as { v?: string }[])[0]?.v,
        tables: (tbls as { n?: number }[])[0]?.n ?? 0,
      });
    }

    case "tidb_init_schema": {
      const url = String(args.url ?? "");
      // Collect the whole translated schema first (no DB round-trips),
      // then run it in a few batched multi-statement queries — far
      // fewer round-trips than executing ~150 statements one-by-one
      // (which times the function out + leaks connections on a small
      // TiDB).
      const stmts: string[] = [];
      const capture = makeCaptureClient(stmts) as unknown as NeonQueryFunction<false, false>;
      await ensureSchema(capture);
      // `ALTER … DROP NOT NULL` needs a runtime type lookup + MODIFY —
      // pull those out and run them separately after the batches.
      const dropNN = stmts.filter((s) => /DROP\s+NOT\s+NULL/i.test(s));
      const ddl = stmts.filter((s) => !/DROP\s+NOT\s+NULL/i.test(s));

      const mysql = await import("mysql2/promise");
      const conn = await mysql.createConnection({
        uri: url,
        multipleStatements: true,
        ssl: /sslmode=disable|ssl=false/i.test(url)
          ? undefined
          : { rejectUnauthorized: false },
      });
      let ran = 0;
      let firstError: string | null = null;
      const BATCH = 15;
      try {
        for (let i = 0; i < ddl.length; i += BATCH) {
          const chunk = ddl
            .slice(i, i + BATCH)
            .map((s) => s.replace(/;+\s*$/, ""))
            .join(";\n");
          try {
            await conn.query(chunk);
            ran += Math.min(BATCH, ddl.length - i);
          } catch (e) {
            // Fall back to statement-by-statement for this chunk so one
            // bad statement doesn't drop 15.
            for (const s of ddl.slice(i, i + BATCH)) {
              try {
                await conn.query(s.replace(/;+\s*$/, ""));
                ran++;
              } catch (e2) {
                if (!firstError)
                  firstError = `${e2 instanceof Error ? e2.message : e2} :: ${s.slice(0, 120)}`;
              }
            }
          }
        }
      } finally {
        await conn.end().catch(() => {});
      }
      // DROP NOT NULL via the runtime handler (type lookup + MODIFY).
      const m = makeMysqlClient(url);
      for (const s of dropNN) {
        await (m as unknown as { query: (t: string) => Promise<unknown> })
          .query(s)
          .catch((e: unknown) => {
            if (!firstError) firstError = `${e} :: ${s.slice(0, 80)}`;
          });
      }
      const pool = await getPool(url);
      const [tbls] = await pool.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()",
      );
      return toolText({
        ok: !firstError,
        statements: stmts.length,
        ran,
        tables: (tbls as { n?: number }[])[0]?.n ?? 0,
        firstError,
      });
    }

    case "tidb_exec": {
      const pool = await getPool(String(args.url ?? ""));
      const [result] = await pool.query(String(args.sql ?? ""));
      if (Array.isArray(result)) {
        return toolText({ ok: true, rowCount: result.length, rows: (result as unknown[]).slice(0, 200) });
      }
      return toolText({ ok: true, result });
    }

    case "db_list_tables": {
      const rows = await runSql(`
        SELECT c.relname AS table, c.reltuples::bigint AS est_rows
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`);
      return toolText(rows.rows);
    }

    case "db_migrate_table": {
      const targetUrl = String(args.url ?? "");
      const table = String(args.table ?? "");
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("invalid table name");
      const limit = Math.min(Math.max(Number(args.limit ?? 500) || 500, 1), 2000);
      const afterId = Number(args.after_id ?? 0) || 0;
      const src = sql() as unknown as {
        query: (t: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
      };
      const target = await getPool(targetUrl);

      if (args.truncate === true) {
        await target.query(`TRUNCATE TABLE \`${table}\``).catch(async () => {
          await target.query(`DELETE FROM \`${table}\``);
        });
      }

      // Does the source table have an `id` column? (keyset pagination)
      const colRows = await src.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [table],
      );
      const cols = colRows.map((r) => String(r.column_name));
      if (cols.length === 0) throw new Error("table not found in source");
      const hasId = cols.includes("id");

      const rows = hasId
        ? await src.query(
            `SELECT * FROM "${table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`,
            [afterId, limit],
          )
        : await src.query(`SELECT * FROM "${table}"`);

      if (rows.length === 0) {
        return toolText({ ok: true, table, copied: 0, done: true, last_id: afterId });
      }

      // Coerce PG values → MySQL-friendly (Date stays; objects → JSON
      // string; everything else as-is).
      const coerce = (v: unknown): unknown => {
        if (v == null) return null;
        if (v instanceof Date) return v;
        if (typeof v === "object") return JSON.stringify(v);
        return v;
      };
      const colList = cols.map((c) => `\`${c}\``).join(", ");
      const tuples = rows.map((r) => cols.map((c) => coerce(r[c])));
      await target.query(
        `INSERT IGNORE INTO \`${table}\` (${colList}) VALUES ?`,
        [tuples],
      );
      const lastId = hasId ? Number(rows[rows.length - 1]!.id) : afterId;
      return toolText({
        ok: true,
        table,
        copied: rows.length,
        last_id: lastId,
        done: hasId ? rows.length < limit : true,
      });
    }

    case "db_counts": {
      const targetUrl = String(args.url ?? "");
      const target = await getPool(targetUrl);
      const one = args.table ? String(args.table) : null;
      const tableRows = one
        ? [{ table: one }]
        : (
            await runSql(`
              SELECT c.relname AS table FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)
          ).rows.map((r) => ({ table: String((r as { table: string }).table) }));
      const src = sql() as unknown as {
        query: (t: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
      };
      const out: Array<Record<string, unknown>> = [];
      for (const { table } of tableRows) {
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
        let srcN: number | string = "?";
        let tgtN: number | string = "?";
        try {
          srcN = Number((await src.query(`SELECT COUNT(*) AS n FROM "${table}"`))[0]?.n ?? 0);
        } catch (e) { srcN = "err"; }
        try {
          const [tr] = await target.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
          tgtN = Number((tr as { n?: number }[])[0]?.n ?? 0);
        } catch (e) { tgtN = "missing"; }
        out.push({ table, source: srcN, tidb: tgtN, match: srcN === tgtN });
      }
      return toolText(out);
    }

    case "group_reanalyze": {
      const gid = Number(args.group_id);
      if (!Number.isFinite(gid)) throw new Error("group_id required");
      const allTime =
        args.window_days == null || Number(args.window_days) === 0;
      const days = allTime
        ? 0
        : Math.min(Math.max(Number(args.window_days), 1), 90);
      const since = allTime
        ? new Date(0)
        : new Date(Date.now() - days * 86400_000);
      const { chatTitle, messages } = await listChatMessagesForAnalysis({
        chatId: gid,
        since,
        limit: allTime ? 5000 : 1500,
      });
      if (messages.length === 0) {
        return toolText({ ok: false, note: "no messages in this window" });
      }
      const settings = await getSettings();
      const rule = await getChatRule(gid).catch(() => null);
      // Current topic names + operator notes — this is the whole point:
      // pick up renames + descriptions the operator just made.
      const topics = await listForumTopics(gid).catch(() => []);
      const nameByThread = new Map<number, string>();
      for (const t of topics) {
        nameByThread.set(
          t.messageThreadId,
          t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
        );
      }
      const messagesWithTopics = messages.map((m) => ({
        sender: m.fromOwner
          ? settings.ownerDisplayName || settings.ownerName || "owner"
          : m.sender,
        text: m.text,
        at: m.at,
        topicName:
          m.messageThreadId == null
            ? null
            : nameByThread.get(m.messageThreadId) ??
              `Topic #${m.messageThreadId}`,
      }));
      const analysis = await analyzeGroupTasksV2({
        chatId: gid,
        chatTitle,
        ownerName: settings.ownerName,
        ownerContext: settings.ownerContext,
        chatNotes: rule?.notes ?? null,
        topics:
          topics.length > 0
            ? topics.map((t) => ({
                name:
                  t.name && t.name.trim()
                    ? t.name
                    : `Topic #${t.messageThreadId}`,
                messageThreadId: t.messageThreadId,
                notes: t.notes,
              }))
            : undefined,
        messages: messagesWithTopics,
      });
      await upsertGroupAnalytics({
        chatId: gid,
        chatTitle,
        windowDays: days,
        sinceIso: since.toISOString(),
        messageCount: messages.length,
        analysis,
      }).catch(() => {});
      return toolText({
        ok: true,
        recomputed: true,
        message_count: messages.length,
        topics_used: topics.map((t) => ({
          name:
            t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
          has_note: Boolean(t.notes && t.notes.trim()),
        })),
        overview: analysis.overview,
        stats: analysis.stats,
        tasks: analysis.tasks,
      });
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function authorized(request: Request): boolean {
  const secret = config.mcpSecret;
  if (!secret) return false; // hard-disabled until MCP_SECRET is set
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m != null && m[1] === secret;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "unauthorized" },
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  let msg: JsonRpcReq;
  try {
    msg = (await request.json()) as JsonRpcReq;
  } catch {
    return err(null, -32700, "parse error");
  }

  // Notifications (no id) — acknowledge with 202, no body.
  if (msg.id === undefined || msg.id === null) {
    if (typeof msg.method === "string" && msg.method.startsWith("notifications/")) {
      return new Response(null, { status: 202 });
    }
  }

  try {
    switch (msg.method) {
      case "initialize":
        return ok(msg.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            "Postgres data for the Telegram secretary bot. Use list_tables → describe_table → query to explore. Key tables: messages_log, chat_rules, chat_members, forum_topics, group_analytics, ai_usage, note_watch_items, sms_webhooks.",
        });
      case "ping":
        return ok(msg.id, {});
      case "tools/list":
        return ok(msg.id, { tools: TOOLS });
      case "tools/call": {
        const params = msg.params ?? {};
        const name = String(params.name ?? "");
        const args = (params.arguments as Record<string, unknown>) ?? {};
        try {
          const result = await callTool(name, args);
          return ok(msg.id, result);
        } catch (e) {
          // Tool errors are reported inside the result with isError so
          // the model can see + react to them (per MCP spec) rather
          // than as a protocol-level error.
          return ok(msg.id, {
            isError: true,
            content: [
              {
                type: "text",
                text: e instanceof Error ? e.message : String(e),
              },
            ],
          });
        }
      }
      default:
        return err(msg.id, -32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    return err(msg.id, -32603, e instanceof Error ? e.message : String(e));
  }
}

// Some clients probe GET before establishing the stream. We don't run
// an SSE channel (stateless request/response only) so we return 405
// with Allow: POST, which compliant Streamable-HTTP clients accept.
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({ error: "method not allowed — POST JSON-RPC only" }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
}
