import { webhookCallback } from "grammy";
import { config } from "@/lib/config";
import { getBot } from "@/lib/bot";
import { markUpdateProcessed } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// STT (download + transcribe) + AI generation can take 15-25s on slow
// providers; was 30s with grammy timeoutMilliseconds=25s which left no
// margin and Vercel was killing voice processing mid-flight. Pro tier
// allows up to 300s; 60s is plenty.
export const maxDuration = 60;

const handler = webhookCallback(getBot(), "std/http", {
  secretToken: config.webhookSecretToken,
  // grammy's timeoutMilliseconds only controls when the 200 OK is
  // returned to Telegram — the handler keeps running in the
  // background. Bumping it gives Telegram a longer wait before it
  // assumes the webhook is stuck and starts retrying.
  timeoutMilliseconds: 55_000,
});

// Subset of Telegram Update fields we care about for diagnostics —
// matched to ALLOWED_UPDATES. The Health page reads these counts to
// confirm whether the channel really is delivering channel_post events.
const TRACKED_UPDATE_KEYS = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "message_reaction",
  "callback_query",
  "my_chat_member",
  "chat_member",
] as const;

function summariseUpdate(raw: string): {
  updateId: number | null;
  updateType: string | null;
  chatId: number | null;
  preview: string | null;
} {
  try {
    const u = JSON.parse(raw) as Record<string, unknown> & {
      update_id?: number;
    };
    const updateId = typeof u.update_id === "number" ? u.update_id : null;
    let updateType: string | null = null;
    let payload: Record<string, unknown> | null = null;
    for (const k of TRACKED_UPDATE_KEYS) {
      if (u[k]) {
        updateType = k;
        payload = u[k] as Record<string, unknown>;
        break;
      }
    }
    let chatId: number | null = null;
    let preview: string | null = null;
    if (payload) {
      const direct = payload.chat as { id?: number } | undefined;
      const nestedMsg = payload.message as
        | { chat?: { id?: number } }
        | undefined;
      const chatIdRaw = direct?.id ?? nestedMsg?.chat?.id;
      if (typeof chatIdRaw === "number") chatId = chatIdRaw;
      const text =
        (payload.text as string | undefined) ??
        (payload.caption as string | undefined) ??
        (payload.data as string | undefined) ??
        null;
      if (text) preview = text.slice(0, 200);
    }
    return { updateId, updateType, chatId, preview };
  } catch {
    return { updateId: null, updateType: null, chatId: null, preview: null };
  }
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  const meta = summariseUpdate(text);
  if (meta.updateId !== null) {
    try {
      const isNew = await markUpdateProcessed(meta.updateId, {
        updateType: meta.updateType,
        chatId: meta.chatId,
        preview: meta.preview,
      });
      if (!isNew) {
        console.warn(`[webhook] dup update_id=${meta.updateId}, skipping`);
        return new Response("OK (dup)", { status: 200 });
      }
    } catch (err) {
      console.warn("[webhook] dedup check failed, processing anyway:", err);
    }
  }
  console.log(
    `[webhook] received type=${meta.updateType ?? "?"} chat=${meta.chatId ?? "?"} update_id=${meta.updateId ?? "?"}`,
  );
  const cloned = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: text,
  });
  return handler(cloned);
}
