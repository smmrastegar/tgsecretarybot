import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getEmail } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_r: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;
  const e = await getEmail(Number(id));
  if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ email: e });
}
