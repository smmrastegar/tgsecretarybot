import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  getChatRule,
  ownerTypedMessages,
  saveToneProfile,
} from "@/lib/db";
import { extractToneProfile } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const rule = await getChatRule(chatId);
  if (!rule) {
    return NextResponse.json(
      { error: "no rule for this chat yet — send/receive a message first" },
      { status: 400 },
    );
  }
  const ownerMessages = await ownerTypedMessages(chatId, 300);
  if (ownerMessages.length < 3) {
    return NextResponse.json(
      {
        error:
          "Not enough owner-typed messages in this chat yet to fine-tune. Reply manually a few times first.",
      },
      { status: 400 },
    );
  }
  const senderName =
    rule.nickname ||
    [rule.firstName, rule.lastName].filter(Boolean).join(" ").trim() ||
    rule.chatTitle ||
    "the other person";

  const profile = await extractToneProfile({
    senderName,
    ownerMessages,
    chatId,
  });
  if (!profile) {
    return NextResponse.json(
      { error: "tone extraction failed (model returned empty)" },
      { status: 502 },
    );
  }
  const lines: string[] = [];
  if (profile.tone) lines.push(profile.tone);
  if (profile.language) lines.push(`Primary language: ${profile.language}`);
  if (profile.do.length > 0)
    lines.push(`DO:\n• ${profile.do.join("\n• ")}`);
  if (profile.dont.length > 0)
    lines.push(`DON'T:\n• ${profile.dont.join("\n• ")}`);
  const toneText = lines.join("\n\n");
  await saveToneProfile(chatId, toneText);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.tone_fine_tune",
    target: String(chatId),
    details: { samples: ownerMessages.length, language: profile.language },
  });
  return NextResponse.json({
    ok: true,
    toneProfile: toneText,
    sampleCount: ownerMessages.length,
  });
}
