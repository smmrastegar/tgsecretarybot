import { NextResponse } from "next/server";
import { getChatIdByShareToken, getBoardMember } from "@/lib/db";
import { readSessionFromToken } from "@/lib/session";
import { isBoardOwner, boardSessionDisplayName } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Report the caller's access status for this board so the page can show
// the right screen (login / waiting-for-approval / rejected / in).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await getChatIdByShareToken(token).catch(() => null);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });

  const url = new URL(req.url);
  const sess =
    req.headers.get("x-board-session") ?? url.searchParams.get("s") ?? "";
  const session = sess ? await readSessionFromToken(sess) : null;
  if (!session) {
    return NextResponse.json({ ok: true, status: "anonymous", chatTitle: chat.chatTitle });
  }
  const name = boardSessionDisplayName(session);
  if (await isBoardOwner(session.userId)) {
    return NextResponse.json({ ok: true, status: "approved", isOwner: true, name, chatTitle: chat.chatTitle });
  }
  const member = await getBoardMember(chat.chatId, session.userId).catch(() => null);
  return NextResponse.json({
    ok: true,
    status: member?.status ?? "none",
    isOwner: false,
    name,
    chatTitle: chat.chatTitle,
  });
}
