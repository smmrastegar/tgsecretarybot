import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getEmail } from "@/lib/db";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;
  const orig = await getEmail(Number(id));
  if (!orig) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { text?: string; html?: string; to?: string; subject?: string };
  const to = b.to || orig.fromEmail || "";
  if (!to) return NextResponse.json({ error: "گیرنده مشخص نیست" }, { status: 400 });
  const subject = b.subject || (orig.subject ? (/^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`) : "Re:");
  const r = await sendEmail({
    to, subject,
    text: b.text ? String(b.text) : undefined,
    html: b.html ? String(b.html) : undefined,
    replyToEmailId: orig.id,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
