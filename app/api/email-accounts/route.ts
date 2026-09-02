import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { createEmailAccount, listEmailAccounts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redact<T extends { resendApiKey: string | null; inboundToken: string | null }>(a: T) {
  return {
    ...a,
    resendApiKey: a.resendApiKey ? "********" : "",
    hasApiKey: Boolean(a.resendApiKey),
    // inbound token IS shown (it goes in the webhook URL the operator pastes)
  };
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const accounts = (await listEmailAccounts()).map(redact);
  return NextResponse.json({ accounts });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const id = await createEmailAccount({
    name: String(b.name),
    resendApiKey: b.resendApiKey ? String(b.resendApiKey) : null,
    fromEmail: b.fromEmail ? String(b.fromEmail) : null,
    inboundToken: b.inboundToken ? String(b.inboundToken) : null,
    tgChannelId: b.tgChannelId != null && b.tgChannelId !== "" ? Number(b.tgChannelId) : null,
    publicUrl: b.publicUrl ? String(b.publicUrl) : null,
    inboundDomains: b.inboundDomains ? String(b.inboundDomains) : null,
  });
  return NextResponse.json({ ok: true, id });
}
