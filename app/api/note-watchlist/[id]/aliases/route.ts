import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { addNoteWatchAlias, listNoteWatchAliases } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const aliases = await listNoteWatchAliases(itemId);
  return NextResponse.json({ aliases });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { alias?: string };
  const alias = (body.alias ?? "").trim();
  if (!alias) {
    return NextResponse.json({ error: "alias required" }, { status: 400 });
  }
  await addNoteWatchAlias({ itemId, alias: alias.slice(0, 200) });
  const aliases = await listNoteWatchAliases(itemId);
  return NextResponse.json({ aliases });
}
