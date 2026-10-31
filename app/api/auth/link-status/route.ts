import { NextResponse } from "next/server";
import { listPlayerLinks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?t=<link token> → { status: "pending" | "approved" | "denied" | "unknown" }. The player app calls it while it waits for the owner to approve a
// Telegram sign-up; the token only ever reached that person, and the answer says nothing else.
export async function GET(request: Request): Promise<NextResponse> {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  const l = t.length >= 40 ? (await listPlayerLinks()).find((x) => x.token === t && x.tgUserId != null) : null;
  const status = !l ? "unknown" : l.approval === "pending" ? "pending" : l.approval === "denied" ? "denied" : l.active ? "approved" : "unknown";
  return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
