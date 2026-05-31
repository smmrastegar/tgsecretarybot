import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  audit,
  getMessageForTranscript,
  saveTranscript,
} from "@/lib/db";
import { sttConfigured, transcribeAudio } from "@/lib/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TRANSCRIBABLE_KINDS = new Set(["voice", "audio", "video_note", "video"]);

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
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const row = await getMessageForTranscript(messageId);
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }
  if (!row.mediaFileId) {
    return NextResponse.json(
      { error: "no media on this message" },
      { status: 400 },
    );
  }
  if (row.mediaKind && !TRANSCRIBABLE_KINDS.has(row.mediaKind)) {
    return NextResponse.json(
      { error: `cannot transcribe ${row.mediaKind}` },
      { status: 400 },
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as { language?: string };

  try {
    const result = await transcribeAudio({
      botToken: config.telegramBotToken,
      fileId: row.mediaFileId,
      language: body.language,
    });
    await saveTranscript(messageId, result.text);
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "message.transcribe",
      target: String(messageId),
      details: {
        provider: result.provider,
        durationSeconds: result.durationSeconds,
      },
    });
    return NextResponse.json({
      ok: true,
      transcript: result.text,
      durationSeconds: result.durationSeconds,
      provider: result.provider,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 500) },
      { status: 500 },
    );
  }
}
