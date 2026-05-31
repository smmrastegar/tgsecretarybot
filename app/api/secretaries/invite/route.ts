import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { audit, createInvite, hasDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function POST(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "db not configured" }, { status: 500 });
  }

  const settings = await getSettings();
  const ownerName =
    settings.ownerDisplayName || settings.ownerName || "the owner";

  // Telegram /start payload is limited to ~64 chars [A-Za-z0-9_-], so we use
  // a short random hex token instead of a JWT.
  const token = `inv${randomBytes(12).toString("hex")}`;
  await createInvite({
    token,
    purpose: "secretary_invite",
    payload: { ownerName, invitedBy: session.userId },
    ttlSeconds: TTL_SECONDS,
    createdBy: session.userId,
  });

  const botUsername =
    process.env.NEXT_PUBLIC_BOT_USERNAME || "smmrchatbot";
  const url = `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "secretary.invite_created",
    target: token,
    details: { ttlSeconds: TTL_SECONDS },
  });

  return NextResponse.json({
    ok: true,
    url,
    token,
    expiresInSeconds: TTL_SECONDS,
  });
}
