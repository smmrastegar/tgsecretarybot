import { config } from "@/lib/config";
import {
  getChatRule,
  hasDb,
  listChatMessagesForAnalysis,
  listForumTopics,
  sql,
  upsertGroupAnalytics,
} from "@/lib/db";
import { analyzeGroupTasksV2 } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
