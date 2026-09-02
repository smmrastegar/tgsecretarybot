import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  addSecretaryRelaySource,
  removeSecretaryRelaySource,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const relayId = Number(id);
  if (!Number.isFinite(relayId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    sourceChatId?: number | string;
    label?: string;
  };
  const sourceChatId = Number(body.sourceChatId);
  if (!Number.isFinite(sourceChatId) || sourceChatId === 0) {
    return NextResponse.json(
      { error: "sourceChatId required" },
      { status: 400 },
    );
  }
  await addSecretaryRelaySource({
    relayId,
    sourceChatId,
    label: body.label?.trim() || null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const relayId = Number(id);
  if (!Number.isFinite(relayId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const sourceChatId = Number(url.searchParams.get("sourceChatId"));
  if (!Number.isFinite(sourceChatId) || sourceChatId === 0) {
    return NextResponse.json(
      { error: "sourceChatId required" },
      { status: 400 },
    );
  }
  await removeSecretaryRelaySource({ relayId, sourceChatId });
  return NextResponse.json({ ok: true });
}
