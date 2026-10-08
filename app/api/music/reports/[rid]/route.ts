import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { setMusicReportStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { status: "open" | "resolved" }
export async function PATCH(request: Request, ctx: { params: Promise<{ rid: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { status?: string };
  if (b.status !== "open" && b.status !== "resolved") return NextResponse.json({ error: "bad status" }, { status: 400 });
  await setMusicReportStatus(Number((await ctx.params).rid), b.status);
  return NextResponse.json({ ok: true });
}
