import { NextResponse } from "next/server";
import {
  listBoardMembers,
  getBoardMember,
  setBoardMemberStatus,
  logBoardEvent,
} from "@/lib/db";
import { authBoard } from "@/lib/board-auth";
import { getBot } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List everyone who requested access to this board (owner only). This is
// the reliable approval path — it does not depend on the Telegram push
// reaching the owner.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.isOwner) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const members = await listBoardMembers(auth!.chatId);
  return NextResponse.json({
    ok: true,
    members: members
      .filter((m) => m.tgId !== auth!.tgId)
      .map((m) => ({
        tgId: m.tgId,
        name: m.name,
        username: m.username,
        status: m.status,
        createdAt: m.createdAt,
      })),
  });
}

// Approve / reject a member (owner only).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.isOwner) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { tgId?: number; action?: string };
  const tgId = Number(body.tgId);
  const action = body.action;
  if (!Number.isFinite(tgId) || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "tgId + action required" }, { status: 400 });
  }
  const existing = await getBoardMember(auth!.chatId, tgId);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const status = action === "approve" ? "approved" : "rejected";
  const member = await setBoardMemberStatus({
    chatId: auth!.chatId,
    tgId,
    status,
    decidedBy: auth!.actor,
  });
  const who = existing.name || (existing.username ? `@${existing.username}` : String(tgId));
  await logBoardEvent({
    chatId: auth!.chatId,
    taskId: null,
    action: "access",
    actor: auth!.actor,
    summary: action === "approve" ? `✅ دسترسی «${who}» تایید شد` : `❌ دسترسی «${who}» رد شد`,
  }).catch(() => {});
  if (action === "approve") {
    await getBot()
      .api.sendMessage(tgId, "✅ دسترسی‌ات به برد تسک تایید شد. حالا صفحه را باز کن.")
      .catch(() => {});
  }
  return NextResponse.json({ ok: true, member });
}
