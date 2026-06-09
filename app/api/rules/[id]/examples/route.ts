import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addRuleExample,
  audit,
  deleteRuleExample,
  listRuleExamples,
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const examples = await listRuleExamples(ruleId);
  return NextResponse.json({ examples });
}

export async function POST(
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    label?: string;
  };
  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const ex = await addRuleExample({
    ruleId,
    text: body.text.trim(),
    label: body.label?.trim() || null,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.example_add",
    target: String(ruleId),
    details: { exampleId: ex.id },
  });
  return NextResponse.json({ ok: true, example: ex });
}

export async function DELETE(
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const exampleId = Number(url.searchParams.get("exampleId"));
  if (!Number.isFinite(exampleId)) {
    return NextResponse.json({ error: "?exampleId required" }, { status: 400 });
  }
  await deleteRuleExample(exampleId);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.example_remove",
    target: String(ruleId),
    details: { exampleId },
  });
  return NextResponse.json({ ok: true });
}
