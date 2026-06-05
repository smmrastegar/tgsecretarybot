import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  bulkSetAutoSummarize,
  bulkSetChatAutomation,
  bulkSetChatFlag,
  bulkSetChatFunction,
  bulkSetChatMode,
  CHAT_MODES,
  FUNCTION_ROLES,
  type ChatMode,
  type FunctionRole,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    op?:
      | "mode"
      | "vip"
      | "muted"
      | "function"
      | "auto_summarize"
      | "automation";
    chatIds?: number[];
    mode?: ChatMode;
    value?: boolean;
    role?: FunctionRole | null;
    gapMinutes?: number;
    smartTiming?: boolean;
    automation?: {
      autoForwardVoice?: boolean;
      autoForwardVideo?: boolean;
      autoForwardPhoto?: boolean;
      autoForwardLocation?: boolean;
      autoExtractNotes?: boolean;
    };
  };
  const op = body.op;
  const chatIds = Array.isArray(body.chatIds)
    ? body.chatIds
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : [];
  if (!op || chatIds.length === 0) {
    return NextResponse.json(
      { error: "op + chatIds[] required" },
      { status: 400 },
    );
  }

  let affected = 0;
  if (op === "mode") {
    const m = body.mode;
    if (!m || !CHAT_MODES.includes(m)) {
      return NextResponse.json(
        { error: `mode required; allowed: ${CHAT_MODES.join(", ")}` },
        { status: 400 },
      );
    }
    affected = await bulkSetChatMode(chatIds, m);
  } else if (op === "vip" || op === "muted") {
    affected = await bulkSetChatFlag(chatIds, op, Boolean(body.value));
  } else if (op === "function") {
    const r = body.role;
    if (r != null && !(FUNCTION_ROLES as readonly string[]).includes(r)) {
      return NextResponse.json(
        {
          error: `role must be null or one of: ${FUNCTION_ROLES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    affected = await bulkSetChatFunction(chatIds, r ?? null);
  } else if (op === "auto_summarize") {
    const enabled = Boolean(body.value);
    const gap = Number(body.gapMinutes ?? 5);
    const smartTiming =
      body.smartTiming == null ? true : Boolean(body.smartTiming);
    affected = await bulkSetAutoSummarize(
      chatIds,
      enabled,
      Number.isFinite(gap) ? gap : 5,
      smartTiming,
    );
  } else if (op === "automation") {
    if (!body.automation) {
      return NextResponse.json(
        { error: "automation payload required" },
        { status: 400 },
      );
    }
    affected = await bulkSetChatAutomation(chatIds, body.automation);
  } else {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: `chats.bulk_${op}`,
    target: chatIds.length === 1 ? String(chatIds[0]) : null,
    details: {
      count: chatIds.length,
      affected,
      op,
      mode: body.mode,
      role: body.role,
      value: body.value,
      gapMinutes: body.gapMinutes,
    },
  });

  return NextResponse.json({ ok: true, affected });
}
