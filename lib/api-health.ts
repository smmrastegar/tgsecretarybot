// Spotify / SoundCloud health: every call is counted (ok / limited / error) and a cheap probe runs every few hours, so a rate limit or a
// broken credential shows up in the metrics and the music dashboard instead of being found by accident.
import { bumpApiHealth, getAllSettings, setSetting, type ApiOutcome, type ApiProvider } from "./db";
import { reportWarn } from "./report";

/** Count one call. Never throws and never waits for the database. */
export function noteApi(provider: ApiProvider, outcome: ApiOutcome, info?: { retryAfterS?: number; error?: string }): void {
  void bumpApiHealth(provider, outcome, info).catch(() => {});
}

/** HTTP status → outcome. 2xx / 3xx are fine, 429 is "limited", 401/403 and 5xx are errors worth counting; other 4xx are the caller's own mistakes. */
export function outcomeOf(status: number): ApiOutcome | null {
  if (status === 429) return "limited";
  if (status >= 200 && status < 400) return "ok";
  if (status === 401 || status === 403 || status >= 500) return "error";
  return null;
}

export type ProbeResult = { provider: ApiProvider; ok: boolean; status: number | null; detail: string; retryAfterS?: number };

/** One real call per provider with the app's own credentials (no user needed). */
export async function probeApis(): Promise<ProbeResult[]> {
  const s = await getAllSettings();
  const out: ProbeResult[] = [];
  const sp = (s.spotifyCatalogClientId && s.spotifyCatalogClientSecret) ? { id: s.spotifyCatalogClientId, secret: s.spotifyCatalogClientSecret } : { id: s.spotifyClientId ?? "", secret: s.spotifyClientSecret ?? "" };
  if (sp.id && sp.secret) {
    try {
      const t = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${sp.id}:${sp.secret}`).toString("base64")}` }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(15_000) });
      const tj = (await t.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
      if (!t.ok || !tj.access_token) out.push({ provider: "spotify", ok: false, status: t.status, detail: `token: ${tj.error_description ?? t.status}` });
      else {
        const r = await fetch("https://api.spotify.com/v1/search?type=artist&limit=1&q=a", { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15_000) });
        out.push({ provider: "spotify", ok: r.ok, status: r.status, detail: r.ok ? "search ok" : `search ${r.status}`, retryAfterS: r.status === 429 ? Number(r.headers.get("retry-after") ?? 0) || undefined : undefined });
      }
    } catch (e) { out.push({ provider: "spotify", ok: false, status: null, detail: String(e instanceof Error ? e.message : e).slice(0, 120) }); }
  }
  if ((s.soundcloudClientId ?? "").trim() && (s.soundcloudClientSecret ?? "").trim()) {
    try {
      const t = await fetch("https://secure.soundcloud.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=utf-8", Authorization: `Basic ${Buffer.from(`${s.soundcloudClientId}:${s.soundcloudClientSecret}`).toString("base64")}` }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: s.soundcloudClientId ?? "", client_secret: s.soundcloudClientSecret ?? "" }).toString(), signal: AbortSignal.timeout(15_000) });
      const tj = (await t.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
      if (!t.ok || !tj.access_token) out.push({ provider: "soundcloud", ok: false, status: t.status, detail: `token: ${tj.error_description ?? tj.error ?? t.status}` });
      else {
        const r = await fetch("https://api.soundcloud.com/resolve?url=" + encodeURIComponent("https://soundcloud.com/soundcloud"), { headers: { Authorization: `OAuth ${tj.access_token}`, Accept: "application/json; charset=utf-8" }, signal: AbortSignal.timeout(15_000) });
        out.push({ provider: "soundcloud", ok: r.ok, status: r.status, detail: r.ok ? "resolve ok" : `resolve ${r.status}`, retryAfterS: r.status === 429 ? Number(r.headers.get("retry-after") ?? 0) || undefined : undefined });
      }
    } catch (e) { out.push({ provider: "soundcloud", ok: false, status: null, detail: String(e instanceof Error ? e.message : e).slice(0, 120) }); }
  }
  return out;
}

const PROBE_EVERY_MS = 6 * 3600_000;

/** Cron step: probe both providers every 6 h, count the outcome, and warn (once per change) when one is limited or broken. */
export async function apiProbeStep(): Promise<ProbeResult[]> {
  const s = await getAllSettings();
  if (Date.now() - Number(s.apiProbeAt || 0) < PROBE_EVERY_MS) return [];
  await setSetting("apiProbeAt", String(Date.now()));
  const res = await probeApis();
  for (const r of res) {
    const o = r.ok ? "ok" : r.status === 429 ? "limited" : "error";
    noteApi(r.provider, o, { retryAfterS: r.retryAfterS, error: r.ok ? undefined : r.detail });
    const key = `apiProbe_${r.provider}`;
    const was = s[key] ?? "ok";
    if (o !== was) {
      await setSetting(key, o);
      if (o === "ok") reportWarn("music", `${r.provider} API is healthy again`);
      else reportWarn("music", `${r.provider} API ${o === "limited" ? `is rate-limiting us${r.retryAfterS ? ` (${Math.round(r.retryAfterS / 3600)} h)` : ""}` : "failed"}: ${r.detail}`);
    }
  }
  return res;
}
