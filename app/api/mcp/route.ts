import { config } from "@/lib/config";
import { hasDb, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
