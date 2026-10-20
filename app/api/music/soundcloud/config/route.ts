import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { deleteScAccount, listScAccounts } from "@/lib/db";
import { saveScCredentials, scConfig, scRedirect } from "@/lib/soundcloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const c = await scConfig();
  return NextResponse.json({ hasCredentials: Boolean(c.clientId && c.clientSecret), clientId: c.clientId, accounts: await listScAccounts(), redirectUri: await scRedirect() });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string; accountId?: number; disconnect?: boolean };
  if (b.disconnect && Number.isFinite(Number(b.accountId))) { await deleteScAccount(Number(b.accountId)); return NextResponse.json({ ok: true }); }
  if (!b.clientId?.trim()) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  await saveScCredentials(b.clientId, b.clientSecret ?? "");
  return NextResponse.json({ ok: true });
}
