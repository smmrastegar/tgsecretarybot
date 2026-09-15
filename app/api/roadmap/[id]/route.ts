import { NextResponse } from "next/server";
import { requireSessionOr401, getCurrentSession } from "@/lib/auth";
import { audit, deleteRoadmapItem, updateRoadmapItem } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const item = await updateRoadmapItem(id, {
    kind: typeof body.kind === "string" ? body.kind : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    details: body.details === null ? null : typeof body.details === "string" ? body.details : undefined,
    priority: body.priority != null ? Number(body.priority) : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    plannedFor: body.plannedFor === null ? null : typeof body.plannedFor === "string" ? body.plannedFor : undefined,
    commitSha: body.commitSha === null ? null : typeof body.commitSha === "string" ? body.commitSha : undefined,
    outcome: body.outcome === null ? null : typeof body.outcome === "string" ? body.outcome : undefined,
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  const s = await getCurrentSession();
  await audit({
    actorId: s?.userId ?? null,
    actorName: s?.username ?? null,
    action: "roadmap.update",
    target: String(id),
    details: body,
  });
  return NextResponse.json({ item });
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await deleteRoadmapItem(id);
  const s = await getCurrentSession();
  await audit({
    actorId: s?.userId ?? null,
    actorName: s?.username ?? null,
    action: "roadmap.delete",
    target: String(id),
  });
  return NextResponse.json({ ok: true });
}
