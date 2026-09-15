import { NextResponse } from "next/server";
import { requireSessionOr401, getCurrentSession } from "@/lib/auth";
import { addRoadmapItem, audit, listRoadmap, type RoadmapStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "open") as RoadmapStatus | "open" | "all";
  const items = await listRoadmap({ status, limit: 300 });
  return NextResponse.json({ items });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const s = await getCurrentSession();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const item = await addRoadmapItem({
    title,
    kind: typeof body.kind === "string" ? body.kind : undefined,
    details: typeof body.details === "string" && body.details.trim() ? body.details.trim() : null,
    priority: body.priority != null ? Number(body.priority) : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    plannedFor: typeof body.plannedFor === "string" && body.plannedFor ? body.plannedFor : null,
    source: "owner",
    createdBy: s?.username ?? (s ? String(s.userId) : null),
  });
  await audit({
    actorId: s?.userId ?? null,
    actorName: s?.username ?? null,
    action: "roadmap.add",
    target: String(item.id),
    details: { title: item.title, kind: item.kind },
  });
  return NextResponse.json({ item });
}
