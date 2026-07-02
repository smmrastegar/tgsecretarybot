import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { deleteEmailAccount, updateEmailAccount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;
  const mid = Number(id);
  if (!Number.isFinite(mid)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ("name" in b) patch.name = String(b.name);
  if ("fromEmail" in b) patch.fromEmail = b.fromEmail === null ? null : String(b.fromEmail);
  if ("inboundToken" in b) patch.inboundToken = b.inboundToken === null ? null : String(b.inboundToken);
  if ("resendApiKey" in b && b.resendApiKey !== "********") patch.resendApiKey = b.resendApiKey === null ? null : String(b.resendApiKey);
  if ("tgChannelId" in b) patch.tgChannelId = b.tgChannelId === null || b.tgChannelId === "" ? null : Number(b.tgChannelId);
  if ("enabled" in b) patch.enabled = Boolean(b.enabled);
  await updateEmailAccount(mid, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_r: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;
  const mid = Number(id);
  if (!Number.isFinite(mid)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await deleteEmailAccount(mid);
  return NextResponse.json({ ok: true });
}
