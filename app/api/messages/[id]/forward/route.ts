import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import { audit, hasDb, sql } from "@/lib/db";
import { getSecretaries } from "@/lib/secretaries";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

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
  const { id } = await ctx.params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    secretaryUserId?: number;
    note?: string;
  };
  const settings = await getSettings();
  const secList = getSecretaries(settings);
  if (secList.length === 0) {
    return NextResponse.json(
      { error: "no secretaries configured" },
      { status: 400 },
    );
  }
  const target =
    secList.find((s) => s.userId === Number(body.secretaryUserId)) ?? secList[0];
  if (!target) {
    return NextResponse.json({ error: "secretary not found" }, { status: 400 });
  }

  const rows = await sql()`
    SELECT chat_id, sender_name, message_text, business_connection_id
    FROM messages_log WHERE id = ${messageId} LIMIT 1`;
  const row = rows[0] as
    | {
        chat_id: number;
        sender_name: string;
        message_text: string;
        business_connection_id: string;
      }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const bot = getBot();
  const ownerLabel =
    settings.ownerDisplayName || settings.ownerName || "the owner";
  const intro =
    `📨 Forwarded by ${ownerLabel} for ${target.name}\n` +
    `From: ${row.sender_name}\n` +
    `Original chat id: ${row.chat_id}\n` +
    (body.note ? `Note: ${body.note}\n` : "") +
    `\n${row.message_text.slice(0, 3500)}`;

  try {
    await bot.api.sendMessage(target.userId, intro);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          `Couldn't DM secretary ${target.name} (${target.userId}). Ask them to /start the bot first. ${String(err).slice(0, 200)}`,
      },
      { status: 500 },
    );
  }

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "message.forward",
    target: String(messageId),
    details: { to: target.userId, name: target.name },
  });
  return NextResponse.json({ ok: true });
}
