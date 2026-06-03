import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {key: "<new-key>", name?: "smmr"} → stores in settings as
// override. Empty string clears the override (falls back to env).
// We never return the key value — only confirm via a masked prefix.
export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    key?: string;
    name?: string;
  };
  const key = (body.key ?? "").trim();
  const name = (body.name ?? "").trim();
  await updateSettings(
    {
      hikerApiKeyOverride: key,
      hikerApiKeyName: name,
    },
    session.userId,
  );
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: key ? "hiker.key_set" : "hiker.key_clear",
    details: {
      length: key.length,
      hasName: !!name,
    },
  });
  return NextResponse.json({
    ok: true,
    set: !!key,
    masked: key
      ? `${key.slice(0, 5)}…${key.slice(-3)} (${key.length} chars)`
      : null,
    name: name || null,
  });
}
