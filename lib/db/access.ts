// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";

// --- Scoped MCP tokens ---
export type McpTokenScope = {
  id: number;
  label: string;
  readChatIds: number[];
  writeChatId: number | null;
  writeThreadId: number | null;
  canCreateTopic: boolean;
  fullAccess: boolean;
};

export async function getMcpTokenScope(
  token: string,
): Promise<McpTokenScope | null> {
  if (!hasDb() || !token) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, label, read_chat_ids, write_chat_id, write_thread_id,
           can_create_topic, full_access
      FROM mcp_tokens
     WHERE token = ${token} AND enabled = TRUE
     LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  // Best-effort usage stamp; never block the call on it.
  void sql()`UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = ${Number(r.id)}`.catch(
    () => {},
  );
  const ids = String(r.read_chat_ids ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
  return {
    id: Number(r.id),
    label: String(r.label ?? ""),
    readChatIds: ids,
    writeChatId: r.write_chat_id == null ? null : Number(r.write_chat_id),
    writeThreadId:
      r.write_thread_id == null ? null : Number(r.write_thread_id),
    canCreateTopic: Boolean(r.can_create_topic),
    fullAccess: Boolean(r.full_access),
  };
}

export async function createMcpToken(args: {
  token: string;
  label: string;
  readChatIds: number[];
  writeChatId?: number | null;
  writeThreadId?: number | null;
  canCreateTopic?: boolean;
}): Promise<number> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO mcp_tokens (token, label, read_chat_ids, write_chat_id,
                            write_thread_id, can_create_topic)
    VALUES (${args.token}, ${args.label}, ${args.readChatIds.join(",")},
            ${args.writeChatId ?? null}, ${args.writeThreadId ?? null},
            ${args.canCreateTopic ?? false})
    RETURNING id`;
  return Number((rows[0] as { id: number }).id);
}

export async function setMcpTokenWriteThread(
  id: number,
  threadId: number | null,
): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mcp_tokens SET write_thread_id = ${threadId} WHERE id = ${id}`;
}

// --- Token-gated code feeds ---
export type CodeFeed = {
  id: number;
  token: string;
  label: string;
  chatId: number;
  windowSeconds: number;
  format: string;
  codesOnly: boolean;
  allowedIps: string[];
  enabled: boolean;
  lastAccessAt: Date | null;
  lastAccessIp: string | null;
};

function rowToCodeFeed(r: Record<string, unknown>): CodeFeed {
  return {
    id: Number(r.id),
    token: String(r.token ?? ""),
    label: String(r.label ?? ""),
    chatId: Number(r.chat_id),
    windowSeconds: Number(r.window_seconds ?? 300),
    format: String(r.format ?? "json"),
    codesOnly: Boolean(r.codes_only),
    allowedIps: String(r.allowed_ips ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    enabled: Boolean(r.enabled),
    lastAccessAt: (r.last_access_at as Date) ?? null,
    lastAccessIp: (r.last_access_ip as string) ?? null,
  };
}

export async function listCodeFeeds(): Promise<CodeFeed[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`SELECT * FROM code_feeds ORDER BY id DESC`;
  return rows.map(rowToCodeFeed);
}

export async function getCodeFeedByToken(
  token: string,
): Promise<CodeFeed | null> {
  if (!hasDb() || !token) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM code_feeds WHERE token = ${token} AND enabled = TRUE LIMIT 1`;
  return rows[0] ? rowToCodeFeed(rows[0]) : null;
}

export async function stampCodeFeedAccess(
  id: number,
  ip: string | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE code_feeds SET last_access_at = NOW(), last_access_ip = ${ip}
     WHERE id = ${id}`;
}

export async function upsertCodeFeed(args: {
  id?: number;
  token: string;
  label: string;
  chatId: number;
  windowSeconds: number;
  format: string;
  codesOnly: boolean;
  allowedIps: string[];
  enabled: boolean;
}): Promise<number> {
  await ensureSchema();
  const ips = args.allowedIps.join(",");
  if (args.id) {
    await sql()`
      UPDATE code_feeds SET
        label = ${args.label}, chat_id = ${args.chatId},
        window_seconds = ${args.windowSeconds}, format = ${args.format},
        codes_only = ${args.codesOnly}, allowed_ips = ${ips},
        enabled = ${args.enabled}
      WHERE id = ${args.id}`;
    return args.id;
  }
  const rows = await sql()`
    INSERT INTO code_feeds (token, label, chat_id, window_seconds, format,
                            codes_only, allowed_ips, enabled)
    VALUES (${args.token}, ${args.label}, ${args.chatId}, ${args.windowSeconds},
            ${args.format}, ${args.codesOnly}, ${ips}, ${args.enabled})
    RETURNING id`;
  return Number((rows[0] as { id: number }).id);
}

// Replace a feed's token, invalidating the old URL. The whole point of
// the feed is that the token IS the credential, so there has to be a way
// to burn one that leaked without rebuilding the feed's config.
export async function rotateCodeFeedToken(
  id: number,
  token: string,
): Promise<string | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE code_feeds
    SET token = ${token}, last_access_at = NULL, last_access_ip = NULL
    WHERE id = ${id}
    RETURNING token`;
  const r = rows[0] as { token: string } | undefined;
  return r ? r.token : null;
}

export async function deleteCodeFeed(id: number): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM code_feeds WHERE id = ${id}`;
}

// Messages from one chat inside a time window — the feed endpoint
// filters these down to the ones that actually carry a code.
export async function recentChatMessagesForFeed(
  chatId: number,
  windowSeconds: number,
  limit = 200,
): Promise<Array<{ createdAt: Date; text: string }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT created_at,
           COALESCE(NULLIF(message_text, ''), transcript, '') AS text
      FROM messages_log
     WHERE chat_id = ${chatId}
       AND created_at >= NOW() - (${windowSeconds} || ' seconds')::INTERVAL
     ORDER BY created_at DESC
     LIMIT ${limit}`;
  return rows.map((r) => ({
    createdAt: r.created_at as Date,
    text: String(r.text ?? ""),
  }));
}
