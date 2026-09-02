import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { replyToEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const b = (await request.json().catch(() => ({}))) as { text?: string; html?: string; to?: string; subject?: string };
  const r = await replyToEmail(Number(id), String(b.text ?? ""), {
    to: b.to ? String(b.to) : undefined,
    subject: b.subject ? String(b.subject) : undefined,
    html: b.html ? String(b.html) : undefined,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
