import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import { audit, listKnowledge, upsertKnowledge } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const entries = await listKnowledge();
  return NextResponse.json({ entries });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    aliases?: string[];
    body?: string;
    tags?: string[];
  };
  const title = (body.title ?? "").trim();
  const bodyText = (body.body ?? "").trim();
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
    : [];
  const tags = Array.isArray(body.tags)
    ? body.tags
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : [];
  const id = await upsertKnowledge({
    title,
    aliases,
    body: bodyText,
    tags,
    createdBy: session.userId,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "knowledge.create",
    target: String(id),
    details: { title, aliasCount: aliases.length, tagCount: tags.length },
  });
  return NextResponse.json({ ok: true, id });
}
