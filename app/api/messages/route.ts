import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const urgentOnly = url.searchParams.get("urgent") === "1";
  const unhandledOnly = url.searchParams.get("unhandled") === "1";
  const chatIdRaw = url.searchParams.get("chat_id");
  const chatId = chatIdRaw ? Number(chatIdRaw) : undefined;
  const search = url.searchParams.get("q") ?? undefined;
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
  const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
  const kindRaw = url.searchParams.get("kind");
  const kind =
    kindRaw === "deleted" || kindRaw === "edited" || kindRaw === "all"
      ? kindRaw
      : undefined;

  const rows = await listMessages({
    urgentOnly,
    unhandledOnly,
    chatId: Number.isFinite(chatId) ? chatId : undefined,
    search,
    kind,
    limit,
    offset,
  });
  return NextResponse.json({ messages: rows });
}
