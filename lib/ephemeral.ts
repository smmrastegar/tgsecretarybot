// Delivery side of ephemeral messages: the Telegram delete call, the
// in-process timer, and the sweep the cron runs. Storage is in
// lib/db/ephemeral.ts.
import { config } from "./config";
import {
  dueEphemeralMessages,
  getEphemeralMessage,
  markEphemeralDeleted,
  markEphemeralFailed,
} from "./db";
import { reportWarn } from "./report";

// Telegram refuses to delete a message older than 48 hours, so a TTL
// past that would leave the message up forever. Cap a little under.
export const EPHEMERAL_MIN_TTL = 5;
export const EPHEMERAL_MAX_TTL = 47 * 3600;
export const EPHEMERAL_DEFAULT_TTL = 60;

export function clampTtl(v: unknown): number {
  // Number(null) is 0, which would clamp to the minimum instead of
  // defaulting — an omitted TTL must mean "the default", not 5 s.
  if (v == null || v === "") return EPHEMERAL_DEFAULT_TTL;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return EPHEMERAL_DEFAULT_TTL;
  return Math.min(EPHEMERAL_MAX_TTL, Math.max(EPHEMERAL_MIN_TTL, n));
}

// "message to delete not found" and "message can't be deleted" both mean
// the message is gone (someone beat us to it, or it was in a chat the bot
// can no longer touch). Treat as done rather than retrying for hours.
const GONE = /not found|can't be deleted|MESSAGE_ID_INVALID/i;

export async function deleteTelegramMessage(
  chatId: number,
  messageId: number,
): Promise<{ ok: true } | { ok: false; gone: boolean; error: string }> {
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/deleteMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    },
  );
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };
  if (j.ok) return { ok: true };
  const error = j.description ?? `http ${res.status}`;
  return { ok: false, gone: GONE.test(error), error };
}

/** Delete one scheduled row now, whatever its delete_at says. */
export async function fireEphemeral(id: number): Promise<boolean> {
  const row = await getEphemeralMessage(id);
  if (!row || row.deletedAt) return false;
  const r = await deleteTelegramMessage(row.chatId, row.messageId);
  if (r.ok || r.gone) {
    await markEphemeralDeleted(id);
    return true;
  }
  await markEphemeralFailed(id, r.error);
  reportWarn("ephemeral", `delete ${row.chatId}/${row.messageId} failed: ${r.error}`);
  return false;
}

// Timers live only as long as the process; the cron sweep is the
// durable half. Node's setTimeout overflows past ~24.8 days, which the
// TTL cap already rules out.
const timers = new Map<number, NodeJS.Timeout>();

export function armEphemeralTimer(id: number, ttlSeconds: number): void {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(id);
    fireEphemeral(id).catch((err) =>
      reportWarn("ephemeral", `timer for #${id} failed:`, err),
    );
  }, ttlSeconds * 1000);
  // Never keep the process alive just for a pending delete.
  t.unref?.();
  timers.set(id, t);
}

/** Cron entry point: delete everything past its TTL. */
export async function sweepEphemeral(): Promise<{
  due: number;
  deleted: number;
  failed: number;
}> {
  const due = await dueEphemeralMessages();
  let deleted = 0;
  let failed = 0;
  for (const row of due) {
    const r = await deleteTelegramMessage(row.chatId, row.messageId);
    if (r.ok || r.gone) {
      await markEphemeralDeleted(row.id);
      deleted++;
    } else {
      await markEphemeralFailed(row.id, r.error);
      failed++;
    }
  }
  if (failed > 0) {
    reportWarn("ephemeral", `sweep: ${failed} of ${due.length} deletes failed`);
  }
  return { due: due.length, deleted, failed };
}
