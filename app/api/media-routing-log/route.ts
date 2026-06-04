import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listMediaRoutingLog, type MediaRoutingDecision } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/media-routing-log
//   ?chatId=<id>   — only entries from that source chat
//   ?decision=routed|flag_off|muted|no_target|no_rule|error
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const chatIdRaw = url.searchParams.get("chatId");
  const decisionRaw = url.searchParams.get("decision");
  const ALLOWED: MediaRoutingDecision[] = [
    "routed",
    "no_rule",
    "flag_off",
    "muted",
    "no_target",
    "error",
    "received_business",
    "received_group",
    "received_secretary",
    "received_edit",
    "skipped_bot_echo",
    "skipped_no_owner",
    "skipped_owner_self",
    "passed_to_router",
    "skipped_no_bcid",
    "skipped_no_content",
  ];
  const chatId = chatIdRaw ? Number(chatIdRaw) : undefined;
  const decision = ALLOWED.includes(decisionRaw as MediaRoutingDecision)
    ? (decisionRaw as MediaRoutingDecision)
    : undefined;
  const log = await listMediaRoutingLog({
    chatId: chatId && Number.isFinite(chatId) ? chatId : null,
    decision,
    limit: 200,
  });
  return NextResponse.json({ ok: true, log });
}
