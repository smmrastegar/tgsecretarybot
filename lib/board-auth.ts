import { NextResponse } from "next/server";
import { getChatIdByShareToken, getBoardMember, isAllowedUser } from "./db";
import { readSessionFromToken } from "./session";
import { getSettings } from "./settings";

// Auth for the editable board routes. NO anonymous access and NO shared
// code: the request must carry a signed session proving a verified
// Telegram identity (issued by /api/board/[token]/tg-login), AND that
// identity must be either the owner or an owner-approved member of THIS
// board. The URL share token scopes everything to a single chat_id.
export type BoardAuth = {
  chatId: number;
  chatTitle: string | null;
  actor: string;
  tgId: number;
  isOwner: boolean;
  boardColumns: string | null;
  boardPrompt: string | null;
  boardLabels: string | null;
  boardPriorities: string | null;
};

export function boardSessionDisplayName(s: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  userId: number;
}): string {
  const full = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
  if (full) return full.slice(0, 60);
  if (s.username) return `@${s.username}`.slice(0, 60);
  return `tg:${s.userId}`;
}

// Is this Telegram id an operator/owner (auto-approved on every board)?
export async function isBoardOwner(tgId: number): Promise<boolean> {
  if (await isAllowedUser(tgId).catch(() => false)) return true;
  const notify = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  if (notify && String(notify) === String(tgId)) return true;
  return false;
}

// Resolve the caller's session token from header or query.
async function sessionFromRequest(req: Request) {
  const url = new URL(req.url);
  const token =
    req.headers.get("x-board-session") ??
    url.searchParams.get("s") ??
    "";
  if (!token) return null;
  return readSessionFromToken(token);
}

export async function authBoard(
  req: Request,
  token: string,
): Promise<{ auth?: BoardAuth; error?: NextResponse }> {
  const chat = await getChatIdByShareToken(token).catch(() => null);
  if (!chat) {
    return { error: NextResponse.json({ error: "invalid token" }, { status: 404 }) };
  }
  const session = await sessionFromRequest(req);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: "login required", status: "anonymous" },
        { status: 401 },
      ),
    };
  }
  const actor = boardSessionDisplayName(session);
  const owner = await isBoardOwner(session.userId);
  if (!owner) {
    const member = await getBoardMember(chat.chatId, session.userId).catch(() => null);
    if (!member || member.status !== "approved") {
      return {
        error: NextResponse.json(
          { error: "not approved", status: member?.status ?? "none" },
          { status: 403 },
        ),
      };
    }
  }
  return {
    auth: {
      chatId: chat.chatId,
      chatTitle: chat.chatTitle,
      actor,
      tgId: session.userId,
      isOwner: owner,
      boardColumns: chat.boardColumns,
      boardPrompt: chat.boardPrompt,
      boardLabels: chat.boardLabels,
      boardPriorities: chat.boardPriorities,
    },
  };
}
