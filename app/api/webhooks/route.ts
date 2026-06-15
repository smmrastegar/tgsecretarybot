import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { audit, createSmsWebhook, listSmsWebhooks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const webhooks = await listSmsWebhooks();
  return NextResponse.json({ webhooks });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    secret?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  // Generate a URL-safe 24-char token if the operator didn't supply
  // one. Random enough to be the only auth on the endpoint.
  const secret =
    body.secret?.trim() ||
    randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9]/g, "");
  const webhook = await createSmsWebhook({ name, secret });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "webhook.create",
    target: String(webhook.id),
    details: { name: webhook.name },
  });
  return NextResponse.json({ ok: true, webhook });
}
