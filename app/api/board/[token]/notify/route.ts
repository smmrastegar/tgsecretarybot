import { NextResponse } from "next/server";
import {
  getChatIdByShareToken,
  requestBoardAccess,
  getBoardMember,
} from "@/lib/db";
import { readSessionFromToken } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { isBoardOwner, boardSessionDisplayName } from "@/lib/board-auth";
import { getBot } from "@/lib/bot";
import { InlineKeyboard } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// (Re)send the owner an approval card for the caller's pending request.
// Called by the "recheck" button on the waiting screen so approval never
// depends on the original login-time push. Returns the actual send
// outcome (including any Telegram error) so failures are visible.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await getChatIdByShareToken(token).catch(() => null);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });

  const url = new URL(req.url);
  const sess = req.headers.get("x-board-session") ?? url.searchParams.get("s") ?? "";
  const identity = sess ? await readSessionFromToken(sess) : null;
  if (!identity) return NextResponse.json({ error: "login required" }, { status: 401 });

  if (await isBoardOwner(identity.userId)) {
    return NextResponse.json({ ok: true, status: "approved" });
  }
  const name = boardSessionDisplayName(identity);
  await requestBoardAccess({
    chatId: chat.chatId,
    tgId: identity.userId,
    username: identity.username ?? null,
    name,
  }).catch(() => null);
  const member = await getBoardMember(chat.chatId, identity.userId).catch(() => null);
  if (member && member.status !== "pending") {
    return NextResponse.json({ ok: true, status: member.status });
  }

  const ownerNotify = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  let notified = false;
  let sendError: string | null = null;
  if (ownerNotify) {
    try {
      const uname = identity.username ? ` (@${identity.username})` : "";
      const kb = new InlineKeyboard()
        .text("✅ تایید دسترسی", `board:ok:${chat.chatId}:${identity.userId}`)
        .text("❌ رد", `board:no:${chat.chatId}:${identity.userId}`);
      await getBot().api.sendMessage(
        ownerNotify,
        `🔐 درخواست دسترسی به برد\n\n` +
          `برد: ${chat.chatTitle ?? chat.chatId}\n` +
          `کاربر: ${name}${uname}\n` +
          `آیدی: ${identity.userId}\n\n` +
          `اگر تایید کنی، دسترسی ویرایش پیدا می‌کنه.`,
        { reply_markup: kb },
      );
      notified = true;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
      console.error("[board] notify resend failed:", err);
    }
  } else {
    sendError = "ownerNotifyChatId not set";
  }
  return NextResponse.json({ ok: true, status: "pending", notified, error: sendError });
}
