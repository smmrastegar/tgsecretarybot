import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { generateRequestTriggerVariations } from "@/lib/classifier";
import { addRuleExample, audit, getMessageRule } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/rules/[id]/generate-variations
//   body: { trigger?: string; insert?: boolean }
// Generates AI paraphrases of the gate trigger. If insert=true (default
// false), each paraphrase is also written into rule_examples so the
// operator doesn't have to add them by hand.
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
    trigger?: string;
    insert?: boolean;
  };
  // Fall back to the rule's stored request_trigger if the caller
  // didn't pass one explicitly.
  let trigger = (body.trigger ?? "").trim();
  if (!trigger) {
    const rule = await getMessageRule(ruleId).catch(() => null);
    trigger = (rule?.requestTrigger ?? "").trim();
  }
  if (!trigger) {
    return NextResponse.json(
      { error: "ابتدا یه توصیف برای Gate وارد کن (مثلاً «کد بده»)." },
      { status: 400 },
    );
  }
  const variations = await generateRequestTriggerVariations({ trigger });
  if (variations.length === 0) {
    return NextResponse.json(
      { ok: false, error: "AI پاسخی برنگشت — یه بار دیگه امتحان کن." },
      { status: 500 },
    );
  }
  const insert = body.insert !== false; // default ON
  const inserted: number[] = [];
  if (insert) {
    for (const v of variations) {
      try {
        const ex = await addRuleExample({
          ruleId,
          text: v,
          label: "🤖 ساخته‌ی AI",
        });
        inserted.push(ex.id);
      } catch (err) {
        console.warn("[rule-paraphrase] insert failed:", err);
      }
    }
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "rule.paraphrase",
      target: String(ruleId),
      details: { trigger, count: inserted.length },
    });
  }
  return NextResponse.json({
    ok: true,
    variations,
    inserted,
  });
}
