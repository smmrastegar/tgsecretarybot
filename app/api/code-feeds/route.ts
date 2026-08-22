import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSession } from "@/lib/auth";
import {
  listCodeFeeds,
  upsertCodeFeed,
  deleteCodeFeed,
  audit,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireSession();
  const feeds = await listCodeFeeds();
  return NextResponse.json({ ok: true, feeds });
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  const b = (await request.json().catch(() => ({}))) as {
    id?: number;
    label?: string;
    chatId?: number | string;
    windowSeconds?: number;
    format?: string;
    codesOnly?: boolean;
    allowedIps?: string;
    enabled?: boolean;
  };
  const label = (b.label ?? "").toString().trim();
  const chatId = Number(b.chatId);
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  if (!Number.isFinite(chatId) || chatId === 0) {
    return NextResponse.json({ error: "valid chatId required" }, { status: 400 });
  }
  const windowSeconds = Math.min(
    Math.max(Number(b.windowSeconds ?? 300) || 300, 10),
    86400,
  );
  const format = ["json", "text", "codes"].includes(String(b.format))
    ? String(b.format)
    : "json";
  const id = await upsertCodeFeed({
    id: b.id,
    // Long random token; only generated on create so an edit keeps the URL.
    token: randomBytes(24).toString("base64url"),
    label,
    chatId,
    windowSeconds,
    format,
    codesOnly: b.codesOnly !== false,
    allowedIps: String(b.allowedIps ?? "")
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean),
    enabled: b.enabled !== false,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: b.id ? "code_feed.update" : "code_feed.create",
  }).catch(() => {});
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await deleteCodeFeed(id);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "code_feed.delete",
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
