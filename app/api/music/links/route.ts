import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { createPlayerLink, getAllSettings, listPlayerLinks, listScAccountEntries, listSpotifyAccounts } from "@/lib/db";
import { getLegacyToken, getMainScope, isLegacyActive, newLinkToken } from "@/lib/music-token";
import { DIRECT_ACCOUNT } from "@/lib/music-scope";
import { resolvedPlaylists } from "@/lib/music-playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Player links live on their own domain (playlist.bz); PLAYER_APP_URL overrides it.
const url = (t: string) => `${(process.env.PLAYER_APP_URL || "https://playlist.bz").replace(/\/$/, "")}/player/${t}`;

// GET → every player link (the original "Main link" first) + the playlists they can be given.
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const [links, pls, accts, mainScope] = await Promise.all([listPlayerLinks(), resolvedPlaylists(), listSpotifyAccounts(), getMainScope()]);
  const scAccts = await listScAccountEntries();
  return NextResponse.json({
    links: [
      { id: 0, name: "Main link (everything)", url: url(await getLegacyToken()), active: await isLegacyActive(), playlistIds: null, legacy: true, canCreate: true, canLike: (await getAllSettings()).musicMainCanLike !== "0", canEdit: (await getAllSettings()).musicMainCanEdit !== "0", accountIds: mainScope?.ids ?? [], accountsMode: mainScope?.mode ?? "any", createdAt: null, lastUsedAt: null },
      ...links.map((l) => ({ id: l.id, name: l.name, url: url(l.token), active: l.active, playlistIds: l.allLibrary ? null : l.playlistIds, allLibrary: l.allLibrary, tgLabel: l.tgLabel, legacy: false, canCreate: l.canCreate, canLike: l.canLikeSpotify, canEdit: l.canEdit, accountIds: l.accountIds, accountsMode: l.accountsMode, createdAt: l.createdAt, lastUsedAt: l.lastUsedAt })),
    ],
    tgSignup: (await getAllSettings()).musicTgSignup !== "0",
    accounts: [...accts.map((a) => ({ id: a.id, name: a.displayName ?? a.spotifyUserId })), ...scAccts, DIRECT_ACCOUNT],
    playlists: pls.map((p) => ({ id: p.id, name: p.name, smart: p.smart, count: p.trackIds.length })),
  }, { headers: { "Cache-Control": "no-store" } });
}

// POST { name, playlistIds } → a NEW link. Existing links are never touched.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { name?: string; playlistIds?: number[] };
  const name = String(b.name ?? "").trim() || `Link ${new Date().toISOString().slice(0, 10)}`;
  const link = await createPlayerLink(name, newLinkToken(), Array.isArray(b.playlistIds) ? b.playlistIds.map(Number) : []);
  return NextResponse.json({ id: link.id, url: url(link.token) });
}
