import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  deleteNoteWatchItem,
  getNoteWatchItem,
  updateNoteWatchItem,
} from "@/lib/db";

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
  const item = await getNoteWatchItem(itemId);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(
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
  const body = (await request.json().catch(() => ({}))) as {
    concept?: string;
    description?: string | null;
    enabled?: boolean;
    emoji?: string | null;
    priority?: string;
    forwardToInbox?: boolean;
    cooldownOverrideMinutes?: number | null;
    context?: string | null;
  };
  const validPri =
    body.priority === "low" || body.priority === "normal" || body.priority === "high"
      ? body.priority
      : undefined;
  let cooldown: number | null | undefined = undefined;
  if (body.cooldownOverrideMinutes === null) cooldown = null;
  else if (body.cooldownOverrideMinutes !== undefined) {
    const n = Number(body.cooldownOverrideMinutes);
    cooldown = Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  }
  const item = await updateNoteWatchItem(itemId, {
    concept: body.concept,
    description:
      body.description === undefined
        ? undefined
        : (body.description?.trim() || null),
    enabled: body.enabled,
    emoji:
      body.emoji === undefined
        ? undefined
        : (body.emoji?.trim() || null),
    priority: validPri,
    forwardToInbox: body.forwardToInbox,
    cooldownOverrideMinutes: cooldown,
    context:
      body.context === undefined
        ? undefined
        : (body.context?.trim() || null),
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
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
  await deleteNoteWatchItem(itemId);
  return NextResponse.json({ ok: true });
}
