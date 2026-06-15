import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addSecretaryRelayRecipient,
  removeSecretaryRelayRecipient,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
    recipientChatId?: number | string;
    label?: string;
  };
  const recipientChatId = Number(body.recipientChatId);
  if (!Number.isFinite(recipientChatId) || recipientChatId === 0) {
    return NextResponse.json(
      { error: "recipientChatId required" },
      { status: 400 },
    );
  }
  await addSecretaryRelayRecipient({
    relayId,
    recipientChatId,
    label: body.label?.trim() || null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
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
  const url = new URL(request.url);
  const recipientChatId = Number(url.searchParams.get("recipientChatId"));
  if (!Number.isFinite(recipientChatId) || recipientChatId === 0) {
    return NextResponse.json(
      { error: "recipientChatId required" },
      { status: 400 },
    );
  }
  await removeSecretaryRelayRecipient({ relayId, recipientChatId });
  return NextResponse.json({ ok: true });
}
