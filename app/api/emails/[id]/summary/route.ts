import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getEmail, setEmailSummary } from "@/lib/db";
import { summarizeEmail } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(_r: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const e = await getEmail(Number(id));
  if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = await summarizeEmail({ subject: e.subject, from: e.fromEmail, text: e.textBody });
  if (!r) return NextResponse.json({ error: "خلاصه‌سازی ناموفق بود" }, { status: 502 });
  const full = r.summary + (r.keyPoints.length ? "\n\n• " + r.keyPoints.join("\n• ") : "");
  await setEmailSummary(e.id, full).catch(() => {});
  return NextResponse.json({ ok: true, ...r, stored: full });
}
