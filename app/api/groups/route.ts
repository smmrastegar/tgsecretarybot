import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listAllGroups, listGroupSummaries } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const chatRaw = url.searchParams.get("chat_id");
  const chatId = chatRaw ? Number(chatRaw) : undefined;
  const [summaries, groups] = await Promise.all([
    listGroupSummaries(Number.isFinite(chatId) ? chatId : undefined),
    listAllGroups(),
  ]);
  return NextResponse.json({ summaries, groups });
}
