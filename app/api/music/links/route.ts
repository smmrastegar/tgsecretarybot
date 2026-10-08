import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { config } from "@/lib/config";
import { createPlayerLink, listPlayerLinks } from "@/lib/db";
import { getLegacyToken, isLegacyActive, newLinkToken } from "@/lib/music-token";
import { resolvedPlaylists } from "@/lib/music-playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = (t: string) => `${(config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "")}/player/${t}`;

// GET → every player link (the original "Main link" first) + the playlists they can be given.
export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const [links, pls] = await Promise.all([listPlayerLinks(), resolvedPlaylists()]);
  return NextResponse.json({
    links: [
      { id: 0, name: "Main link (everything)", url: url(await getLegacyToken()), active: await isLegacyActive(), playlistIds: null, legacy: true, canCreate: true, createdAt: null, lastUsedAt: null },
      ...links.map((l) => ({ id: l.id, name: l.name, url: url(l.token), active: l.active, playlistIds: l.playlistIds, legacy: false, canCreate: l.canCreate, createdAt: l.createdAt, lastUsedAt: l.lastUsedAt })),
    ],
    playlists: pls.map((p) => ({ id: p.id, name: p.name, smart: p.smart, count: p.trackIds.length })),
  }, { headers: { "Cache-Control": "no-store" } });
}

// POST { name, playlistIds } → a NEW link. Existing links are never touched.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { name?: string; playlistIds?: number[] };
  const name = String(b.name ?? "").trim() || `Link ${new Date().toISOString().slice(0, 10)}`;
  const link = await createPlayerLink(name, newLinkToken(), Array.isArray(b.playlistIds) ? b.playlistIds.map(Number) : []);
  return NextResponse.json({ id: link.id, url: url(link.token) });
}
