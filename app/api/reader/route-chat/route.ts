import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { getAllSettings, setSetting, updateMessageRule } from "@/lib/db";
import { createReaderRoute, readerChats, setReaderChatRule } from "@/lib/group-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { chatId, dest } → forward everything the reader hears in that group to the ticket bot, "← مقصد: <dest>".
// DELETE ?chatId= → stop forwarding that group (the rule is switched off, not deleted).
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { chatId?: unknown; dest?: unknown };
  const chatId = Number(b.chatId), dest = String(b.dest ?? "").trim().slice(0, 60);
  const chats = await readerChats();
  const chat = chats[String(chatId)];
  if (!Number.isFinite(chatId) || !chat || !dest) return NextResponse.json({ error: "گروه یا مقصد درست نیست" }, { status: 400 });
  const recipient = Number((await getAllSettings()).tgReaderRecipient);
  if (!Number.isFinite(recipient) || recipient === 0) return NextResponse.json({ error: "گیرنده (ربات تیکت) تنظیم نشده" }, { status: 400 });
  if (chat.ruleId) await updateMessageRule(chat.ruleId, { enabled: false }); // replace an older route of this group
  const ruleId = await createReaderRoute(chatId, chat.title, dest, recipient);
  await setReaderChatRule(chatId, ruleId);
  return NextResponse.json({ ok: true, ruleId });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const chatId = Number(new URL(request.url).searchParams.get("chatId"));
  const chat = (await readerChats())[String(chatId)];
  if (chat?.ruleId) { await updateMessageRule(chat.ruleId, { enabled: false }); await setReaderChatRule(chatId, null); }
  await setSetting("tgReaderAuto", "");
  return NextResponse.json({ ok: true });
}
