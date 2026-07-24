import { NextResponse } from "next/server";
import {
  BOARD_STATUSES,
  DEFAULT_BOARD_COLUMNS,
  logBoardEvent,
  parseBoardColumns,
  setBoardConfig,
} from "@/lib/db";
import { authBoard } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read the current board configuration (column labels/colours + the
// operator's AI-categorisation prompt).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  return NextResponse.json({
    ok: true,
    columns: parseBoardColumns(auth!.boardColumns),
    prompt: auth!.boardPrompt ?? "",
  });
}

// Update column labels/colours and/or the AI-categorisation prompt.
// Requires a logged-in actor; every change is written to the audit log.
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    columns?: Array<{ key?: string; label?: string; color?: string }>;
    prompt?: string;
  };

  const before = parseBoardColumns(auth!.boardColumns);
  const beforePrompt = auth!.boardPrompt ?? "";

  let columnsArg: string | undefined;
  const changed: string[] = [];

  if (Array.isArray(body.columns)) {
    // Only the four fixed status keys are honoured; labels are clamped
    // and colours must be valid hex (parseBoardColumns re-validates on read).
    const byKey = new Map(
      body.columns
        .filter((c) => c && typeof c.key === "string")
        .map((c) => [c.key as string, c]),
    );
    const merged = DEFAULT_BOARD_COLUMNS.map((d) => {
      const incoming = byKey.get(d.key);
      const cur = before.find((b) => b.key === d.key)!;
      const label = (incoming?.label ?? cur.label).toString().trim().slice(0, 40) || d.label;
      const color = /^#[0-9a-fA-F]{3,8}$/.test(incoming?.color ?? "")
        ? incoming!.color!
        : cur.color;
      return { key: d.key, label, color };
    });
    columnsArg = JSON.stringify(merged);
    for (const m of merged) {
      const cur = before.find((b) => b.key === m.key)!;
      if (m.label !== cur.label) changed.push(`«${cur.label}» → «${m.label}»`);
      else if (m.color !== cur.color) changed.push(`رنگ «${m.label}»`);
    }
  }

  let promptArg: string | null | undefined;
  if (typeof body.prompt === "string") {
    const p = body.prompt.trim().slice(0, 2000);
    promptArg = p || null;
    if ((p || "") !== beforePrompt) changed.push("پرامپت دسته‌بندی هوش مصنوعی");
  }

  if (columnsArg === undefined && promptArg === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await setBoardConfig({
    chatId: auth!.chatId,
    columns: columnsArg,
    prompt: promptArg,
  });

  if (changed.length > 0) {
    await logBoardEvent({
      chatId: auth!.chatId,
      taskId: null,
      action: "config",
      actor: auth!.actor,
      summary: `⚙️ تنظیمات برد: ${changed.join("، ")}`,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    columns: parseBoardColumns(columnsArg ?? auth!.boardColumns),
    prompt: promptArg === undefined ? beforePrompt : (promptArg ?? ""),
    statuses: BOARD_STATUSES,
  });
}
