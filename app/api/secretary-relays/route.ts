import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  createSecretaryRelay,
  listSecretaryRelays,
  listSecretaryRelayRecipients,
  listSecretaryRelaySources,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const relays = await listSecretaryRelays();
  const enriched = await Promise.all(
    relays.map(async (r) => ({
      ...r,
      sources: await listSecretaryRelaySources(r.id),
      recipients: await listSecretaryRelayRecipients(r.id),
    })),
  );
  return NextResponse.json({ relays: enriched });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    enabled?: boolean;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const relay = await createSecretaryRelay({
    name,
    enabled: body.enabled ?? true,
  });
  return NextResponse.json({ relay });
}
