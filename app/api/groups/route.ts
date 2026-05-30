import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listGroupSummaries } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const chatRaw = url.searchParams.get("chat_id");
  const chatId = chatRaw ? Number(chatRaw) : undefined;
  const summaries = await listGroupSummaries(
    Number.isFinite(chatId) ? chatId : undefined,
  );
  return NextResponse.json({ summaries });
}
