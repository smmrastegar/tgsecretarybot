import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteSiteMonitor, getSiteMonitor, updateSiteMonitor } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const mid = Number(id);
  if (!Number.isFinite(mid)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["name","loginUrl","checkUrl","username","password","usernameField","passwordField","extraFieldsJson","checkHoursTehran","skipWeekdays","notifyOn","scrapeMode"]) {
    if (k in b) patch[k] = b[k] === null ? null : String(b[k]);
  }
  if ("enabled" in b) patch.enabled = Boolean(b.enabled);
  await updateSiteMonitor(mid, patch);
  const m = await getSiteMonitor(mid);
  return NextResponse.json({ ok: true, monitor: m ? { ...m, password: undefined, hasPassword: Boolean(m.password) } : null });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const mid = Number(id);
  if (!Number.isFinite(mid)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await deleteSiteMonitor(mid);
  return NextResponse.json({ ok: true });
}
