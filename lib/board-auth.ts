import { NextResponse } from "next/server";
import { getChatIdByShareToken } from "./db";

// Shared auth for the editable board routes. NO anonymous access: the
// request must carry the board's shared access code, and (for writes)
// an actor name that goes into the audit log. The URL share token
// scopes to a single chat_id.
export type BoardAuth = {
  chatId: number;
  chatTitle: string | null;
  actor: string;
  boardColumns: string | null;
  boardPrompt: string | null;
};

export async function authBoard(
  req: Request,
  token: string,
): Promise<{ auth?: BoardAuth; error?: NextResponse }> {
  const chat = await getChatIdByShareToken(token).catch(() => null);
  if (!chat) {
    return { error: NextResponse.json({ error: "invalid token" }, { status: 404 }) };
  }
  const url = new URL(req.url);
  const code = (req.headers.get("x-board-code") ?? url.searchParams.get("code") ?? "").trim();
  if (!chat.boardCode) {
    return {
      error: NextResponse.json(
        { error: "board not configured — operator must set an access code" },
        { status: 403 },
      ),
    };
  }
  if (code !== chat.boardCode) {
    return { error: NextResponse.json({ error: "wrong code" }, { status: 401 }) };
  }
  const actor = (req.headers.get("x-board-actor") ?? "").toString().trim().slice(0, 60);
  return {
    auth: {
      chatId: chat.chatId,
      chatTitle: chat.chatTitle,
      actor,
      boardColumns: chat.boardColumns,
      boardPrompt: chat.boardPrompt,
    },
  };
}
