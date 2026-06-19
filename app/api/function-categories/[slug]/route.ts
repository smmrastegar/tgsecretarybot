import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { deleteFunctionCategory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json({ error: "missing slug" }, { status: 400 });
  }
  await deleteFunctionCategory(slug);
  return NextResponse.json({ ok: true });
}
