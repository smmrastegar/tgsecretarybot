import { NextResponse } from "next/server";
import { readMagicToken } from "@/lib/magic";
import { createSession } from "@/lib/auth";
import { getChatIdByShareToken, requestBoardAccess, getBoardMember } from "@/lib/db";
import { isBoardOwner, boardSessionDisplayName } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exchange the one-time magic token (minted by the bot's /start
// board_<token> deep link) for a signed board session. The magic token
// already proves the caller's Telegram identity, so we just mint the
// session and report their approval status.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await getChatIdByShareToken(token).catch(() => null);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const magic = (body.token ?? "").trim();
  if (!magic) return NextResponse.json({ error: "missing token" }, { status: 400 });
  const identity = await readMagicToken(magic);
  if (!identity) {
    return NextResponse.json(
      { error: "لینک منقضی شده — دوباره از ربات استارت بزن" },
      { status: 401 },
    );
  }

  const name = boardSessionDisplayName(identity);
  const owner = await isBoardOwner(identity.userId);
  // Idempotent — the /start handler already recorded this, but be safe
  // if the link was opened without it.
  await requestBoardAccess({
    chatId: chat.chatId,
    tgId: identity.userId,
    username: identity.username ?? null,
    name,
    autoApprove: owner,
  }).catch(() => null);

  const member = owner ? null : await getBoardMember(chat.chatId, identity.userId).catch(() => null);
  const session = await createSession(identity);

  return NextResponse.json({
    ok: true,
    status: owner ? "approved" : member?.status ?? "pending",
    isOwner: owner,
    name,
    session,
  });
}
