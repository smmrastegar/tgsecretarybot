import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getEmail } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_r: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const e = await getEmail(Number(id));
  if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ email: e });
}
