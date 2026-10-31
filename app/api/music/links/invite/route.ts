import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { createInviteLink, findLinkByTgUser, listPlayerLinks } from "@/lib/db";
import { newLinkToken } from "@/lib/music-token";
import { DIRECT_ACCOUNT, parseTelegramWho } from "@/lib/music-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appUrl = () => (process.env.PLAYER_APP_URL || "https://playlist.bz").replace(/\/$/, "");

// POST { who, name?, scope: "direct" | "all" | "playlists", playlistIds?, canEdit?, canLike? } → an invitation for ONE Telegram account.
// The person opens the invite link, confirms with Telegram, and is in — no approval — with exactly these settings.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { who?: string; name?: string; scope?: string; playlistIds?: number[]; canEdit?: boolean; canLike?: boolean };
  const who = parseTelegramWho(String(b.who ?? ""));
  if (!who) return NextResponse.json({ error: "یک @username یا شناسهٔ عددی تلگرام بنویس" }, { status: 400 });
  if (who.tgUserId != null && (await findLinkByTgUser(who.tgUserId))) return NextResponse.json({ error: "این اکانت از قبل لینک دارد؛ همان را در فهرست پایین تنظیم کن" }, { status: 409 });
  if (who.username && (await listPlayerLinks()).some((l) => l.inviteUsername === who.username && !l.inviteClaimed)) return NextResponse.json({ error: "برای این @username دعوت‌نامهٔ باز وجود دارد" }, { status: 409 });
  const scope = b.scope === "all" || b.scope === "playlists" ? b.scope : "direct";
  const playlistIds = scope === "playlists" && Array.isArray(b.playlistIds) ? b.playlistIds.map(Number).filter(Number.isFinite) : [];
  if (scope === "playlists" && playlistIds.length === 0) return NextResponse.json({ error: "حداقل یک پلی‌لیست انتخاب کن" }, { status: 400 });
  const label = String(b.name ?? "").trim() || (who.username ? `@${who.username}` : `tg:${who.tgUserId}`);
  const link = await createInviteLink(who, newLinkToken(), newLinkToken(), {
    name: label, playlistIds, allLibrary: scope !== "playlists",
    accountIds: scope === "direct" ? [DIRECT_ACCOUNT.id] : [], accountsMode: "any", canEdit: b.canEdit === true, canLike: b.canLike === true,
  });
  return NextResponse.json({ id: link.id, inviteUrl: `${appUrl()}/listen?invite=${link.inviteToken}` });
}
