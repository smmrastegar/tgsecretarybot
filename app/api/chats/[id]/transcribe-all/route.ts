import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { audit, hasDb, saveTranscript, sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { sttConfigured, transcribeAudio } from "@/lib/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 5 min — bulk transcribe of a chat with many voice messages
// can take a while.
export const maxDuration = 300;

const TRANSCRIBABLE_KINDS = ["voice", "audio", "video_note"] as const;

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
  if (!hasDb()) {
    return NextResponse.json({ error: "db not configured" }, { status: 500 });
  }
  if (!sttConfigured()) {
    return NextResponse.json(
      {
        error:
          "Transcription is not configured (needs OPENROUTER_API_KEY or GROQ_API_KEY).",
      },
      { status: 503 },
    );
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    language?: string;
    limit?: number;
  };
  const limit = Math.min(Math.max(Number(body.limit ?? 30), 1), 100);

  const settings = await getSettings();
  const language =
    body.language && body.language.trim()
      ? body.language.trim()
      : settings.sttLanguage || "fa";

  // Pull every untranscribed voice/audio/video_note message in this
  // chat. Newest first so the most-relevant ones get done within
  // maxDuration if the bulk run hits the limit.
  const rows = (await sql()`
    SELECT id, media_file_id, media_kind
    FROM messages_log
    WHERE chat_id = ${chatId}
      AND media_file_id IS NOT NULL
      AND media_kind = ANY(${TRANSCRIBABLE_KINDS as readonly string[]}::text[])
      AND transcript IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}`) as Array<{
    id: string;
    media_file_id: string;
    media_kind: string;
  }>;

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const result = await transcribeAudio({
        botToken: config.telegramBotToken,
        fileId: r.media_file_id,
        language,
      });
      await saveTranscript(Number(r.id), result.text);
      done++;
    } catch (err) {
      console.error(`[bulk transcribe] msg=${r.id} failed:`, err);
      failed++;
    }
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.bulk_transcribe",
    target: String(chatId),
    details: { candidates: rows.length, done, failed, language },
  });
  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    done,
    failed,
  });
}
