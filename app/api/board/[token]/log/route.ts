import { NextResponse } from "next/server";
import { listBoardEvents } from "@/lib/db";
import { authBoard } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Audit log for the board — who did what, when. Requires the board code.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  const events = await listBoardEvents(auth!.chatId, 150);
  return NextResponse.json({
    ok: true,
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor,
      summary: e.summary,
      reverted: e.reverted,
      createdAt: e.createdAt,
    })),
  });
}
