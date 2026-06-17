import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getNoteWatchItem,
  hasRecentNoteWatchMatch,
  listNoteWatchAliases,
} from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { scanForWatchlistConceptsDebug } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Diagnostic endpoint: paste a message body, get back the full
// decision tree — what gates fired, what the LLM said, whether the
// validator dropped it, and what the cooldown would do. Powers the
// "🧪 تست" button on each concept card so the operator can verify a
// concept actually matches without having to send Telegram messages
// and stare at logs.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    chatId?: number;
  };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const item = await getNoteWatchItem(itemId);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const aliasRows = await listNoteWatchAliases(itemId);
  const aliases = aliasRows.map((a) => a.alias);
  const settings = await getSettings();
  const minLen = Math.max(
    Number(settings.notesWatchlistMinMessageLength) || 0,
    0,
  );
  const globalCooldownMin = Math.max(
    Number(settings.notesWatchlistCooldownMinutes) || 0,
    0,
  );
  const effectiveCooldownMin =
    item.cooldownOverrideMinutes ?? globalCooldownMin;
  const masterEnabled =
    (settings.notesWatchlistEnabled ?? "true").toLowerCase() !== "false";

  const gates = {
    masterEnabled,
    minLen,
    textLen: text.length,
    passesLength: text.length >= minLen,
    itemEnabled: item.enabled,
    forwardToInbox: item.forwardToInbox,
    forwardDefault:
      (settings.notesWatchlistForwardToInbox ?? "true").toLowerCase() !==
      "false",
    cooldownMin: effectiveCooldownMin,
  };

  if (!masterEnabled) {
    return NextResponse.json({
      ok: true,
      verdict: "skipped",
      reason:
        "Master switch is off — /notes → تنظیمات → AI Watchlist → فعال بودن سکنر",
      gates,
    });
  }
  if (!item.enabled) {
    return NextResponse.json({
      ok: true,
      verdict: "skipped",
      reason: "این concept الان غیرفعاله — تیک enabled رو روشن کن.",
      gates,
    });
  }
  if (text.length < minLen) {
    return NextResponse.json({
      ok: true,
      verdict: "skipped",
      reason: `طول پیام (${text.length}) از حداقل (${minLen}) کمتره — این پیام اصلاً اسکن نمی‌شه.`,
      gates,
    });
  }

  // Optional: cooldown preview. If chatId is supplied, check whether
  // a real send to that chat would be silently swallowed.
  let cooldownActive: boolean | null = null;
  if (body.chatId && Number.isFinite(body.chatId) && effectiveCooldownMin > 0) {
    cooldownActive = await hasRecentNoteWatchMatch({
      itemId,
      chatId: Number(body.chatId),
      withinMinutes: effectiveCooldownMin,
    }).catch(() => null);
  }

  const debug = await scanForWatchlistConceptsDebug({
    text,
    items: [
      {
        id: item.id,
        concept: item.concept,
        description: item.description,
        aliases,
      },
    ],
  });
  if (debug.llmFailed) {
    return NextResponse.json({
      ok: false,
      verdict: "llm_failed",
      reason: "LLM call failed — budget / network / API key issue.",
      gates,
      debug,
    });
  }
  if (debug.llmRaw.length === 0) {
    return NextResponse.json({
      ok: true,
      verdict: "no_llm_match",
      reason:
        "LLM گفت match نیست. توضیح concept یا alias‌ها رو واضح‌تر کن.",
      gates,
      cooldownActive,
      debug,
    });
  }
  if (debug.finalMatches.length === 0) {
    return NextResponse.json({
      ok: true,
      verdict: "validator_dropped",
      reason:
        "LLM match داد ولی validator رد کرد — concept یا alias کامل توی متن (whole word) نیست. " +
        "alias دقیق‌تری اضافه کن یا concept رو ساده‌تر کن.",
      gates,
      cooldownActive,
      debug,
    });
  }
  if (cooldownActive === true) {
    return NextResponse.json({
      ok: true,
      verdict: "would_be_cooled_down",
      reason: `Match می‌شه ولی cooldown ${effectiveCooldownMin}m روی این chat فعاله — پیام واقعی silently skip می‌شه. cooldown رو کاهش بده یا صبر کن.`,
      gates,
      cooldownActive,
      debug,
    });
  }
  return NextResponse.json({
    ok: true,
    verdict: "match",
    reason: "✅ Match کامل — پیام واقعی به notes_inbox میره.",
    gates,
    cooldownActive,
    debug,
  });
}
