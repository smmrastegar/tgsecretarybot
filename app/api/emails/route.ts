import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listEmails } from "@/lib/db";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const u = new URL(request.url);
  const dir = u.searchParams.get("direction");
  const direction = dir === "in" || dir === "out" ? dir : undefined;
  const limit = u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined;
  const offset = u.searchParams.get("offset") ? Number(u.searchParams.get("offset")) : undefined;
  const emails = await listEmails({ direction, limit, offset });
  // Trim bodies in the list view.
  return NextResponse.json({
    emails: emails.map((e) => ({
      ...e,
      textBody: e.textBody ? e.textBody.slice(0, 200) : null,
      htmlBody: undefined,
    })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const b = (await request.json().catch(() => ({}))) as {
    to?: string; subject?: string; text?: string; html?: string; cc?: string;
  };
  if (!b.to || !b.subject) return NextResponse.json({ error: "to و subject لازمه" }, { status: 400 });
  const r = await sendEmail({
    to: String(b.to), subject: String(b.subject),
    text: b.text ? String(b.text) : undefined,
    html: b.html ? String(b.html) : undefined,
    cc: b.cc ? String(b.cc) : undefined,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
