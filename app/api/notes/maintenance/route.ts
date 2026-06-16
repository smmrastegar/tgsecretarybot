import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { archiveOldChatNotes } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-shot manual maintenance trigger. The notes UI's Settings tab
// has a "پاک‌سازی الان" button that fires this; the response shows
// how many rows were affected. Same logic the (future) auto-archive
// cron would use, but on demand.
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { days?: number };
  const days = Math.max(Math.min(Number(body.days) || 0, 365 * 5), 1);
  const archived = await archiveOldChatNotes(days);
  return NextResponse.json({ ok: true, archived, days });
}
