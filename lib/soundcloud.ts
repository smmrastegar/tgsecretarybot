// SoundCloud, the counterpart of lib/spotify.ts: sign in with an account (OAuth 2.1 + PKCE), read its likes / playlists (or any public
// track / playlist link), queue the songs, and download the ones SoundCloud lets apps stream (the official API only — no scraping).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { addScTrack, nextScMetaTracks, recordScSources, setTrackMeta, getAllSettings, getScTokens, listMusicPlaylists, listScAccounts, nextScTrack, saveScTokens, savePkce, setPlaylistTrack, createMusicPlaylist, setSetting, takePkce, updateMusicTrack, upsertScAccount, type ScTrackIn } from "./db";
import { MUSIC_DIR } from "./music";
import { ffmpegPath } from "./music-analysis";
import { reportWarn } from "./report";

const API = "https://api.soundcloud.com";
const AUTH = "https://secure.soundcloud.com";
const SC_REDIRECT_DEFAULT = process.env.SOUNDCLOUD_REDIRECT_URI || "https://playlist.bz/soundcloud";
/** SoundCloud compares the redirect URI character for character (even the case of "https"), so it can be set to exactly what the app has registered (settings.soundcloudRedirectUri). */
export async function scRedirect(): Promise<string> { return ((await getAllSettings()).soundcloudRedirectUri ?? "").trim() || SC_REDIRECT_DEFAULT; }

export async function scConfig(): Promise<{ clientId: string; clientSecret: string }> {
  const s = await getAllSettings();
  return { clientId: (s.soundcloudClientId ?? "").trim(), clientSecret: (s.soundcloudClientSecret ?? "").trim() };
}
export async function saveScCredentials(id: string, secret: string): Promise<void> {
  await setSetting("soundcloudClientId", id.trim());
  if (secret.trim()) await setSetting("soundcloudClientSecret", secret.trim());
}

export class ScRateLimited extends Error { constructor() { super("SoundCloud is limiting requests right now"); } }

type TokenReply = { access_token: string; refresh_token?: string; expires_in?: number };
async function tokenCall(params: Record<string, string>): Promise<TokenReply> {
  const c = await scConfig();
  if (!c.clientId || !c.clientSecret) throw new Error("SoundCloud app credentials are not set");
  const r = await fetch(`${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=utf-8", Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ ...params, client_id: c.clientId, client_secret: c.clientSecret }).toString(), signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as TokenReply & { error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`soundcloud token ${r.status}: ${j.error_description ?? j.error ?? ""}`.trim());
  return j;
}

let appTok: { v: string; until: number } | null = null;
async function appToken(): Promise<string> {
  if (appTok && appTok.until > Date.now()) return appTok.v;
  const t = await tokenCall({ grant_type: "client_credentials" });
  appTok = { v: t.access_token, until: Date.now() + Math.max(60, (t.expires_in ?? 3600) - 120) * 1000 };
  return appTok.v;
}

/** A token for an account (refreshed when old), or the app's own token when no account is given. */
export async function scToken(accountId?: number | null): Promise<string> {
  if (!accountId) return appToken();
  const t = await getScTokens(accountId);
  if (!t) throw new Error("this SoundCloud account is not connected");
  if (t.fresh && t.access) return t.access;
  const n = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh });
  await saveScTokens(accountId, n.refresh_token ?? null, n.access_token, n.expires_in ?? 3600);
  return n.access_token;
}

// ---- sign-in (the state is a one-time nonce; its PKCE verifier lives in the database, never in the URL)
const stateKey = () => process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET_TOKEN || "dev-session-secret-change-me";
const sign = (nonce: string) => createHmac("sha256", stateKey()).update(`soundcloud-state:${nonce}`).digest("base64url");

export async function scAuthorizeUrl(host: string): Promise<string | null> {
  const c = await scConfig();
  if (!c.clientId) return null;
  const verifier = randomBytes(48).toString("base64url");
  const nonce = randomBytes(12).toString("base64url");
  await savePkce(nonce, verifier, host);
  const u = new URL(`${AUTH}/authorize`);
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", await scRedirect());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", `${nonce}.${sign(nonce)}`);
  return u.toString();
}

/** Finish the sign-in: returns the new account id and the host to send the browser back to. */
export async function scFinishSignIn(code: string, state: string): Promise<{ accountId: number; host: string }> {
  const [nonce, sig] = state.split(".");
  if (!nonce || !sig) throw new Error("bad state");
  const want = Buffer.from(sign(nonce)), have = Buffer.from(sig);
  if (want.length !== have.length || !timingSafeEqual(want, have)) throw new Error("bad state");
  const pk = await takePkce(nonce);
  if (!pk) throw new Error("sign-in expired");
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: await scRedirect(), code_verifier: pk.verifier });
  if (!t.refresh_token) throw new Error("no refresh token returned");
  const me = await scGet<{ urn?: string; id?: number; username?: string }>("/me", t.access_token);
  const urn = me.urn ?? `soundcloud:users:${me.id}`;
  return { accountId: await upsertScAccount(urn, me.username ?? null, t.refresh_token, t.access_token, t.expires_in ?? 3600), host: pk.host };
}

// ---- API
export async function scGet<T>(pathOrUrl: string, token: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
  const r = await fetch(url, { headers: { Authorization: `OAuth ${token}`, Accept: "application/json; charset=utf-8" }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 429) throw new ScRateLimited();
  const text = await r.text();
  if (!r.ok) { let m = text.slice(0, 160); try { const j = JSON.parse(text) as { message?: string; error?: string }; m = j.message ?? j.error ?? m; } catch { /* plain text */ } throw new Error(`soundcloud ${r.status}: ${m}`); }
  return JSON.parse(text) as T;
}

type RawTrack = { id: number; title?: string; duration?: number; permalink_url?: string; artwork_url?: string | null; created_at?: string; release_year?: number | null; user?: { username?: string; avatar_url?: string }; access?: string };
export function toScTrack(t: RawTrack): ScTrackIn | null {
  if (!t?.id || !t.title) return null;
  const date = (t.created_at ?? "").slice(0, 10).replace(/\//g, "-");
  const art = t.artwork_url ?? t.user?.avatar_url ?? null;
  return {
    scId: String(t.id), title: t.title.trim(), artist: t.user?.username ?? "SoundCloud", url: (t.permalink_url ?? "").split("?")[0] || `https://soundcloud.com/tracks/${t.id}`,
    durationS: t.duration ? Math.round(t.duration / 1000) : null, coverUrl: art ? art.replace(/-(large|crop|t\d+x\d+)\./, "-t500x500.") : null, releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  };
}

async function collect(first: string, token: string, max: number): Promise<RawTrack[]> {
  const out: RawTrack[] = [];
  let next: string | null = first;
  while (next && out.length < max) {
    const page: RawTrack[] | { collection?: RawTrack[]; next_href?: string | null } = await scGet(next, token);
    const items = Array.isArray(page) ? page : page.collection ?? [];
    out.push(...items);
    next = Array.isArray(page) ? null : page.next_href ?? null;
  }
  return out.slice(0, max);
}

export async function scLikes(accountId: number, max = 500): Promise<RawTrack[]> { return collect("/me/likes/tracks?limit=200&linked_partitioning=true", await scToken(accountId), max); }
export async function scPlaylists(accountId: number): Promise<Array<{ urn: string; title: string; tracks: number }>> {
  const list = await scGet<Array<{ urn?: string; id?: number; title?: string; track_count?: number }>>("/me/playlists?limit=100&show_tracks=false", await scToken(accountId));
  return list.filter((p) => p.title).map((p) => ({ urn: p.urn ?? `soundcloud:playlists:${p.id}`, title: p.title!, tracks: p.track_count ?? -1 }));
}
export async function scPlaylistTracks(accountId: number | null, urn: string, max = 500): Promise<RawTrack[]> { return collect(`/playlists/${urn}/tracks?limit=200&linked_partitioning=true`, await scToken(accountId), max); }

/** A pasted soundcloud.com link: one song, or a playlist / set. */
export async function scResolve(url: string, accountId: number | null): Promise<{ kind: "track"; track: RawTrack } | { kind: "playlist"; title: string; urn: string; tracks: RawTrack[] } | { kind: "user"; name: string; tracks: RawTrack[] }> {
  const token = await scToken(accountId);
  const o = await scGet<{ kind?: string; id?: number; urn?: string; title?: string; username?: string; tracks?: RawTrack[] }>(`/resolve?url=${encodeURIComponent(url)}`, token);
  // a profile link: that person's public likes (no sign-in needed)
  if (o.kind === "user" || (o.username && !o.title)) return { kind: "user", name: o.username ?? "SoundCloud", tracks: await collect(`/users/${o.urn ?? `soundcloud:users:${o.id}`}/likes/tracks?limit=200&linked_partitioning=true`, token, 500) };
  if (o.kind === "playlist" || o.tracks) return { kind: "playlist", title: o.title ?? "SoundCloud playlist", urn: o.urn ?? `soundcloud:playlists:${o.id}`, tracks: o.tracks?.length ? o.tracks : await scPlaylistTracks(accountId, o.urn ?? `soundcloud:playlists:${o.id}`) };
  if (o.kind === "track" || o.id) return { kind: "track", track: o as RawTrack };
  throw new Error("this link is not a SoundCloud song or playlist");
}

/** Queue tracks and mirror them into a library playlist. Returns counts. */
export async function scImport(tracks: RawTrack[], playlistName: string | null, accountId: number | null = null): Promise<{ total: number; added: number; already: number; removed: number; unavailable: number }> {
  const rep = { total: tracks.length, added: 0, already: 0, removed: 0, unavailable: 0 };
  let plId: number | null = null;
  if (playlistName) plId = (await listMusicPlaylists()).find((p) => p.name === playlistName && !p.rules)?.id ?? (await createMusicPlaylist(playlistName));
  const ids: number[] = [];
  for (const raw of tracks) {
    const t = toScTrack(raw);
    if (!t) continue;
    if (raw.access && raw.access !== "playable") { rep.unavailable++; continue; } // blocked / preview-only: SoundCloud does not let apps stream it
    const r = await addScTrack(t);
    if (r.removed) rep.removed++; else if (r.created) rep.added++; else rep.already++;
    if (plId && r.id) await setPlaylistTrack(plId, r.id, true);
    if (r.id) ids.push(r.id);
  }
  if (accountId) await recordScSources(accountId, ids);
  return rep;
}

// ---- downloading (official stream endpoints only)
async function saveCover(trackId: number, url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const p = path.join(MUSIC_DIR, `${trackId}.cover.jpg`);
    await fs.writeFile(p, Buffer.from(await r.arrayBuffer()));
    return p;
  } catch { return null; }
}

async function ffmpegSave(url: string, token: string, out: string): Promise<boolean> {
  return new Promise(async (resolve) => {
    const child = spawn(await ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-headers", `Authorization: OAuth ${token}\r\n`, "-i", url, "-vn", "-c", "copy", out], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60_000);
    child.on("close", (c) => { clearTimeout(timer); resolve(c === 0); });
    child.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}

async function downloadOne(t: { id: number; scId: string; coverUrl: string | null }): Promise<void> {
  const acc = (await listScAccounts())[0]?.id ?? null;
  const token = await scToken(acc);
  const urn = `soundcloud:tracks:${t.scId}`;
  const info = await scGet<RawTrack & { streamable?: boolean }>(`/tracks/${urn}`, token);
  if (info.access && info.access !== "playable") throw new Error(`SoundCloud does not let apps stream this song (access: ${info.access})`);
  const s = await scGet<Record<string, string>>(`/tracks/${urn}/streams`, token);
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  const http = s.http_mp3_128_url, hls = s.hls_mp3_128_url ?? s.hls_aac_160_url;
  const aac = !http && !s.hls_mp3_128_url && !!s.hls_aac_160_url;
  const ext = aac ? "m4a" : "mp3";
  const file = path.join(MUSIC_DIR, `${t.id}.${ext}`);
  let ok = false;
  if (http) {
    const r = await fetch(http, { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(5 * 60_000) });
    if (r.ok) { await fs.writeFile(file, Buffer.from(await r.arrayBuffer())); ok = true; }
  }
  if (!ok && hls) ok = await ffmpegSave(hls, token, file);
  const size = ok ? (await fs.stat(file).catch(() => null))?.size ?? 0 : 0;
  if (!ok || size < 10_000) { await fs.unlink(file).catch(() => {}); throw new Error("could not download the stream"); }
  const cover = await saveCover(t.id, (toScTrack(info)?.coverUrl ?? t.coverUrl) || "");
  await updateMusicTrack(t.id, { filePath: file, mime: aac ? "audio/mp4" : "audio/mpeg", sizeBytes: size, durationS: info.duration ? Math.round(info.duration / 1000) : null, coverPath: cover, status: "ready", error: null });
}

/** Cron step: download a couple of queued SoundCloud songs. Never throws. */
export async function soundcloudStep(max = 2): Promise<number> {
  const s = await getAllSettings();
  if (!(s.soundcloudClientId ?? "").trim()) return 0;
  if (Date.now() - Number(s.soundcloudStepLock || 0) < 100_000) return 0;
  await setSetting("soundcloudStepLock", String(Date.now()));
  let done = 0;
  try {
    for (; done < max; done++) {
      const t = await nextScTrack();
      if (!t) break;
      try { await downloadOne(t); }
      catch (e) {
        if (e instanceof ScRateLimited) { reportWarn("music", "SoundCloud rate limit: pausing downloads"); break; }
        await updateMusicTrack(t.id, { status: "failed", error: `SoundCloud: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` });
      }
    }
  } catch (err) { reportWarn("music", "soundcloud step failed:", err); }
  finally { await setSetting("soundcloudStepLock", "0"); }
  return done;
}

/** Cron step: clean the names of a few SoundCloud songs against Spotify (auto when sure, "review" for the owner otherwise). Never throws. */
export async function scMetaStep(max = 5): Promise<number> {
  const s = await getAllSettings();
  if (Date.now() < Number(s.scMetaPauseUntil || 0)) return 0;
  if (Date.now() - Number(s.scMetaLock || 0) < 150_000) return 0;
  await setSetting("scMetaLock", String(Date.now()));
  let done = 0;
  try {
    const { resolveSc } = await import("./music-resolve");
    const { SpotifyRateLimited } = await import("./spotify");
    for (const t of await nextScMetaTracks(max)) {
      try {
        const fix = await resolveSc(t.title, t.artist);
        if (fix.state === "review") await setTrackMeta(t.id, { state: "review", suggestions: fix.suggestions });
        else await setTrackMeta(t.id, { title: fix.title, artist: fix.artist, state: "auto" });
        done++;
      } catch (e) {
        if (e instanceof SpotifyRateLimited) { await setSetting("scMetaPauseUntil", String(Date.now() + (e.retryAfterSeconds + 5) * 1000)); break; }
        reportWarn("music", `soundcloud names for track ${t.id} failed:`, e);
        await setTrackMeta(t.id, { state: "review", suggestions: [] }); // the owner sorts it out
        done++;
      }
    }
  } catch (err) { reportWarn("music", "soundcloud name step failed:", err); }
  finally { await setSetting("scMetaLock", "0"); }
  return done;
}
