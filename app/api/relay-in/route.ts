import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAllSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A message another bot (or any outside program) posted in a group never reaches this bot — Telegram does not deliver
// bots' messages to bots — so message rules cannot see it. This endpoint lets that program hand the text over itself:
// it is logged and run through the same rules as a message that arrived in the group, so a rule can forward it on.
// Auth: `Authorization: Bearer <settings.relayInToken>`. Only chats listed in settings.relayInChats (comma separated ids) are accepted.
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export async function POST(request: Request): Promise<NextResponse> {
  const s = await getAllSettings();
  const token = (s.relayInToken ?? "").trim();
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 24 || !presented || !same(token, presented)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { chat_id?: unknown; chat_title?: unknown; sender?: unknown; text?: unknown; message_id?: unknown };
  const chatId = Number(b.chat_id);
  const allowed = (s.relayInChats ?? "").split(",").map((x) => Number(x.trim())).filter(Number.isFinite);
  if (!Number.isFinite(chatId) || !allowed.includes(chatId)) return NextResponse.json({ error: "chat not allowed" }, { status: 403 });
  const text = typeof b.text === "string" ? b.text.slice(0, 4000) : "";
  if (!text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const { applyRulesToBotOutgoing } = await import("@/lib/bot");
  await applyRulesToBotOutgoing({
    chatId, chatType: chatId < 0 ? "supergroup" : "private",
    chatTitle: typeof b.chat_title === "string" ? b.chat_title.slice(0, 120) : null,
    messageThreadId: null, messageId: Number(b.message_id) || 0, text,
    senderName: (typeof b.sender === "string" && b.sender.trim() ? b.sender.trim() : "outside program").slice(0, 80),
  });
  return NextResponse.json({ ok: true });
}
