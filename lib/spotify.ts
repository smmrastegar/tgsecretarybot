// Spotify account link (official OAuth, authorization-code flow): read
// the owner's playlists and liked songs so they can be queued into the
// personal library. Client id/secret come from the owner's own Spotify
// developer app; the refresh token is stored in settings.
import { randomBytes } from "node:crypto";
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
    const page: { items: Array<{ id: string; name: string; tracks?: { total: number }; owner?: { display_name?: string } } | null>; next: string | null } = await api(token, next);
    for (const p of page.items) if (p) out.push({ id: p.id, name: p.name, tracks: p.tracks?.total ?? 0, owner: p.owner?.display_name ?? "" });
    next = page.next;
  }
  return { playlists: out, likedCount: liked.total, me: me.display_name ?? me.id };
}

/** Track ids (+ names) of a playlist, or of the liked songs when id === "liked". */
export async function fetchTrackIds(accountId: number, id: string, max = 2000): Promise<Array<{ id: string; name: string }>> {
  const token = await accessToken(accountId);
  const out: Array<{ id: string; name: string }> = [];
  let next: string | null = id === "liked" ? "/me/tracks?limit=50" : `/playlists/${encodeURIComponent(id)}/tracks?limit=100`;
  while (next && out.length < max) {
    const page: { items: Array<{ track?: { id?: string | null; name?: string; is_local?: boolean; type?: string } | null }>; next: string | null } = await api(token, next);
    for (const it of page.items) {
      const t = it.track;
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
