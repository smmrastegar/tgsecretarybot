import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { generateMessageVariations } from "@/lib/classifier";
import { addRuleExample, audit, getMessageRule } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/rules/[id]/generate-examples  body: { sample: string }
// From ONE pasted example message, generate realistic variations and
// save them as positive (rule_match) examples — the same "write a text,
// click, get many examples" flow the gate section has, but for the
// forward-match examples instead of the gate phrasings.
const AI_LABEL = "🤖 ساخته‌ی AI";

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
  const body = (await request.json().catch(() => ({}))) as { sample?: string };
  const sample = (body.sample ?? "").trim();
  if (!sample) {
    return NextResponse.json(
      { error: "یه نمونه پیام بنویس تا ازش نمونه‌های بیشتر بسازم." },
      { status: 400 },
    );
  }
  const rule = await getMessageRule(ruleId).catch(() => null);
  const variations = await generateMessageVariations({
    sample,
    ruleDescription: rule?.description,
  });
  if (variations.length === 0) {
    return NextResponse.json(
      { ok: false, error: "AI پاسخی برنگشت — یه بار دیگه امتحان کن." },
      { status: 500 },
    );
  }
  const inserted: number[] = [];
  for (const v of variations) {
    try {
      const ex = await addRuleExample({
        ruleId,
        text: v,
        label: AI_LABEL,
        purpose: "rule_match",
      });
      inserted.push(ex.id);
    } catch (err) {
      console.warn("[rule-example-gen] insert failed:", err);
    }
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.example_generate",
    target: String(ruleId),
    details: { inserted: inserted.length },
  });
  return NextResponse.json({ ok: true, variations, inserted });
}
