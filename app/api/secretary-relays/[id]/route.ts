import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  deleteSecretaryRelay,
  getSecretaryRelay,
  listSecretaryRelayRecipients,
  listSecretaryRelaySources,
  updateSecretaryRelay,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const relayId = Number(id);
  if (!Number.isFinite(relayId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const relay = await getSecretaryRelay(relayId);
  if (!relay) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [sources, recipients] = await Promise.all([
    listSecretaryRelaySources(relayId),
    listSecretaryRelayRecipients(relayId),
  ]);
  return NextResponse.json({ relay: { ...relay, sources, recipients } });
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const relayId = Number(id);
  if (!Number.isFinite(relayId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    enabled?: boolean;
  };
  const relay = await updateSecretaryRelay(relayId, {
    name: body.name,
    enabled: body.enabled,
  });
  if (!relay) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ relay });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const relayId = Number(id);
  if (!Number.isFinite(relayId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteSecretaryRelay(relayId);
  return NextResponse.json({ ok: true });
}
