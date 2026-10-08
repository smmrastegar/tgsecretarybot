// Private player links: /player/<token>. A token is 32 random bytes (256 bits,
// unguessable). There can be many links; each one is switched on/off on its own
// and is tied to its own set of playlists (manual or smart), so every link is a
// different player. Whoever holds a link can play that content and like/dislike —
// nothing else: adding, deleting, playlist building and the Spotify login stay
// behind the dashboard login. The original single link keeps working as the
// "Main link" (everything) until it is switched off.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getCurrentSession } from "./auth";
import { applyLinkView, findActiveLinkByToken, getAllSettings, listMusicTracks, setSetting, touchPlayerLink } from "./db";
import { resolvedPlaylists } from "./music-playlists";

const KEY = "musicPlayerToken";
const LEGACY_ACTIVE = "musicPlayerLegacyActive";

export const newLinkToken = () => randomBytes(32).toString("base64url");

/** The original link's token (created on first use). */
export async function getLegacyToken(): Promise<string> {
  const cur = ((await getAllSettings())[KEY] ?? "").trim();
  if (cur.length >= 40) return cur;
  const t = newLinkToken();
  await setSetting(KEY, t);
  return t;
}
export async function isLegacyActive(): Promise<boolean> { return ((await getAllSettings())[LEGACY_ACTIVE] ?? "1") !== "0"; }
export async function setLegacyActive(on: boolean): Promise<void> { await setSetting(LEGACY_ACTIVE, on ? "1" : "0"); }

export type MusicAccess =
  | { kind: "session" }
  | { kind: "link"; linkId: number; name: string; playlistIds: number[] | null }; // null = the whole library (Main link)

async function accessForToken(presented: string | null | undefined): Promise<MusicAccess | null> {
  const p = (presented ?? "").trim();
  if (p.length < 40) return null;
  const s = await getAllSettings();
  const legacy = (s[KEY] ?? "").trim();
  if (legacy.length === p.length && (s[LEGACY_ACTIVE] ?? "1") !== "0") {
    try { if (timingSafeEqual(Buffer.from(p), Buffer.from(legacy))) return { kind: "link", linkId: 0, name: "Main link", playlistIds: null }; } catch { /* fall through */ }
  }
  const link = await findActiveLinkByToken(p).catch(() => null);
  if (!link) return null;
  void touchPlayerLink(link.id).catch(() => {});
  return { kind: "link", linkId: link.id, name: link.name, playlistIds: link.playlistIds };
}

export async function isValidPlayerToken(presented: string | null | undefined): Promise<boolean> {
  return (await accessForToken(presented)) != null;
}

/** Who is asking: the dashboard session, or a player link (?t= / x-player-token). */
export async function musicAccess(request: Request): Promise<MusicAccess | null> {
  if (await getCurrentSession().catch(() => null)) return { kind: "session" };
  const url = new URL(request.url);
  return accessForToken(url.searchParams.get("t") ?? request.headers.get("x-player-token"));
}

/** Backwards-compatible boolean. */
export async function authorizeMusic(request: Request): Promise<boolean> {
  return (await musicAccess(request)) != null;
}

/** null = everything; otherwise the track ids this access may see (union of the link's playlists). */
const allowedCache = new Map<string, { at: number; ids: Set<number> }>();
export async function allowedTrackIds(access: MusicAccess): Promise<Set<number> | null> {
  if (access.kind === "session" || access.playlistIds == null) return null;
  // Cached for 20 s: this runs on every stream/cover request, and smart playlists are a computation.
  const key = `${access.linkId}:${access.playlistIds.join(",")}`;
  const hit = allowedCache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.ids;
  // Smart "liked" rules mean THIS link's likes.
  const tracks = await applyLinkView(await listMusicTracks(), access.linkId);
  const pls = await resolvedPlaylists(tracks);
  const ids = new Set<number>();
  for (const p of pls) if (access.playlistIds.includes(p.id)) for (const id of p.trackIds) ids.add(id);
  allowedCache.set(key, { at: Date.now(), ids });
  return ids;
}

export async function canAccessTrack(access: MusicAccess, trackId: number): Promise<boolean> {
  const allowed = await allowedTrackIds(access);
  return allowed == null || allowed.has(trackId);
}

// 404, not 401: a wrong token must not confirm that the endpoint exists.
export function notFound(): Response {
  return new Response("not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } });
}

/** One-liner for per-track routes: the access, or a 404 Response. */
export async function guardTrack(request: Request, trackId: number): Promise<{ access: MusicAccess } | { deny: Response }> {
  const access = await musicAccess(request);
  if (!access || !Number.isFinite(trackId) || !(await canAccessTrack(access, trackId))) return { deny: notFound() };
  return { access };
}
