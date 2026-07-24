import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  verifyTelegramLogin,
  createSession,
  type TelegramLoginPayload,
} from "@/lib/auth";
import { getChatIdByShareToken, requestBoardAccess } from "@/lib/db";
import { isBoardOwner, boardSessionDisplayName } from "@/lib/board-auth";
import { getBot } from "@/lib/bot";
import { getSettings } from "@/lib/settings";
import { InlineKeyboard } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Telegram Login Widget callback for the board. Verifies the signed
// payload, records an access request scoped to this board, pings the
// owner for approval (unless the caller IS the owner), and returns a
// signed session the page uses for every subsequent request.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await getChatIdByShareToken(token).catch(() => null);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });

  const payload = (await req.json().catch(() => null)) as TelegramLoginPayload | null;
  if (!payload || typeof payload.id !== "number" || !payload.hash) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  if (!verifyTelegramLogin(payload, config.telegramBotToken)) {
    return NextResponse.json({ error: "telegram verification failed" }, { status: 401 });
  }

  const name = boardSessionDisplayName({
    firstName: payload.first_name,
    lastName: payload.last_name,
    username: payload.username,
    userId: payload.id,
  });
  const owner = await isBoardOwner(payload.id);

  const { member, isNew } = await requestBoardAccess({
    chatId: chat.chatId,
    tgId: payload.id,
    username: payload.username ?? null,
    name,
    autoApprove: owner,
  });

  // New pending request → ask the owner to approve, in their DM.
  const ownerNotifyChatId = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  if (isNew && !owner && ownerNotifyChatId) {
    try {
      const uname = payload.username ? ` (@${payload.username})` : "";
      const kb = new InlineKeyboard()
        .text("✅ تایید دسترسی", `board:ok:${chat.chatId}:${payload.id}`)
        .text("❌ رد", `board:no:${chat.chatId}:${payload.id}`);
      await getBot().api.sendMessage(
        ownerNotifyChatId,
        `🔐 درخواست دسترسی به برد\n\n` +
          `برد: ${chat.chatTitle ?? chat.chatId}\n` +
          `کاربر: ${name}${uname}\n` +
          `آیدی: ${payload.id}\n\n` +
          `اگر تایید کنی، به این برد دسترسی ویرایش پیدا می‌کنه.`,
        { reply_markup: kb },
      );
    } catch (err) {
      console.error("[board] owner notify failed:", err);
    }
  }

  const session = await createSession({
    userId: payload.id,
    username: payload.username ?? null,
    firstName: payload.first_name ?? null,
    lastName: payload.last_name ?? null,
    photoUrl: payload.photo_url ?? null,
  });

  return NextResponse.json({
    ok: true,
    status: owner ? "approved" : member.status,
    isOwner: owner,
    name,
    session,
  });
}
