import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  addRuleExample,
  audit,
  deleteRuleExample,
  listRuleExamples,
  type RuleExamplePurpose,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePurpose(v: string | null): RuleExamplePurpose | "all" {
  if (v === "gate_match") return "gate_match";
  if (v === "negative_match") return "negative_match";
  if (v === "all") return "all";
  return "rule_match";
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const purpose = parsePurpose(url.searchParams.get("purpose"));
  const examples = await listRuleExamples(ruleId, purpose);
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
    purpose?: RuleExamplePurpose;
  };
  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const purpose: RuleExamplePurpose =
    body.purpose === "gate_match"
      ? "gate_match"
      : body.purpose === "negative_match"
        ? "negative_match"
        : "rule_match";
  const ex = await addRuleExample({
    ruleId,
    text: body.text.trim(),
    label: body.label?.trim() || null,
    purpose,
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
