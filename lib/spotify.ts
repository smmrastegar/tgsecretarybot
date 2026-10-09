// Spotify account link (official OAuth, authorization-code flow): read
// the owner's playlists and liked songs so they can be queued into the
// personal library. Client id/secret come from the owner's own Spotify
// developer app; the refresh token is stored in settings.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { deleteSpotifyAccount, getAllSettings, getSpotifyRefreshToken, listSpotifyAccounts, setSetting, setSpotifyRefreshToken, upsertSpotifyAccount } from "./db";

export const SCOPES = "user-library-read playlist-read-private playlist-read-collaborative";

export function redirectUri(): string {
  return `${(config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "")}/api/music/spotify/callback`;
}

export async function getSpotifyConfig(): Promise<{ clientId: string; clientSecret: string }> {
  const s = await getAllSettings();
  return {
    clientId: (s.spotifyClientId ?? "").trim(),
    clientSecret: (s.spotifyClientSecret ?? "").trim(),
  };
}

export async function saveSpotifyCredentials(clientId: string, clientSecret: string): Promise<void> {
  await setSetting("spotifyClientId", clientId.trim());
  if (clientSecret.trim()) await setSetting("spotifyClientSecret", clientSecret.trim());
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

// The sign-in can start on one host (playlist.bz) and come back on another (the redirect URI registered
// with Spotify is bot.text.bz), where the starting browser's cookies do not exist. So the state itself
// carries the host to return to and is signed (only a signed-in session can obtain one) and short-lived.
const RETURN_HOSTS = new Set(["bot.text.bz", "playlist.bz", "www.playlist.bz"]);
const stateKey = () => process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET_TOKEN || "dev-session-secret-change-me";
const sign = (body: string) => createHmac("sha256", stateKey()).update(`spotify-state:${body}`).digest("base64url");

export function signedState(host: string | null): string {
  const h = host && RETURN_HOSTS.has(host) ? host : "bot.text.bz";
  const body = Buffer.from(JSON.stringify({ h, n: randomBytes(8).toString("base64url"), e: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The host to send the browser back to, or null when the state is forged, altered or expired. */
export function readSignedState(state: string): { host: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body)), have = Buffer.from(sig);
  if (want.length !== have.length || !timingSafeEqual(want, have)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString()) as { h?: string; e?: number };
    if (!j.h || !RETURN_HOSTS.has(j.h) || typeof j.e !== "number" || j.e < Date.now()) return null;
    return { host: j.h };
  } catch { return null; }
}

export async function authorizeUrl(state: string): Promise<string | null> {
  const c = await getSpotifyConfig();
  if (!c.clientId) return null;
  const u = new URL("https://accounts.spotify.com/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  u.searchParams.set("show_dialog", "true");
  return u.toString();
}

async function tokenCall(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const c = await getSpotifyConfig();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `spotify token ${res.status}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token };
}

/** Finish a login: store (or refresh) this account's token. Returns its id. */
export async function exchangeCode(code: string): Promise<number> {
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("no refresh token returned");
  const me = await api<{ id: string; display_name?: string }>(t.access_token, "/me");
  return upsertSpotifyAccount(me.id, me.display_name ?? null, t.refresh_token);
}

async function accessToken(accountId: number): Promise<string> {
  const refresh = await getSpotifyRefreshToken(accountId);
  if (!refresh) throw new Error("این حساب اسپاتیفای وصل نیست");
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh });
  if (t.refresh_token) await setSpotifyRefreshToken(accountId, t.refresh_token);
  return t.access_token;
}

async function api<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `https://api.spotify.com/v1${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) throw new Error("اسپاتیفای موقتاً محدودت کرده (429)؛ چند دقیقه بعد دوباره امتحان کن");
  if (!res.ok) throw new Error(`spotify ${res.status}`);
  return (await res.json()) as T;
}

export type SpotifyPlaylist = { id: string; name: string; tracks: number; owner: string };

export async function listMyPlaylists(accountId: number): Promise<{ playlists: SpotifyPlaylist[]; likedCount: number; me: string }> {
  const token = await accessToken(accountId);
  const me = await api<{ display_name?: string; id: string }>(token, "/me");
  const liked = await api<{ total: number }>(token, "/me/tracks?limit=1");
  const out: SpotifyPlaylist[] = [];
  let next: string | null = "/me/playlists?limit=50";
  while (next && out.length < 500) {
    // Spotify's 2026 API revision renamed the playlist's `tracks` object to `items`;
    // accept both, and report -1 ("unknown") rather than a false 0.
    const page: { items: Array<{ id: string; name: string; tracks?: { total: number }; items?: { total: number }; owner?: { display_name?: string } } | null>; next: string | null } = await api(token, next);
    for (const p of page.items) if (p) out.push({ id: p.id, name: p.name, tracks: p.items?.total ?? p.tracks?.total ?? -1, owner: p.owner?.display_name ?? "" });
    next = page.next;
  }
  // Unknown counts: ask each playlist for its total (new /items endpoint, then the old /tracks).
  const unknown = out.filter((p) => p.tracks < 0);
  for (let i = 0; i < unknown.length; i += 8) {
    await Promise.all(unknown.slice(i, i + 8).map(async (p) => {
      for (const ep of ["items", "tracks"]) {
        try { p.tracks = (await api<{ total: number }>(token, `/playlists/${encodeURIComponent(p.id)}/${ep}?limit=1`)).total; return; } catch { /* next endpoint */ }
      }
    }));
  }
  return { playlists: out, likedCount: liked.total, me: me.display_name ?? me.id };
}

/** Track ids (+ names) of a playlist, or of the liked songs when id === "liked". */
export async function fetchTrackIds(accountId: number, id: string, max = 2000): Promise<Array<{ id: string; name: string }>> {
  const token = await accessToken(accountId);
  const out: Array<{ id: string; name: string }> = [];
  // The playlist endpoint moved from /tracks to /items (and `track` → `item`) in
  // Spotify's 2026 revision: try the new one first, fall back to the old.
  type Trk = { id?: string | null; name?: string; is_local?: boolean; type?: string } | null;
  type Page = { items: Array<{ track?: Trk; item?: Trk }>; next: string | null };
  let next: string | null = id === "liked" ? "/me/tracks?limit=50" : `/playlists/${encodeURIComponent(id)}/items?limit=100`;
  while (next && out.length < max) {
    let page: Page;
    try { page = await api<Page>(token, next); }
    catch (e) {
      if (id !== "liked" && out.length === 0 && next.includes("/items?")) { next = `/playlists/${encodeURIComponent(id)}/tracks?limit=100`; continue; }
      throw e;
    }
    for (const it of page.items) {
      const t = it.item ?? it.track;
      if (t?.id && !t.is_local && (t.type ?? "track") === "track") out.push({ id: t.id, name: t.name ?? "" });
    }
    next = page.next;
  }
  return out;
}

export async function disconnectSpotify(accountId: number): Promise<void> {
  await deleteSpotifyAccount(accountId);
}

export { listSpotifyAccounts };

/** Token for public catalogue data (no user): client-credentials grant. */
export async function appToken(): Promise<string> {
  const t = await tokenCall({ grant_type: "client_credentials" });
  return t.access_token;
}

export type SpotifyTrackMeta = {
  id: string; title: string; artist: string; album: string; releaseDate: string | null; durationS: number; coverUrl: string | null;
};

type RawTrack = { id: string; name: string; duration_ms: number; artists: Array<{ name: string }>; album: { name: string; release_date?: string; images?: Array<{ url: string; width: number }> } };

function toMeta(t: RawTrack): SpotifyTrackMeta {
  const img = [...(t.album.images ?? [])].sort((a, b) => b.width - a.width).find((x) => x.width <= 700) ?? t.album.images?.[0];
  return { id: t.id, title: t.name, artist: t.artists.map((a) => a.name).join(", "), album: t.album.name, releaseDate: t.album.release_date ?? null, durationS: Math.round(t.duration_ms / 1000), coverUrl: img?.url ?? null };
}

async function spGet(token: string, url: string): Promise<{ status: number; json: unknown; message: string; retryAfter: number }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  const message = (json as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 160);
  return { status: res.status, json, message, retryAfter: Number(res.headers.get("retry-after") ?? 0) || 0 };
}

export class SpotifyRateLimited extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`spotify 429, retry after ${retryAfterSeconds}s`);
  }
}

/**
 * One-track metadata reader. Spotify disabled the batch endpoint for
 * app tokens (403), so tracks are read one by one: app token first,
 * then a linked user account. Throws SpotifyRateLimited on 429 so the
 * caller can pause instead of hammering the API.
 */
export async function makeMetaFetcher(): Promise<(id: string) => Promise<SpotifyTrackMeta | null>> {
  const appTok = await appToken();
  let userTok: string | null = null;
  return async (id: string) => {
    let r = await spGet(appTok, `https://api.spotify.com/v1/tracks/${id}`);
    if (r.status === 403 || r.status === 401) {
      if (userTok == null) {
        const accounts = await listSpotifyAccounts();
        userTok = accounts[0] ? await accessToken(accounts[0].id).catch(() => "") : "";
      }
      if (userTok) r = await spGet(userTok, `https://api.spotify.com/v1/tracks/${id}`);
    }
    if (r.status === 429) throw new SpotifyRateLimited(r.retryAfter || 30);
    if (r.status === 200) return toMeta(r.json as RawTrack);
    console.log(`[music] track ${id}: ${r.status} ${r.message}`);
    return null;
  };
}

// ---- artist genres (public catalogue data, app token) ----

let genreTok: { v: string; until: number } | null = null;

/** Genres of a track's (first two) artists, e.g. ["persian pop","iranian pop"]. Often empty for small artists. */
export async function fetchTrackArtistGenres(spotifyTrackId: string): Promise<{ genres: string[]; artists: string[] }> {
  if (!genreTok || genreTok.until < Date.now()) genreTok = { v: await appToken(), until: Date.now() + 50 * 60 * 1000 };
  const tok = genreTok.v;
  const t = await spGet(tok, `https://api.spotify.com/v1/tracks/${spotifyTrackId}`);
  if (t.status === 429) throw new SpotifyRateLimited(t.retryAfter || 30);
  if (t.status !== 200) return { genres: [], artists: [] };
  const arts = ((t.json as { artists?: Array<{ id?: string; name?: string }> }).artists ?? []).filter((a) => a.id).slice(0, 2);
  const genres = new Set<string>();
  for (const a of arts) {
    const r = await spGet(tok, `https://api.spotify.com/v1/artists/${a.id}`);
    if (r.status === 429) throw new SpotifyRateLimited(r.retryAfter || 30);
    if (r.status === 200) for (const g of (r.json as { genres?: string[] }).genres ?? []) genres.add(g.toLowerCase());
  }
  return { genres: [...genres], artists: arts.map((a) => a.name ?? "") };
}
