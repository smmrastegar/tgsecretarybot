import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  audit,
  deleteKnowledge,
  getKnowledge,
  upsertKnowledge,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const entry = await getKnowledge(entryId);
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ entry });
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const existing = await getKnowledge(entryId);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    aliases?: string[];
    body?: string;
    tags?: string[];
  };
  const title =
    typeof body.title === "string" ? body.title.trim() : existing.title;
  const bodyText =
    typeof body.body === "string" ? body.body.trim() : existing.body;
  if (!title || !bodyText) {
    return NextResponse.json(
      { error: "title and body required" },
      { status: 400 },
    );
  }
  const aliases = Array.isArray(body.aliases)
    ? body.aliases
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : existing.aliases;
  const tags = Array.isArray(body.tags)
    ? body.tags
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : existing.tags;
  await upsertKnowledge({
    id: entryId,
    title,
    aliases,
    body: bodyText,
    tags,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "knowledge.update",
    target: String(entryId),
    details: { title, aliasCount: aliases.length, tagCount: tags.length },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteKnowledge(entryId);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "knowledge.delete",
    target: String(entryId),
  });
  return NextResponse.json({ ok: true });
}
