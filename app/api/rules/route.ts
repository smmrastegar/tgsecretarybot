import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  audit,
  createMessageRule,
  listMessageRules,
  listRuleRecipients,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const rules = await listMessageRules();
  const withCounts = await Promise.all(
    rules.map(async (r) => ({
      ...r,
      recipientCount: (await listRuleRecipients(r.id)).length,
    })),
  );
  return NextResponse.json({ rules: withCounts });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    forwardFormat?: string;
    enabled?: boolean;
  };
  if (!body.name?.trim() || !body.description?.trim()) {
    return NextResponse.json(
      { error: "name + description required" },
      { status: 400 },
    );
  }
  const rule = await createMessageRule({
    name: body.name.trim(),
    description: body.description.trim(),
    forwardFormat: body.forwardFormat?.trim() || null,
    enabled: body.enabled ?? true,
    createdBy: session.userId,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.create",
    target: String(rule.id),
    details: { name: rule.name },
  });
  return NextResponse.json({ ok: true, rule });
}
