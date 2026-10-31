import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { allowedTrackIds, canSpotifyLike, musicAccess, notFound } from "@/lib/music-token";
import { resolvedPlaylists } from "@/lib/music-playlists";
import { addMusicTrack, applyLinkView, listMusicTracks, listScAccountEntries, listSpotifyAccounts, listTrackSources, parseSpotifyTrackUrl } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";
import { reportError } from "@/lib/report";
import { DIRECT_ACCOUNT } from "@/lib/music-scope";
import { getAccountCodes } from "@/lib/music-account-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  try {
    const base = await listMusicTracks();
    // A link sees its own likes, plays and skips (Main link: its own plays, the shared likes).
    const all = access.kind === "link" ? await applyLinkView(base, access.linkId) : base;
    const [pls, allowed] = await Promise.all([resolvedPlaylists(all), allowedTrackIds(access)]);
    // A player link only ever sees its own playlists and the songs in them.
    const tracks = allowed ? all.filter((t) => allowed.has(t.id)) : all;
    const lists = access.kind === "link" && access.playlistIds ? pls.filter((p) => access.playlistIds!.includes(p.id)) : pls;
    const playlists = lists.map((p) => ({ id: p.id, name: p.name, trackIds: allowed ? p.trackIds.filter((id) => allowed.has(id)) : p.trackIds, smart: p.smart, ...(access.kind === "session" && !access.scope ? { rules: p.rules } : {}) }));
    // Every view (dashboard and all player links, by the owner's choice) says which Spotify account(s) each song came from.
    {
      const [src, accts, scAccts, codes] = await Promise.all([listTrackSources(), listSpotifyAccounts(), listScAccountEntries(), getAccountCodes()]);
      // A scoped link only learns about the accounts it is scoped to.
      const scope = access.scope;
      const keep = (id: number) => !scope || scope.ids.includes(id);
      return NextResponse.json({
        canLike: canSpotifyLike(access),
        canEdit: access.kind === "link" ? access.canEdit : !access.scope,
        tracks: tracks.map((t) => ({ ...t, sources: (src.get(t.id) ?? []).filter(keep) })), playlists,
        accounts: [...accts.filter((a) => keep(a.id)).map((a) => ({ id: a.id, name: a.displayName ?? a.spotifyUserId })), ...scAccts.filter((a) => keep(a.id)), ...(keep(0) && tracks.some((t) => !(src.get(t.id)?.length)) ? [DIRECT_ACCOUNT] : [])]
          .map((a) => (codes[String(a.id)] ? { ...a, code: codes[String(a.id)] } : a)),
      });
    }
    return NextResponse.json({ tracks, playlists });
  } catch (err) {
    reportError("music", "list failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// POST { text }: any text containing Spotify track links (one or many).
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const links = [...new Set((String(body.text ?? "").match(/https?:\/\/open\.spotify\.com\/\S+/g) ?? []))];
  let added = 0, existing = 0, unsupported = 0, removed = 0;
  for (const l of links.slice(0, 100)) {
    const p = parseSpotifyTrackUrl(l);
    if (!p) { unsupported++; continue; }
    const r = await addMusicTrack(p.id, p.url);
    if (r.removed) removed++; else if (r.created) added++; else existing++;
  }
  if (added > 0) await kickMusicQueue().catch(() => {});
  return NextResponse.json({ added, existing, unsupported, removed });
}
