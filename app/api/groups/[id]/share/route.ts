import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSessionOr401 } from "@/lib/auth";
import {
  getGroupAnalyticsShareToken,
  setGroupAnalyticsShareToken,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newToken(): string {
  return randomBytes(18)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "");
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const token = await getGroupAnalyticsShareToken(chatId);
  return NextResponse.json({ token });
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // Idempotent generate: if a token already exists, return it.
  const existing = await getGroupAnalyticsShareToken(chatId);
  if (existing) return NextResponse.json({ token: existing });
  const token = newToken();
  await setGroupAnalyticsShareToken({ chatId, token });
  return NextResponse.json({ token });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await setGroupAnalyticsShareToken({ chatId, token: null });
  return NextResponse.json({ ok: true });
}
