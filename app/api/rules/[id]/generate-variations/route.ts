import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { generateRequestTriggerVariations } from "@/lib/classifier";
import {
  audit,
  deleteRuleExample,
  getMessageRule,
  listRuleExamples,
  updateMessageRule,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/rules/[id]/generate-variations
//   body: { trigger?: string }
// Generates AI paraphrases of the gate trigger and APPENDS them to
// the rule's request_trigger description (newline-separated so the
// gate LLM sees them as additional examples of what to recognise).
//
// IMPORTANT: paraphrases must NOT be inserted as rule_examples —
// rule_examples matches OTP-carrier messages (the messages we want
// to FORWARD). Adding "کد بده" as a rule_example caused the bot to
// match the OPERATOR'S own asking message and forward it back as a
// fake OTP. The current run also cleans up any examples that earlier
// labeled themselves "🤖 ساخته‌ی AI" so the rule recovers.
const AI_EXAMPLE_LABEL = "🤖 ساخته‌ی AI";

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
  };
  let trigger = (body.trigger ?? "").trim();
  const rule = await getMessageRule(ruleId).catch(() => null);
  if (!trigger) {
    trigger = (rule?.requestTrigger ?? "").trim();
  }
  if (!trigger) {
    return NextResponse.json(
      { error: "ابتدا یه توصیف برای Gate وارد کن (مثلاً «کد بده»)." },
      { status: 400 },
    );
  }
  // Clean up old mistakenly-added rule examples (from the previous
  // version of this endpoint).
  const existing = await listRuleExamples(ruleId).catch(() => []);
  const cleanedExamples: number[] = [];
  for (const ex of existing) {
    if (ex.label === AI_EXAMPLE_LABEL) {
      try {
        await deleteRuleExample(ex.id);
        cleanedExamples.push(ex.id);
      } catch (err) {
        console.warn("[rule-paraphrase] cleanup delete failed:", err);
      }
    }
  }

  const variations = await generateRequestTriggerVariations({ trigger });
  if (variations.length === 0) {
    return NextResponse.json(
      { ok: false, error: "AI پاسخی برنگشت — یه بار دیگه امتحان کن." },
      { status: 500 },
    );
  }

  // Build the new trigger text: original description (without
  // previous AI block) + newline-separated paraphrases under a
  // marker so the operator can see / re-edit them.
  const MARKER = "\n\n--- مثال‌های AI ---\n";
  const trimmedTrigger = trigger.split(MARKER)[0]!.trim();
  const newTrigger =
    trimmedTrigger + MARKER + variations.map((v) => `- ${v}`).join("\n");

  await updateMessageRule(ruleId, { requestTrigger: newTrigger });

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.paraphrase",
    target: String(ruleId),
    details: {
      count: variations.length,
      cleanedExamples: cleanedExamples.length,
    },
  });

  return NextResponse.json({
    ok: true,
    variations,
    cleanedExamples,
    newTrigger,
  });
}
