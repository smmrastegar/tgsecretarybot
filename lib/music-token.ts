// Private player links: /player/<token>. A token is 32 random bytes (256 bits,
// unguessable). There can be many links; each one is switched on/off on its own
// and is tied to its own set of playlists (manual or smart), so every link is a
// different player. Whoever holds a link can play that content and like/dislike —
// nothing else: adding, deleting, playlist building and the Spotify login stay
// behind the dashboard login. The original single link keeps working as the
// "Main link" (everything) until it is switched off.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getCurrentSession } from "./auth";
import { applyLinkView, findActiveLinkByToken, getAllSettings, listMusicTracks, listTrackSources, setSetting, touchPlayerLink } from "./db";
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

/** "Only songs from these Spotify accounts" — enforced on the server for a link, not just hidden in the UI. */
export type AccountScope = { ids: number[]; mode: "any" | "all" };
export type MusicAccess =
  | { kind: "session" }
  | { kind: "link"; linkId: number; name: string; playlistIds: number[] | null; canCreate: boolean; scope: AccountScope | null }; // playlistIds null = the whole library (Main link)

const MAIN_SCOPE = "musicMainScope";
export function parseScope(raw: unknown): AccountScope | null {
  try {
    const j = (typeof raw === "string" ? JSON.parse(raw) : raw) as { ids?: unknown; mode?: unknown } | null;
    const ids = Array.isArray(j?.ids) ? [...new Set(j!.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))] : [];
    return ids.length ? { ids, mode: j?.mode === "all" ? "all" : "any" } : null;
  } catch { return null; }
}
export async function getMainScope(): Promise<AccountScope | null> { return parseScope((await getAllSettings())[MAIN_SCOPE]); }
export async function setMainScope(s: AccountScope | null): Promise<void> { await setSetting(MAIN_SCOPE, s ? JSON.stringify(s) : ""); }
const inScope = (scope: AccountScope, have: number[]) => (scope.mode === "all" ? scope.ids.every((a) => have.includes(a)) : scope.ids.some((a) => have.includes(a)));

async function accessForToken(presented: string | null | undefined): Promise<MusicAccess | null> {
  const p = (presented ?? "").trim();
  if (p.length < 40) return null;
  const s = await getAllSettings();
  const legacy = (s[KEY] ?? "").trim();
  if (legacy.length === p.length && (s[LEGACY_ACTIVE] ?? "1") !== "0") {
    try { if (timingSafeEqual(Buffer.from(p), Buffer.from(legacy))) return { kind: "link", linkId: 0, name: "Main link", playlistIds: null, canCreate: true, scope: parseScope(s[MAIN_SCOPE]) }; } catch { /* fall through */ }
  }
  const link = await findActiveLinkByToken(p).catch(() => null);
  if (!link) return null;
  void touchPlayerLink(link.id).catch(() => {});
  return { kind: "link", linkId: link.id, name: link.name, playlistIds: link.playlistIds, canCreate: link.canCreate, scope: link.accountIds.length ? { ids: link.accountIds, mode: link.accountsMode } : null };
}

export async function isValidPlayerToken(presented: string | null | undefined): Promise<boolean> {
  return (await accessForToken(presented)) != null;
}

/** Who is asking: the dashboard session, or a player link (?t= / x-player-token). */
export async function musicAccess(request: Request): Promise<MusicAccess | null> {
  // A player link in the URL always wins, even if this browser is also logged into the dashboard:
  // otherwise the owner testing a link would silently see the whole library with dashboard rights.
  const url = new URL(request.url);
  const presented = url.searchParams.get("t") ?? request.headers.get("x-player-token");
  if (presented) return accessForToken(presented);
  if (await getCurrentSession().catch(() => null)) return { kind: "session" };
  return null;
}

/** Backwards-compatible boolean. */
export async function authorizeMusic(request: Request): Promise<boolean> {
  return (await musicAccess(request)) != null;
}

/** null = everything; otherwise the track ids this access may see (union of the link's playlists). */
const allowedCache = new Map<string, { at: number; ids: Set<number> }>();
export async function allowedTrackIds(access: MusicAccess): Promise<Set<number> | null> {
  if (access.kind === "session" || (access.playlistIds == null && !access.scope)) return null;
  // Cached for 20 s: this runs on every stream/cover request, and smart playlists are a computation.
  const key = `${access.linkId}:${access.playlistIds?.join(",") ?? "*"}:${access.scope ? `${access.scope.mode}${access.scope.ids.join(",")}` : ""}`;
  const hit = allowedCache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.ids;
  const tracks = await applyLinkView(await listMusicTracks(), access.linkId);
  let ids: Set<number>;
  if (access.playlistIds) {
    // Smart "liked" rules mean THIS link's likes.
    const pls = await resolvedPlaylists(tracks);
    ids = new Set<number>();
    for (const p of pls) if (access.playlistIds.includes(p.id)) for (const id of p.trackIds) ids.add(id);
  } else ids = new Set(tracks.map((t) => t.id));
  if (access.scope) {
    const src = await listTrackSources();
    for (const id of [...ids]) if (!inScope(access.scope, src.get(id) ?? [])) ids.delete(id);
  }
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
