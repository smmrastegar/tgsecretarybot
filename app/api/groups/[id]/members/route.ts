import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listGroupMembersFromMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/groups/[id]/members?format=csv | json
// Returns every distinct sender the bot has seen in this group, with
// numeric Telegram user_id, @username, display name, message count,
// and first/last seen timestamps. format=csv (default) streams as a
// downloadable file; format=json returns the same as a JSON array.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const members = await listGroupMembersFromMessages(chatId);

  if (format === "json") {
    return NextResponse.json({ ok: true, chatId, members });
  }

  // CSV with a UTF-8 BOM so Excel + Numbers open Persian names correctly.
  const escape = (v: string | number | null | undefined): string => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [
    "user_id,username,name,status,is_bot,is_premium,message_count,first_seen_at,last_seen_at",
  ];
  for (const m of members) {
    lines.push(
      [
        m.senderId,
        m.senderUsername ? "@" + m.senderUsername : "",
        m.senderName,
        m.status ?? "",
        m.isBot ? "true" : "false",
        m.isPremium ? "true" : "false",
        m.messageCount,
        m.firstSeenAt?.toISOString() ?? "",
        m.lastSeenAt?.toISOString() ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }
  const body = "﻿" + lines.join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="group-${chatId}-members.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
