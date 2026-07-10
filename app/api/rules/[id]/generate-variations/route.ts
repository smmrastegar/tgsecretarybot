import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { generateRequestTriggerVariations } from "@/lib/classifier";
import {
  addRuleExample,
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
//   body: { trigger?: string; mode?: "append" | "replace" }
// Generates AI paraphrases of the gate trigger description and inserts
// each as a rule_example with purpose='gate_match' so they show up in
// the Gate-side example list (not the OTP-carrier list).
//
// mode=replace (default): delete existing AI-labeled gate examples
// first, then insert the new batch — keeps the list from snowballing
// each click. mode=append: keep existing, just add the new ones.
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
    mode?: "append" | "replace";
  };
  const mode = body.mode === "append" ? "append" : "replace";

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
  // Persist the trigger onto the rule itself. Operators used to type
  // the trigger, click "generate", get examples saved — and leave the
  // page without hitting ذخیره, so request_trigger stayed NULL and the
  // gate silently ran OFF (codes forwarded to everyone immediately).
  if ((rule?.requestTrigger ?? "").trim() !== trigger) {
    await updateMessageRule(ruleId, { requestTrigger: trigger }).catch(
      (err) => console.warn("[rule-paraphrase] trigger persist failed:", err),
    );
  }

  // Cleanup: delete misplaced rule_match-labeled AI rows from the old
  // implementation. Always runs, even on mode=append, because those
  // rows cause false OTP matches that break the rule entirely.
  const oldMatchRows = await listRuleExamples(ruleId, "rule_match").catch(
    () => [],
  );
  const cleanedMisplaced: number[] = [];
  for (const ex of oldMatchRows) {
    if (ex.label === AI_EXAMPLE_LABEL) {
      try {
        await deleteRuleExample(ex.id);
        cleanedMisplaced.push(ex.id);
      } catch (err) {
        console.warn("[rule-paraphrase] misplaced cleanup failed:", err);
      }
    }
  }

  // On replace mode, also drop existing AI-labeled gate_match rows so
  // we don't accumulate duplicates across clicks.
  const replacedIds: number[] = [];
  if (mode === "replace") {
    const existing = await listRuleExamples(ruleId, "gate_match").catch(
      () => [],
    );
    for (const ex of existing) {
      if (ex.label === AI_EXAMPLE_LABEL) {
        try {
          await deleteRuleExample(ex.id);
          replacedIds.push(ex.id);
        } catch (err) {
          console.warn("[rule-paraphrase] replace cleanup failed:", err);
        }
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

  const inserted: number[] = [];
  for (const v of variations) {
    try {
      const ex = await addRuleExample({
        ruleId,
        text: v,
        label: AI_EXAMPLE_LABEL,
        purpose: "gate_match",
      });
      inserted.push(ex.id);
    } catch (err) {
      console.warn("[rule-paraphrase] gate insert failed:", err);
    }
  }

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.paraphrase",
    target: String(ruleId),
    details: {
      mode,
      inserted: inserted.length,
      replaced: replacedIds.length,
      cleanedMisplaced: cleanedMisplaced.length,
    },
  });

  return NextResponse.json({
    ok: true,
    variations,
    inserted,
    replaced: replacedIds,
    cleanedMisplaced,
  });
}
