import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteSmsBlockRule, updateSmsBlockRule } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    label?: string | null;
    enabled?: boolean;
  };
  const rule = await updateSmsBlockRule(ruleId, {
    label:
      body.label === undefined ? undefined : (body.label?.trim() || null),
    enabled: body.enabled,
  });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ rule });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteSmsBlockRule(ruleId);
  return NextResponse.json({ ok: true });
}
