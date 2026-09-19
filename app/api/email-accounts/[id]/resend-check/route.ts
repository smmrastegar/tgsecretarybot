import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getEmailAccount } from "@/lib/db";
import { checkAccountResend } from "@/lib/resend-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// "🔧 بررسی Resend" on an email account card: domain / records /
// webhook status, and (POST {createWebhook:true}) create the
// email.received webhook to this account's inbound URL.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const account = await getEmailAccount(Number(id));
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { createWebhook?: boolean };
  const report = await checkAccountResend(account, { createWebhook: body.createWebhook === true });
  // The signing secret is shown once by Resend; we don't verify
  // signatures (the URL token is the auth), so don't hand it to the UI.
  delete report.webhook.signingSecret;
  return NextResponse.json({ report });
}
