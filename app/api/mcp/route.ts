import { timingSafeEqual } from "crypto";
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
    name: "rule_test",
    description:
      "Run a message rule's LLM matcher against the most recent N non-owner messages and return which ones match — the same classifier the live pipeline uses (honours positive examples, counter-examples, and the rule description). Use to verify a rule isn't over/under-matching after editing it.",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "number", description: "id of the message rule" },
        limit: {
          type: "number",
          description: "how many recent messages to test (default 30, max 100)",
        },
        texts: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional explicit message texts to classify instead of recent messages — use for a held-out test set.",
        },
      },
      required: ["rule_id"],
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
    name: "chat_history",
    description:
      "Search and page through the FULL stored history of one chat. Unlike chat_messages (newest 300 only) this supports a date range, a text search, a topic filter and an offset, so you can walk back through everything that was ever logged. Returns total_matching so you know how much is left.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: "number",
          description: "Chat to read (group is negative).",
        },
        search: {
          type: "string",
          description:
            "Optional case-insensitive substring to match in the message text / transcript.",
        },
        sender: {
          type: "string",
          description: "Optional case-insensitive sender-name filter.",
        },
        after: {
          type: "string",
          description: "Optional ISO date/时间 lower bound, e.g. '2026-07-01'.",
        },
        before: {
          type: "string",
          description: "Optional ISO date/time upper bound, e.g. '2026-08-01'.",
        },
        message_thread_id: {
          type: "number",
          description: "Optional forum topic id to restrict to one topic.",
        },
        limit: {
          type: "number",
          description: "Max messages to return (default 100, max 500).",
        },
        offset: {
          type: "number",
          description: "Skip this many matches — use with limit to page.",
        },
        order: {
          type: "string",
          description: "'asc' (oldest first, default) or 'desc'.",
        },
      },
      required: ["chat_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_forum_topic",
    description:
      "Create a new forum topic in a supergroup that has topics enabled. Returns the new message_thread_id, which you then pass as message_thread_id to send_message to post inside it.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: ["number", "string"],
          description: "Target supergroup chat_id (negative).",
        },
        name: { type: "string", description: "Topic title." },
        icon_color: {
          type: "number",
          description:
            "Optional colour as an RGB int (e.g. 7322096 blue, 16766590 yellow, 13338331 purple, 9367192 green, 16749490 pink, 16478047 red).",
        },
      },
      required: ["chat_id", "name"],
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
    name: "resend_message",
    description:
      "Re-send a message that's already stored in messages_log INTO another chat, AS THE BOT, by its file_id. Handles every media kind (photo/video/animation/voice/audio/document/video_note) plus plain text, using the stored media_file_id + message_text as the caption. Use it to hand-test the channel-mirror pipeline or to backfill posts a mirror missed. Look up source_message_id via chat_messages/query first.",
    inputSchema: {
      type: "object",
      properties: {
        source_message_id: {
          type: "number",
          description: "message_id of the stored row to re-send",
        },
        source_chat_id: {
          type: "number",
          description:
            "Optional chat_id to disambiguate when the same message_id exists in several chats.",
        },
        chat_id: { type: "number", description: "Target chat_id to send into" },
        message_thread_id: {
          type: "number",
          description: "Optional forum topic thread id in the target",
        },
      },
      required: ["source_message_id", "chat_id"],
      additionalProperties: false,
    },
  },
  {
    name: "transcribe_voice",
    description:
      "Transcribe a stored voice / audio / video-note message to text (Groq Whisper, falls back to OpenRouter). Pass source_message_id (its media_file_id is looked up) or a raw file_id. Returns the transcript and caches it back into media_description. Use to read voice messages the bot didn't auto-transcribe.",
    inputSchema: {
      type: "object",
      properties: {
        source_message_id: {
          type: "number",
          description: "message_id of the stored voice/audio to transcribe",
        },
        source_chat_id: {
          type: "number",
          description: "Optional chat_id to disambiguate the source row",
        },
        file_id: {
          type: "string",
          description: "Raw Telegram file_id (alternative to source_message_id)",
        },
        language: {
          type: "string",
          description: "Optional ISO language hint (e.g. 'fa'); defaults to the sttLanguage setting",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "bot_chat_status",
    description:
      "Diagnostic: is the bot a member/admin of a given chat, and can it post there? Calls Telegram getChat + getChatMember(bot). Use to explain why a channel-mirror source (or destination) isn't working — a bot only receives channel_post updates when it's an ADMIN of that channel.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: "number",
          description: "The chat_id to check (e.g. a channel id)",
        },
      },
      required: ["chat_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_album",
    description:
      "Re-send several stored messages as ONE grouped media album (Telegram sendMediaGroup), by their file_ids — the way a native photo/video album looks. Preserves the order of source_message_ids; the caption is taken from the first item that has real text. Auto-chunks into groups of 10 (Telegram's album limit). Use to mirror an album exactly instead of separate photos.",
    inputSchema: {
      type: "object",
      properties: {
        source_message_ids: {
          type: "array",
          items: { type: "number" },
          description: "Ordered message_ids of the album parts to re-send",
        },
        source_chat_id: {
          type: "number",
          description: "Optional chat_id to disambiguate the source rows",
        },
        chat_id: { type: "number", description: "Target chat_id to send into" },
        message_thread_id: {
          type: "number",
          description: "Optional forum topic thread id in the target",
        },
      },
      required: ["source_message_ids", "chat_id"],
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

// --- Secret redaction for raw SQL results (defense in depth) ---
// The MCP caller already holds MCP_SECRET, but query results get pasted
// into chats / logs / AI contexts. Mask credential-bearing values so a
// leaked transcript can't leak live keys.
//
//  1. settings-table rows: {key, value} where key is a known-sensitive
//     setting → value masked.
//  2. any column whose NAME smells like a credential (token / secret /
//     password / api_key) → masked.
//  3. any string containing one of the process-level secrets (bot
//     token, API keys, DB URL) → that substring masked.
const SENSITIVE_SETTING_KEYS = new Set([
  "resendApiKey",
  "resendInboundSecret",
  "smsWebhookSecret",
  "hikerApiKeyOverride",
  "monitorExternalSecret",
  "alertWebhookHeaders",
]);
const CREDENTIAL_COL_RX = /(secret|token|password|passwd|api_?key|credential)/i;

function maskValue(v: string): string {
  if (v.length <= 6) return "•••";
  return `${v.slice(0, 3)}…${v.slice(-2)} (masked)`;
}

function processSecrets(): string[] {
  return [
    config.telegramBotToken,
    config.openrouterApiKey,
    config.groqApiKey,
    config.hikerApiKey,
    config.mcpSecret,
    config.cronSecret,
    config.webhookSecretToken,
    config.databaseUrl,
  ].filter((s): s is string => typeof s === "string" && s.length >= 8);
}

function redactDeep(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(redactDeep);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const isSettingRow =
      typeof obj.key === "string" && SENSITIVE_SETTING_KEYS.has(obj.key);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v.length > 0) {
        if ((isSettingRow && k === "value") || CREDENTIAL_COL_RX.test(k)) {
          out[k] = maskValue(v);
          continue;
        }
        let s = v;
        for (const secret of processSecrets()) {
          if (s.includes(secret)) s = s.split(secret).join("•••secret•••");
        }
        out[k] = s;
        continue;
      }
      out[k] = redactDeep(v);
    }
    return out;
  }
  return node;
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
      return toolText(redactDeep(r));
    }
    case "execute": {
      const text = String(args.sql ?? "");
      if (args.confirm !== true) {
        throw new Error("refused: pass confirm=true to run a write statement");
      }
      const r = await runSql(text);
      return toolText({ rowCount: r.rowCount, returned: redactDeep(r.rows) });
    }
    case "rule_test": {
      const ruleId = Number(args.rule_id);
      if (!Number.isFinite(ruleId)) throw new Error("rule_id required");
      const lim = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      const { getMessageRule, listRecentMessagesForTest, listRuleExamples } =
        await import("@/lib/db");
      const { batchTestRule } = await import("@/lib/rules");
      const rule = await getMessageRule(ruleId);
      if (!rule) throw new Error(`rule ${ruleId} not found`);
      const explicitTexts = Array.isArray(args.texts)
        ? (args.texts as unknown[]).map((t) => String(t)).filter((t) => t.trim())
        : null;
      const [recent, examples, negatives] = await Promise.all([
        explicitTexts ? Promise.resolve([]) : listRecentMessagesForTest(lim),
        listRuleExamples(ruleId),
        listRuleExamples(ruleId, "negative_match"),
      ]);
      const messages =
        explicitTexts && explicitTexts.length
          ? explicitTexts.map((t, i) => ({
              id: -(i + 1),
              chatId: 0,
              chatTitle: null,
              senderName: "test",
              messageText: t,
              createdAt: new Date(0),
            }))
          : recent;
      const flags = await batchTestRule({
        rule,
        examples,
        negatives,
        messages: messages.map((m) => ({
          id: m.id,
          text: m.messageText,
          sender: m.senderName,
        })),
      });
      const results = messages.map((m, i) => ({
        matched: flags[i] ?? false,
        sender: m.senderName,
        chatId: m.chatId,
        text: m.messageText.slice(0, 160).replace(/\s+/g, " "),
      }));
      return toolText({
        rule: { id: rule.id, name: rule.name, description: rule.description },
        counts: {
          tested: results.length,
          matched: results.filter((r) => r.matched).length,
          positives: examples.length,
          negatives: negatives.length,
        },
        matched: results.filter((r) => r.matched),
        not_matched: results.filter((r) => !r.matched),
      });
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

    case "chat_history": {
      const cid = Number(args.chat_id);
      if (!Number.isFinite(cid)) throw new Error("chat_id required");
      const limit = Math.min(Math.max(Number(args.limit ?? 100) || 100, 1), 500);
      const offset = Math.max(Number(args.offset ?? 0) || 0, 0);
      const asc = String(args.order ?? "asc").toLowerCase() !== "desc";
      // Build the filter once and reuse it for both the page and the
      // total, so `total_matching` always describes the same query.
      const where: string[] = ["chat_id = $1"];
      const params: unknown[] = [cid];
      const add = (sql: string, val: unknown) => {
        params.push(val);
        where.push(sql.replace("$?", `$${params.length}`));
      };
      if (args.search != null && String(args.search).trim()) {
        add(
          "(COALESCE(message_text,'') || ' ' || COALESCE(transcript,'')) ILIKE $?",
          `%${String(args.search).trim()}%`,
        );
      }
      if (args.sender != null && String(args.sender).trim()) {
        add("sender_name ILIKE $?", `%${String(args.sender).trim()}%`);
      }
      if (args.after != null && String(args.after).trim()) {
        add("created_at >= $?::timestamptz", String(args.after).trim());
      }
      if (args.before != null && String(args.before).trim()) {
        add("created_at <= $?::timestamptz", String(args.before).trim());
      }
      if (args.message_thread_id != null) {
        add("message_thread_id = $?", Number(args.message_thread_id));
      }
      const filter = where.join(" AND ");
      const totalRows = await runParams(
        `SELECT COUNT(*)::int AS n FROM messages_log WHERE ${filter}`,
        params,
      );
      const total = Number(
        (totalRows[0] as { n?: number } | undefined)?.n ?? 0,
      );
      const rows = await runParams(
        `SELECT created_at, from_owner, sender_name, message_thread_id,
                COALESCE(NULLIF(message_text, ''), transcript,
                  '[' || COALESCE(media_kind, 'media') || ']') AS text
           FROM messages_log
          WHERE ${filter}
          ORDER BY created_at ${asc ? "ASC" : "DESC"}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return toolText({
        total_matching: total,
        returned: rows.length,
        offset,
        has_more: offset + rows.length < total,
        messages: rows,
      });
    }

    case "create_forum_topic": {
      const chatId = args.chat_id as number | string;
      const topicName = String(args.name ?? "").trim();
      if (!chatId || !topicName) throw new Error("chat_id and name required");
      const body: Record<string, unknown> = {
        chat_id: chatId,
        name: topicName.slice(0, 128),
      };
      if (args.icon_color != null) body.icon_color = Number(args.icon_color);
      const r = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/createForumTopic`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const j = (await r.json()) as {
        ok: boolean;
        description?: string;
        result?: { message_thread_id: number; name: string };
      };
      if (!j.ok) throw new Error(j.description ?? "createForumTopic failed");
      return toolText({
        ok: true,
        message_thread_id: j.result?.message_thread_id,
        name: j.result?.name,
      });
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

    case "resend_message": {
      const targetChat = Number(args.chat_id);
      const srcMsgId = Number(args.source_message_id);
      if (!Number.isFinite(targetChat) || !Number.isFinite(srcMsgId)) {
        throw new Error("chat_id and source_message_id required");
      }
      const srcChat = args.source_chat_id != null ? Number(args.source_chat_id) : null;
      const rows = (await runParams(
        `SELECT chat_id, media_kind, media_file_id, message_text
           FROM messages_log
          WHERE message_id = $1 ${srcChat != null ? "AND chat_id = $2" : ""}
          ORDER BY created_at DESC
          LIMIT 1`,
        srcChat != null ? [srcMsgId, srcChat] : [srcMsgId],
      )) as Array<{
        media_kind: string | null;
        media_file_id: string | null;
        message_text: string | null;
      }>;
      const row = rows[0];
      if (!row) throw new Error(`no stored message ${srcMsgId}`);
      const caption =
        row.message_text && !row.message_text.startsWith("[")
          ? row.message_text.slice(0, 1024)
          : undefined;
      // media_kind → (Telegram method, payload field).
      const MEDIA_METHOD: Record<string, { method: string; field: string; caption: boolean }> = {
        photo: { method: "sendPhoto", field: "photo", caption: true },
        video: { method: "sendVideo", field: "video", caption: true },
        animation: { method: "sendAnimation", field: "animation", caption: true },
        voice: { method: "sendVoice", field: "voice", caption: true },
        audio: { method: "sendAudio", field: "audio", caption: true },
        document: { method: "sendDocument", field: "document", caption: true },
        sticker: { method: "sendSticker", field: "sticker", caption: false },
        video_note: { method: "sendVideoNote", field: "video_note", caption: false },
      };
      const body: Record<string, unknown> = { chat_id: targetChat };
      if (args.message_thread_id != null) {
        body.message_thread_id = Number(args.message_thread_id);
      }
      let method: string;
      if (row.media_file_id && row.media_kind && MEDIA_METHOD[row.media_kind]) {
        const spec = MEDIA_METHOD[row.media_kind]!;
        method = spec.method;
        body[spec.field] = row.media_file_id;
        if (spec.caption && caption) {
          // Plain-text caption: OMIT parse_mode entirely. Passing an
          // unsupported value ("none") is not a valid Telegram
          // parse_mode and leaving it off is what renders the stored
          // text safely without HTML/Markdown entity parsing.
          body.caption = caption;
        }
      } else {
        method = "sendMessage";
        const t = (row.message_text ?? "").slice(0, 4096);
        if (!t.trim()) throw new Error("nothing to send (no media, empty text)");
        body.text = t;
        body.disable_web_page_preview = true;
      }
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/${method}`,
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
      return toolText({ ok: true, method, message_id: j.result?.message_id });
    }

    case "transcribe_voice": {
      let fileId = args.file_id ? String(args.file_id) : "";
      const midArg = args.source_message_id != null ? Number(args.source_message_id) : null;
      // Track the exact row we read the file_id from — message_id is NOT
      // unique across chats, so the transcript cache below must be
      // scoped to this chat or it could land on another chat's row.
      let cacheChatId: number | null = null;
      if (!fileId && midArg != null && Number.isFinite(midArg)) {
        const srcChat = args.source_chat_id != null ? Number(args.source_chat_id) : null;
        const rows = (await runParams(
          `SELECT chat_id, media_file_id, media_kind FROM messages_log
             WHERE message_id = $1 ${srcChat != null ? "AND chat_id = $2" : ""}
             ORDER BY created_at DESC LIMIT 1`,
          srcChat != null ? [midArg, srcChat] : [midArg],
        )) as Array<{ chat_id: string | number; media_file_id: string | null; media_kind: string | null }>;
        const row = rows[0];
        if (!row?.media_file_id) throw new Error(`no media on message ${midArg}`);
        fileId = String(row.media_file_id);
        cacheChatId = Number(row.chat_id);
      }
      if (!fileId) throw new Error("source_message_id or file_id required");
      const { transcribeAudio } = await import("@/lib/stt");
      const { getSettings } = await import("@/lib/settings");
      const lang = args.language
        ? String(args.language)
        : (await getSettings()).sttLanguage || undefined;
      const r = await transcribeAudio({
        botToken: config.telegramBotToken,
        fileId,
        language: lang,
      });
      if (midArg != null && Number.isFinite(midArg) && cacheChatId != null) {
        // Best-effort cache so a re-read shows the transcript. Scoped to
        // the exact (chat_id, message_id) row we transcribed.
        await runParams(
          `UPDATE messages_log SET media_description = $1, media_description_at = NOW()
             WHERE message_id = $2 AND chat_id = $3
               AND (media_description IS NULL OR media_description = '')`,
          [r.text, midArg, cacheChatId],
        ).catch(() => {});
      }
      return toolText({
        text: r.text,
        provider: r.provider,
        durationSeconds: r.durationSeconds ?? null,
      });
    }

    case "bot_chat_status": {
      const chatId = Number(args.chat_id);
      if (!Number.isFinite(chatId)) throw new Error("chat_id required");
      const botId = Number((config.telegramBotToken ?? "").split(":")[0]);
      const call = async (method: string, body: Record<string, unknown>) => {
        const res = await fetch(
          `https://api.telegram.org/bot${config.telegramBotToken}/${method}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        return (await res.json()) as {
          ok: boolean;
          result?: Record<string, unknown>;
          description?: string;
        };
      };
      const chat = await call("getChat", { chat_id: chatId });
      const member = Number.isFinite(botId)
        ? await call("getChatMember", { chat_id: chatId, user_id: botId })
        : { ok: false, description: "bot id unknown" };
      const status = (member.result?.status as string | undefined) ?? null;
      const canPost =
        status === "administrator" || status === "creator"
          ? (member.result?.can_post_messages as boolean | undefined) ?? true
          : false;
      const adminsRes = (await call("getChatAdministrators", {
        chat_id: chatId,
      })) as {
        ok: boolean;
        result?: Array<{ user?: { id?: number; is_bot?: boolean; first_name?: string; username?: string }; status?: string }>;
        description?: string;
      };
      const admins = (adminsRes.result ?? []).map((a) => ({
        id: a.user?.id ?? null,
        is_bot: a.user?.is_bot ?? false,
        name: a.user?.first_name ?? a.user?.username ?? null,
        status: a.status ?? null,
      }));
      return toolText({
        chat_ok: chat.ok,
        chat_type: chat.result?.type ?? null,
        chat_title: chat.result?.title ?? null,
        chat_error: chat.ok ? null : chat.description,
        bot_id: Number.isFinite(botId) ? botId : null,
        bot_status: status,
        bot_member_error: member.ok ? null : member.description,
        can_post_messages: canPost,
        receives_channel_posts: status === "administrator" || status === "creator",
        admins,
        bot_admins: admins.filter((a) => a.is_bot),
      });
    }

    case "send_album": {
      const targetChat = Number(args.chat_id);
      const idsRaw = Array.isArray(args.source_message_ids)
        ? (args.source_message_ids as unknown[]).map(Number).filter((n) => Number.isFinite(n))
        : [];
      if (!Number.isFinite(targetChat) || idsRaw.length === 0) {
        throw new Error("chat_id and source_message_ids[] required");
      }
      const srcChat = args.source_chat_id != null ? Number(args.source_chat_id) : null;
      const rows = (await runParams(
        `SELECT message_id, media_kind, media_file_id, message_text
           FROM messages_log
          WHERE message_id = ANY($1) ${srcChat != null ? "AND chat_id = $2" : ""}`,
        srcChat != null ? [idsRaw, srcChat] : [idsRaw],
      )) as Array<{
        message_id: string | number;
        media_kind: string | null;
        media_file_id: string | null;
        message_text: string | null;
      }>;
      const byId = new Map(rows.map((r) => [Number(r.message_id), r]));
      const ordered = idsRaw
        .map((id) => byId.get(id))
        .filter(
          (r): r is NonNullable<typeof r> =>
            !!r && !!r.media_file_id && !!r.media_kind,
        );
      if (ordered.length === 0) throw new Error("no media rows found");
      const captionRow = ordered.find(
        (r) => r.message_text && !r.message_text.startsWith("["),
      );
      const caption = captionRow
        ? String(captionRow.message_text).slice(0, 1024)
        : undefined;
      const sentIds: number[] = [];
      for (let i = 0; i < ordered.length; i += 10) {
        const chunk = ordered.slice(i, i + 10);
        const media = chunk.map((r, idx) => {
          const type = r.media_kind === "video" ? "video" : "photo";
          const item: Record<string, unknown> = { type, media: r.media_file_id };
          if (i === 0 && idx === 0 && caption) item.caption = caption;
          return item;
        });
        const body: Record<string, unknown> = { chat_id: targetChat, media };
        if (args.message_thread_id != null) {
          body.message_thread_id = Number(args.message_thread_id);
        }
        const res = await fetch(
          `https://api.telegram.org/bot${config.telegramBotToken}/sendMediaGroup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const j = (await res.json()) as {
          ok: boolean;
          result?: Array<{ message_id: number }>;
          description?: string;
        };
        if (!j.ok) throw new Error(`telegram: ${j.description ?? "sendMediaGroup failed"}`);
        for (const m of j.result ?? []) sentIds.push(m.message_id);
      }
      return toolText({ ok: true, message_ids: sentIds });
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
      const url = String(args.url ?? "");
      // Two tolerant passes: pass 1 creates every table (some ALTERs
      // fail because they reference a table created later); pass 2
      // re-runs so those ALTERs succeed. Only errors that survive pass
      // 2 are real.
      const e1: string[] = [];
      await ensureSchema(
        makePgClient(url, { tolerant: true, errors: e1 }) as unknown as NeonQueryFunction<false, false>,
      );
      const e2: string[] = [];
      await ensureSchema(
        makePgClient(url, { tolerant: true, errors: e2 }) as unknown as NeonQueryFunction<false, false>,
      );
      const pool = await getPgPool(url);
      const t = await pool.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
      );
      return toolText({
        ok: e2.length === 0,
        tables: t.rows[0]?.n ?? 0,
        pass1_errors: e1.length,
        remaining_errors: e2.slice(0, 20),
      });
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
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [table],
      );
      const cols = colRows.map((r) => String(r.column_name));
      const colType: Record<string, string> = {};
      for (const r of colRows) colType[String(r.column_name)] = String(r.data_type);
      if (cols.length === 0) throw new Error("table not found in source");
      const hasId = cols.includes("id");
      // Cap batch so total placeholders stay under Postgres' 65535
      // param limit (rows × columns).
      const safeLimit = Math.max(1, Math.min(limit, Math.floor(60000 / Math.max(cols.length, 1))));
      const rows = hasId
        ? await src.query(`SELECT * FROM "${table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`, [afterId, safeLimit])
        : // no id → OFFSET pagination (after_id doubles as the offset)
          await src.query(`SELECT * FROM "${table}" OFFSET $1 LIMIT $2`, [afterId, safeLimit]);
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
          const dt = colType[c] ?? "";
          let out: unknown = v;
          if (v != null && !(v instanceof Date)) {
            if (dt === "ARRAY") {
              // pg formats a JS array as a Postgres array literal — pass
              // through unchanged.
              out = v;
            } else if (dt === "jsonb" || dt === "json") {
              // node-postgres would treat a JS array as a PG array, so
              // stringify json/jsonb values explicitly.
              out = JSON.stringify(v);
            } else if (typeof v === "object") {
              out = JSON.stringify(v);
            }
          }
          params.push(out);
          return `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      });
      await target.query(
        `INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
        params,
      );
      // Cursor for the next batch: last id (keyset) or offset+copied.
      const nextCursor = hasId ? Number(rows[rows.length - 1]!.id) : afterId + rows.length;
      return toolText({
        ok: true,
        table,
        copied: rows.length,
        last_id: nextCursor,
        done: rows.length < safeLimit,
      });
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

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// A caller is either the master key (full access) or a scoped token that
// may only read a fixed set of chats and write into one topic.
type Scope =
  | { full: true }
  | { full: false; scope: import("@/lib/db").McpTokenScope };

// Tools a scoped token may call. Deliberately excludes every raw-SQL and
// schema tool (query/execute/tidb_*/db_*): arbitrary SQL would read any
// chat in the database and defeat the whole point of scoping.
const SCOPED_TOOLS = new Set([
  "list_groups",
  "group_overview",
  "group_tasks",
  "group_topic_messages",
  "group_members",
  "chat_messages",
  "chat_history",
  "send_message",
  "create_forum_topic",
]);

async function authorize(request: Request): Promise<Scope | null> {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const presented = m?.[1] ?? "";
  if (!presented) return null;
  const secret = config.mcpSecret;
  if (secret && safeEqual(presented, secret)) return { full: true };
  const { getMcpTokenScope } = await import("@/lib/db");
  const scope = await getMcpTokenScope(presented).catch(() => null);
  return scope ? { full: false, scope } : null;
}

// Throws when a scoped caller steps outside its allowance. Full-access
// callers pass straight through.
function enforceScope(
  auth: Scope,
  name: string,
  args: Record<string, unknown>,
): void {
  if (auth.full) return;
  const sc = auth.scope;
  if (!SCOPED_TOOLS.has(name)) {
    throw new Error(
      `tool "${name}" is not available to this token (scoped: ${sc.label})`,
    );
  }
  const readable = new Set(sc.readChatIds);
  const asId = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  const target =
    asId(args.chat_id) ?? asId(args.group_id) ?? asId(args.source_chat_id);
  if (target != null && !readable.has(target)) {
    throw new Error(
      `chat ${target} is outside this token's scope (allowed: ${sc.readChatIds.join(", ")})`,
    );
  }
  if (name === "send_message" || name === "create_forum_topic") {
    if (sc.writeChatId == null) {
      throw new Error("this token is read-only");
    }
    if (target != null && target !== sc.writeChatId) {
      throw new Error(
        `this token may only write in chat ${sc.writeChatId}, not ${target}`,
      );
    }
    if (name === "create_forum_topic" && !sc.canCreateTopic) {
      throw new Error("this token may not create topics");
    }
    if (name === "send_message") {
      // Writing is confined to one topic; the General channel and every
      // other topic stay read-only.
      const thread = asId(args.message_thread_id);
      if (sc.writeThreadId != null && thread !== sc.writeThreadId) {
        throw new Error(
          `this token may only post in topic ${sc.writeThreadId} of chat ${sc.writeChatId}`,
        );
      }
      if (args.business_connection_id) {
        throw new Error("this token may not send as the owner");
      }
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
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
        return ok(msg.id, {
          tools: auth.full
            ? TOOLS
            : TOOLS.filter((t) => SCOPED_TOOLS.has((t as { name: string }).name)),
        });
      case "tools/call": {
        const params = msg.params ?? {};
        const name = String(params.name ?? "");
        const args = (params.arguments as Record<string, unknown>) ?? {};
        try {
          enforceScope(auth, name, args);
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
