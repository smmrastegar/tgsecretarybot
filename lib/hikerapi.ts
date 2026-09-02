// HikerAPI (https://hikerapi.com) — paid Instagram scraper. We never
// touch Instagram directly; HikerAPI hides the auth dance and returns
// CDN URLs that Telegram can ingest via sendPhoto / sendVideo.
//
// Auth: header `x-access-key: <HIKER_API_KEY>`.
//
// We deliberately keep paths in one place + handle response variance
// (sometimes the API returns `pk` as string, sometimes int; stories
// can have `video_url` xor an image_versions2 ladder). The helpers
// normalise everything to {id, mediaUrl, mediaType, takenAt,
// permalink, caption}.

import { config } from "./config";
import { reportWarn } from "./report";
import { assertBudget, HikerApprovalNeededError, recordCall } from "./hikerapi-budget";
import { getSettings } from "./settings";
import { getTenant } from "./tenant";
import { getCurrentTenantId } from "./tenant-context";

export { HikerApprovalNeededError };

// Resolution order:
//   1. tenant.hiker_api_key (per-tenant override, via context)
//   2. settings.hikerApiKeyOverride (global UI override)
//   3. config.hikerApiKey (env HIKER_API_KEY)
// Empty / missing values fall through to the next layer.
export async function getActiveKey(): Promise<{
  key: string | null;
  source: "tenant" | "db" | "env" | null;
  name: string | null;
}> {
  const tenantId = getCurrentTenantId();
  if (tenantId != null) {
    try {
      const t = await getTenant(tenantId);
      const tkey = (t?.hikerApiKey ?? "").trim();
      if (tkey) {
        return {
          key: tkey,
          source: "tenant",
          name: t?.hikerApiKeyName ?? null,
        };
      }
    } catch {
      // tenant lookup failed → fall through to global.
    }
  }
  let dbKey = "";
  let name = "";
  try {
    const s = await getSettings();
    dbKey = (s.hikerApiKeyOverride ?? "").trim();
    name = (s.hikerApiKeyName ?? "").trim();
  } catch {}
  if (dbKey) return { key: dbKey, source: "db", name: name || null };
  if (config.hikerApiKey)
    return { key: config.hikerApiKey, source: "env", name: name || null };
  return { key: null, source: null, name: name || null };
}

export function maskKey(key: string | null): string | null {
  if (!key) return null;
  return `${key.slice(0, 5)}…${key.slice(-3)} (${key.length} chars)`;
}

export type IGUser = {
  id: string;
  username: string;
  fullName: string | null;
  profilePicUrl: string | null;
  // Used as a cheap "did anything change since last tick?" signal —
  // if mediaCount matches our stored last_media_count, we skip the
  // expensive posts/reels/mentioned fetches entirely.
  mediaCount: number | null;
};

export type IGMedia = {
  id: string;
  mediaUrl: string | null;
  mediaType: "photo" | "video";
  takenAt: Date;
  permalink: string | null;
  caption: string | null;
  // For carousel posts: each item gets its own object inside `extra`.
  extra: Array<{ mediaUrl: string; mediaType: "photo" | "video" }>;
  // Entities pulled from stickers / metadata so the caption can
  // surface them. Each is optional.
  externalLink?: string | null;
  mentions?: string[];
  hashtags?: string[];
  location?: string | null;
  textStickers?: string[];
};

async function ensureKey(): Promise<string> {
  const { key } = await getActiveKey();
  if (!key) {
    throw new Error("HIKER_API_KEY is not configured (env or override)");
  }
  return key;
}

// Special exception we throw on 402 from HikerAPI so the caller can
// distinguish "out of credits" from a generic network / 4xx error
// and bubble the billing URL to the UI / stop the cron early.
export class HikerOutOfCreditsError extends Error {
  billingUrl: string;
  constructor(detail: string, billingUrl: string) {
    super(detail);
    this.name = "HikerOutOfCreditsError";
    this.billingUrl = billingUrl;
  }
}

// Transient upstream — HikerAPI returns 5xx with InstagramServerError
// when Instagram itself is sad. Not our fault, not the key's fault.
// processAccount catches this and skips marking last_error so the
// next cron tick picks the account back up automatically.
export class InstagramTransientError extends Error {
  upstreamStatus: number;
  constructor(msg: string, upstreamStatus: number) {
    super(msg);
    this.name = "InstagramTransientError";
    this.upstreamStatus = upstreamStatus;
  }
}

function isTransientUpstream(status: number, body: string): boolean {
  // 429 + every 5xx is treated as transient. HikerAPI's 5xx
  // responses include not just IG-side flaps (InstagramServerError,
  // GatewayError, RateLimit) but also their own validation bugs
  // ({"detail":"expected string or bytes-like object"} etc.) that
  // surface inconsistently per-account. A single retry + falling
  // back to soft-fail on the row keeps the UI clean — the next cron
  // tick re-runs the same account against the same endpoints.
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  // Belt-and-braces: even if the upstream returns a non-5xx with
  // one of the documented IG-side exc_types, treat it as transient.
  return /InstagramServerError|InstagramGatewayError|InstagramRateLimitError|"detail":"Instagram did not respond|"detail":"expected string or bytes/i.test(
    body,
  );
}

async function callOne<T>(
  path: string,
  query: Record<string, string>,
): Promise<{ data: T; status: number } | { error: string; status: number }> {
  // Local dollar-budget gate — throws HikerApprovalNeededError if the
  // estimated cost of this call would push us past the currently
  // approved slice or the absolute budget.
  await assertBudget(path);
  const url = new URL(path, config.hikerBaseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const key = await ensureKey();
  const res = await fetch(url.toString(), {
    headers: {
      "x-access-key": key,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 300);
    if (res.status === 402) {
      // {"state":false,"error":"Top up your account at https://...",
      //  "exc_type":"InsufficientFunds"}
      let detail = "Insufficient credits";
      let billingUrl = "https://hikerapi.com/billing";
      try {
        const j = JSON.parse(txt) as { error?: string };
        if (j.error) {
          detail = j.error;
          const m = j.error.match(/https?:\/\/\S+/);
          if (m) billingUrl = m[0];
        }
      } catch {}
      throw new HikerOutOfCreditsError(detail, billingUrl);
    }
    return { error: `${res.status} ${path}: ${txt}`, status: res.status };
  }
  // Only record cost on success — 4xx/5xx don't bill us.
  await recordCall({ path }).catch((err) =>
    reportWarn("hikerapi", "[hiker] recordCall failed:", err),
  );
  const data = (await res.json()) as T;
  return { data, status: res.status };
}

// HikerAPI has reshuffled paths between v1 and v2 multiple times; we
// try the path the user gave us first, then fall back to the v2 alias
// when the first one 404s. Transient upstream failures (Instagram
// flaking, 429, 5xx) get a single retry with a short backoff before
// being surfaced as InstagramTransientError so callers can skip
// stamping last_error and let the next cron tick try again.
async function call<T>(
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const tried: string[] = [];
  const candidates = [path];
  if (path.startsWith("/v1/")) candidates.push(path.replace(/^\/v1\//, "/v2/"));
  else if (path.startsWith("/v2/"))
    candidates.push(path.replace(/^\/v2\//, "/v1/"));
  let lastError = "";
  let lastTransient: { status: number; body: string } | null = null;
  for (const p of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await callOne<T>(p, query);
      tried.push(p);
      if ("data" in res) return res.data;
      lastError = res.error;
      if (res.status === 404) {
        // Try the v2/v1 sibling.
        break;
      }
      if (isTransientUpstream(res.status, res.error)) {
        lastTransient = { status: res.status, body: res.error };
        if (attempt === 0) {
          // 1.2s pause then retry the same path once.
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        // Both attempts on this path failed transiently — try the
        // sibling candidate before giving up.
        break;
      }
      throw new Error(`hikerapi ${res.error}`);
    }
  }
  if (lastTransient) {
    throw new InstagramTransientError(
      `hikerapi transient ${lastTransient.status}: ${lastTransient.body.slice(0, 200)}`,
      lastTransient.status,
    );
  }
  throw new Error(
    `hikerapi 404 after fallback (${tried.join(", ")}): ${lastError}`,
  );
}

function biggestImageUrl(raw: unknown): string | null {
  // image_versions2 → candidates: [{ url, width, height }, ...] OR
  // sometimes a flat array. Pick the widest one we see.
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    let best: { url: string; w: number } | null = null;
    for (const c of raw) {
      if (
        c &&
        typeof c === "object" &&
        typeof (c as { url?: unknown }).url === "string"
      ) {
        const w = Number((c as { width?: unknown }).width ?? 0) || 0;
        const u = (c as { url: string }).url;
        if (!best || w > best.w) best = { url: u, w };
      }
    }
    return best?.url ?? null;
  }
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.candidates)) {
    return biggestImageUrl(obj.candidates);
  }
  return null;
}

function videoUrl(raw: Record<string, unknown>): string | null {
  if (typeof raw.video_url === "string") return raw.video_url;
  const versions = raw.video_versions;
  if (Array.isArray(versions)) {
    for (const v of versions) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { url?: unknown }).url === "string"
      ) {
        return (v as { url: string }).url;
      }
    }
  }
  return null;
}

function pickMedia(raw: Record<string, unknown>): {
  mediaUrl: string | null;
  mediaType: "photo" | "video";
} {
  const vUrl = videoUrl(raw);
  if (vUrl) return { mediaUrl: vUrl, mediaType: "video" };
  const img = biggestImageUrl(raw.image_versions2);
  if (img) return { mediaUrl: img, mediaType: "photo" };
  return { mediaUrl: null, mediaType: "photo" };
}

function takenAtOf(raw: Record<string, unknown>): Date {
  // /gql/user/medias returns the timestamp under a GraphQL-prefixed key
  // ("1ltaken_at") and leaves taken_at null, so fall back to any key that
  // ends in taken_at before giving up and using "now".
  const prefixed = Object.keys(raw).find(
    (k) => k !== "taken_at" && /taken_at$/i.test(k) && raw[k] != null,
  );
  const ta =
    raw.taken_at ??
    raw.takenAt ??
    (prefixed ? raw[prefixed] : undefined) ??
    raw.device_timestamp;
  if (typeof ta === "number") {
    // seconds vs ms — Instagram returns seconds.
    const ms = ta < 1e12 ? ta * 1000 : ta;
    return new Date(ms);
  }
  if (typeof ta === "string") {
    const d = new Date(ta);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function pkOf(raw: Record<string, unknown>): string {
  const pk = raw.id ?? raw.pk ?? raw.media_id ?? raw.code;
  if (pk == null) return "";
  return String(pk);
}

// Story / post entities — HikerAPI sometimes returns them in different
// places depending on the endpoint version. We look in every place
// we've ever seen one of these come from and merge.
function entitiesOf(raw: Record<string, unknown>): {
  externalLink: string | null;
  mentions: string[];
  hashtags: string[];
  location: string | null;
  textStickers: string[];
} {
  const out = {
    externalLink: null as string | null,
    mentions: [] as string[],
    hashtags: [] as string[],
    location: null as string | null,
    textStickers: [] as string[],
  };

  // External link: story_cta_url is the modern field; older payloads
  // use link_text / story_link_stickers.
  const storyCta = raw.story_cta as { url?: unknown } | undefined;
  const cta =
    raw.story_cta_url ?? storyCta?.url ?? raw.link;
  if (typeof cta === "string" && cta.startsWith("http")) {
    out.externalLink = cta;
  }
  const linkStickers = raw.story_link_stickers;
  if (Array.isArray(linkStickers)) {
    for (const ls of linkStickers) {
      if (ls && typeof ls === "object") {
        const link = ((ls as Record<string, unknown>).story_link as
          | Record<string, unknown>
          | undefined)?.url;
        if (typeof link === "string" && !out.externalLink) out.externalLink = link;
      }
    }
  }

  // Mentions: story_mentions / reel_mentions / mentions
  const collectMentions = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const m of arr) {
      if (!m || typeof m !== "object") continue;
      const user = (m as { user?: unknown }).user as
        | Record<string, unknown>
        | undefined;
      const username =
        (user && typeof user.username === "string" && user.username) ||
        (typeof (m as { username?: unknown }).username === "string" &&
          (m as { username: string }).username) ||
        null;
      if (typeof username === "string" && !out.mentions.includes(username)) {
        out.mentions.push(username);
      }
    }
  };
  collectMentions(raw.story_mentions);
  collectMentions(raw.reel_mentions);
  collectMentions(raw.mentions);

  // Hashtags
  const collectTags = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const h of arr) {
      if (!h || typeof h !== "object") continue;
      const tag =
        ((h as { hashtag?: unknown }).hashtag as
          | { name?: unknown }
          | undefined)?.name ??
        (h as { name?: unknown }).name;
      if (typeof tag === "string" && !out.hashtags.includes(tag)) {
        out.hashtags.push(tag);
      }
    }
  };
  collectTags(raw.story_hashtags);
  collectTags(raw.hashtags);

  // Location stickers
  const locations = raw.story_locations;
  if (Array.isArray(locations) && locations[0]) {
    const loc = (locations[0] as { location?: unknown }).location as
      | { name?: unknown; short_name?: unknown }
      | undefined;
    const name = loc?.name ?? loc?.short_name;
    if (typeof name === "string") out.location = name;
  } else if (raw.location && typeof raw.location === "object") {
    const name = (raw.location as { name?: unknown }).name;
    if (typeof name === "string") out.location = name;
  }

  // Text stickers
  if (Array.isArray(raw.story_text)) {
    for (const t of raw.story_text) {
      if (t && typeof t === "object") {
        const text = (t as { text?: unknown }).text;
        if (typeof text === "string" && text.trim())
          out.textStickers.push(text.trim());
      }
    }
  }

  return out;
}

function captionOf(raw: Record<string, unknown>): string | null {
  const cap = raw.caption;
  if (!cap) return null;
  if (typeof cap === "string") return cap;
  if (typeof cap === "object") {
    const text = (cap as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return null;
}

function permalinkOf(
  raw: Record<string, unknown>,
  username: string,
): string | null {
  const code = raw.code ?? raw.shortcode;
  if (typeof code === "string") return `https://instagram.com/p/${code}`;
  const taken = takenAtOf(raw);
  if (Number.isFinite(taken.getTime())) {
    return `https://instagram.com/stories/${username}/`;
  }
  return null;
}

export type HikerUsage = {
  // Whatever fields we managed to pull. Frontend renders what's
  // present and skips what's not — HikerAPI's account payload has
  // shifted shapes between versions.
  plan?: string | null;
  creditsUsed?: number | null;
  creditsLimit?: number | null;
  creditsRemaining?: number | null;
  resetsAt?: string | null;
  expiresAt?: string | null;
  raw?: Record<string, unknown>;
};

// HikerAPI doesn't expose a $-level account/usage endpoint to API
// clients — that data only lives on hikerapi.com/usage. So instead
// of probing dead /v1/auth/me / /v1/account / /v1/usage paths (all
// of which return 404), we now do one real lightweight lookup
// against a guaranteed-existing public account. It costs ~\$0.001
// and confirms the key works end-to-end against the SAME content
// endpoints we'll use for actual monitoring. Caller decides when to
// run this — we don't fire it on every page load.
export async function verifyKeyLive(): Promise<{
  keyWorks: boolean;
  transient: boolean;
  sample: { id: string; username: string } | null;
  status: number;
  body: string;
  attempts: number;
}> {
  const { key } = await getActiveKey();
  if (!key)
    return {
      keyWorks: false,
      transient: false,
      sample: null,
      status: 0,
      body: "no key",
      attempts: 0,
    };
  const url = new URL("/v1/user/by/username", config.hikerBaseUrl);
  url.searchParams.set("username", "instagram");
  // Retry transient upstream once — same policy as call() but for
  // the raw fetch path used by diagnose.
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { "x-access-key": key, Accept: "application/json" },
      });
      const fullTxt = await res.text();
      const displayBody = fullTxt.slice(0, 400);
      lastStatus = res.status;
      lastBody = displayBody;
      if (!res.ok) {
        if (isTransientUpstream(res.status, fullTxt)) {
          if (attempt === 1) {
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          return {
            keyWorks: false,
            transient: true,
            sample: null,
            status: res.status,
            body: displayBody,
            attempts: attempt,
          };
        }
        return {
          keyWorks: false,
          transient: false,
          sample: null,
          status: res.status,
          body: displayBody,
          attempts: attempt,
        };
      }
      // Cost-tracking — we used $0.001 on the test call.
      await recordCall({ path: "/v1/user/by/username" }).catch(() => {});
      try {
        const j = JSON.parse(fullTxt) as Record<string, unknown>;
        const u = (j.user as Record<string, unknown>) ?? j;
        const id = pkOf(u);
        const username =
          typeof u.username === "string" ? u.username : "instagram";
        return {
          keyWorks: !!id,
          transient: false,
          sample: id ? { id, username } : null,
          status: res.status,
          body: displayBody,
          attempts: attempt,
        };
      } catch {
        return {
          keyWorks: false,
          transient: false,
          sample: null,
          status: res.status,
          body: displayBody,
          attempts: attempt,
        };
      }
    } catch (err) {
      lastBody = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return {
        keyWorks: false,
        transient: true,
        sample: null,
        status: 0,
        body: lastBody,
        attempts: attempt,
      };
    }
  }
  return {
    keyWorks: false,
    transient: false,
    sample: null,
    status: lastStatus,
    body: lastBody,
    attempts: 2,
  };
}

// HikerAPI exposes /sys/balance — the documented "check your
// current rate limit" endpoint — which returns the live account
// balance + rate-limit info. We hit it directly (raw fetch, no
// budget gate, no retry policy on the cost path) because it's
// supposed to be free / sys-level. Surfaced into the existing
// HikerUsage shape so the UI can render real numbers from
// HikerAPI itself in addition to our local cost tracking.
export type HikerBalance = {
  balanceUsd: number | null;
  rateLimitPerSec: number | null;
  raw: Record<string, unknown>;
};

export async function getBalance(): Promise<HikerBalance> {
  const { key } = await getActiveKey();
  if (!key) throw new Error("HIKER_API_KEY is not configured (env or override)");
  const url = new URL("/sys/balance", config.hikerBaseUrl);
  const res = await fetch(url.toString(), {
    headers: { "x-access-key": key, Accept: "application/json" },
  });
  const txt = await res.text();
  if (!res.ok) {
    if (res.status === 402) {
      throw new HikerOutOfCreditsError(txt.slice(0, 200), "https://hikerapi.com/billing");
    }
    throw new Error(`hikerapi ${res.status} /sys/balance: ${txt.slice(0, 200)}`);
  }
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(txt) as Record<string, unknown>;
  } catch {
    throw new Error(`hikerapi /sys/balance returned non-JSON: ${txt.slice(0, 200)}`);
  }
  // We don't know the exact field names HikerAPI uses, so probe
  // every common shape — they tend to use `balance` (USD float)
  // and either `rate_limit` or `rps`.
  const balanceUsd =
    numOf(raw.balance) ??
    numOf(raw.balance_usd) ??
    numOf((raw as { funds?: unknown }).funds) ??
    numOf(raw.amount) ??
    null;
  const rateLimitPerSec =
    numOf(raw.rate_limit) ??
    numOf(raw.rps) ??
    numOf((raw as { rate?: { per_second?: unknown } }).rate?.per_second) ??
    null;
  return { balanceUsd, rateLimitPerSec, raw };
}

// Legacy shim — getUsage now goes through getBalance so the UI's
// existing "💳 HikerAPI usage" card can render real $ remaining
// from HikerAPI itself.
export async function getUsage(): Promise<HikerUsage> {
  try {
    const bal = await getBalance();
    return {
      plan: null,
      creditsUsed: null,
      creditsLimit: null,
      creditsRemaining: bal.balanceUsd,
      resetsAt: null,
      expiresAt: null,
      raw: bal.raw,
    };
  } catch (err) {
    if (err instanceof HikerOutOfCreditsError) throw err;
    // Don't escalate /sys/balance probe errors as fatal — the page
    // can still render via local tracking.
    return {
      plan: null,
      creditsUsed: null,
      creditsLimit: null,
      creditsRemaining: null,
      resetsAt: null,
      expiresAt: null,
    };
  }
}

// Diagnose mode — runs a single real lookup so the owner can see
// "yes, the key works against the same endpoints we monitor with".
// Returns the masked key prefix and the raw outcome.
export async function diagnoseUsage(): Promise<{
  keyPrefix: string | null;
  keyLoaded: boolean;
  keySource: "tenant" | "db" | "env" | null;
  keyName: string | null;
  probes: Array<{
    path: string;
    ok: boolean;
    transient: boolean;
    status: number;
    body: string;
    attempts: number;
  }>;
}> {
  const { key, source, name } = await getActiveKey();
  const keyPrefix = maskKey(key);
  if (!key) {
    return {
      keyPrefix,
      keyLoaded: false,
      keySource: source,
      keyName: name,
      probes: [
        {
          path: "/v1/user/by/username?username=instagram",
          ok: false,
          transient: false,
          status: 0,
          body: "no key",
          attempts: 0,
        },
      ],
    };
  }
  const live = await verifyKeyLive();
  return {
    keyPrefix,
    keyLoaded: true,
    keySource: source,
    keyName: name,
    probes: [
      {
        path: "/v1/user/by/username?username=instagram",
        ok: live.keyWorks,
        transient: live.transient,
        status: live.status,
        body: live.body,
        attempts: live.attempts,
      },
    ],
  };
}

function numOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}


export async function getUserByUsername(username: string): Promise<IGUser> {
  const data = await call<Record<string, unknown>>("/v1/user/by/username", {
    username,
  });
  // Some plans return {user: {...}}, some return the user directly.
  const u = (data.user as Record<string, unknown>) ?? data;
  const id = pkOf(u);
  if (!id) {
    throw new Error(`hikerapi user not found: ${username}`);
  }
  const mediaCount =
    numOf((u as Record<string, unknown>).media_count) ??
    numOf((u as Record<string, unknown>).total_posts) ??
    null;
  return {
    id,
    username:
      typeof u.username === "string" ? u.username : username.toLowerCase(),
    fullName: typeof u.full_name === "string" ? u.full_name : null,
    profilePicUrl:
      typeof u.profile_pic_url === "string" ? u.profile_pic_url : null,
    mediaCount,
  };
}

export async function getUserStories(
  userId: string,
  username: string,
): Promise<IGMedia[]> {
  const data = await call<Record<string, unknown>>("/v1/user/stories", {
    user_id: userId,
  });
  const arr = Array.isArray(data) ? data : (data.stories as unknown[]) ?? [];
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      const { mediaUrl, mediaType } = pickMedia(s);
      const ent = entitiesOf(s);
      return {
        id: pkOf(s) || `story-${takenAtOf(s).getTime()}`,
        mediaUrl,
        mediaType,
        takenAt: takenAtOf(s),
        permalink: `https://instagram.com/stories/${username}/${pkOf(s)}`,
        caption: captionOf(s),
        extra: [],
        externalLink: ent.externalLink,
        mentions: ent.mentions,
        hashtags: ent.hashtags,
        location: ent.location,
        textStickers: ent.textStickers,
      };
    })
    .filter((m) => m.mediaUrl);
}

function expandCarousel(
  raw: Record<string, unknown>,
): Array<{ mediaUrl: string; mediaType: "photo" | "video" }> {
  const car = raw.carousel_media ?? raw.resources;
  if (!Array.isArray(car)) return [];
  const out: Array<{ mediaUrl: string; mediaType: "photo" | "video" }> = [];
  for (const c of car) {
    if (!c || typeof c !== "object") continue;
    const { mediaUrl, mediaType } = pickMedia(c as Record<string, unknown>);
    if (mediaUrl) out.push({ mediaUrl, mediaType });
  }
  return out;
}

// Pull the media array out of a HikerAPI response. The shape differs per
// endpoint family and HAS CHANGED: every /v2/* media endpoint now nests
// the list under `response` ({response:{items:[…]}}), while /gql/* with
// flat=true returns {items:[…]} at the top level. We previously only
// looked at the top level, so all three /v2 media calls silently
// returned an empty list.
function extractMediaArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const KEYS = ["medias", "items", "media"] as const;
  for (const k of KEYS) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }
  const nested = obj.response;
  if (nested && typeof nested === "object") {
    const r = nested as Record<string, unknown>;
    for (const k of KEYS) {
      if (Array.isArray(r[k])) return r[k] as unknown[];
    }
  }
  if (Array.isArray(nested)) return nested;
  return [];
}

async function fetchMediaList(
  path: string,
  userId: string,
  extraParams?: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const data = await call<Record<string, unknown>>(path, {
    user_id: userId,
    ...(extraParams ?? { count: "12" }),
  });
  const items = extractMediaArray(data);
  return items.filter(
    (m): m is Record<string, unknown> => !!m && typeof m === "object",
  );
}

export async function getUserPosts(
  userId: string,
  username: string,
): Promise<IGMedia[]> {
  // /v2/user/medias is deprecated upstream ("Prefer /gql/user/medias").
  // flat=true keeps the response a plain item list instead of nested
  // GraphQL edge objects.
  const items = await fetchMediaList("/gql/user/medias", userId, {
    flat: "true",
  });
  return items
    .filter((m) => {
      // 1 photo, 2 video, 8 carousel
      const t = Number(m.media_type ?? 0);
      return t === 0 || (t !== 2 && Number(m.product_type ?? 0) !== 51);
    })
    .map((m) => {
      const main = pickMedia(m);
      const extra = expandCarousel(m);
      const ent = entitiesOf(m);
      return {
        id: pkOf(m),
        mediaUrl: main.mediaUrl ?? extra[0]?.mediaUrl ?? null,
        mediaType: main.mediaUrl
          ? main.mediaType
          : (extra[0]?.mediaType ?? "photo"),
        takenAt: takenAtOf(m),
        permalink: permalinkOf(m, username),
        caption: captionOf(m),
        extra,
        externalLink: ent.externalLink,
        mentions: ent.mentions,
        hashtags: ent.hashtags,
        location: ent.location,
        textStickers: ent.textStickers,
      };
    })
    .filter((m) => m.mediaUrl);
}

export async function getUserMentions(
  userId: string,
  username: string,
): Promise<IGMedia[]> {
  // "Posts where this user is tagged" — HikerAPI exposes this via
  // /v2/user/tag/medias (v1 fallback handled by call()).
  const items = await fetchMediaList("/v2/user/tag/medias", userId);
  return items
    .map((m) => {
      const main = pickMedia(m);
      const extra = expandCarousel(m);
      const ent = entitiesOf(m);
      return {
        id: pkOf(m),
        mediaUrl: main.mediaUrl ?? extra[0]?.mediaUrl ?? null,
        mediaType: main.mediaUrl
          ? main.mediaType
          : (extra[0]?.mediaType ?? "photo"),
        takenAt: takenAtOf(m),
        permalink: permalinkOf(m, username),
        caption: captionOf(m),
        extra,
        externalLink: ent.externalLink,
        mentions: ent.mentions,
        hashtags: ent.hashtags,
        location: ent.location,
        textStickers: ent.textStickers,
      };
    })
    .filter((m) => m.mediaUrl);
}

export async function getUserReels(
  userId: string,
  username: string,
): Promise<IGMedia[]> {
  const items = await fetchMediaList("/v2/user/clips", userId);
  return items
    .map((m) => {
      const { mediaUrl, mediaType } = pickMedia(m);
      const ent = entitiesOf(m);
      return {
        id: pkOf(m),
        mediaUrl,
        mediaType,
        takenAt: takenAtOf(m),
        permalink: permalinkOf(m, username),
        caption: captionOf(m),
        extra: [],
        externalLink: ent.externalLink,
        mentions: ent.mentions,
        hashtags: ent.hashtags,
        location: ent.location,
        textStickers: ent.textStickers,
      };
    })
    .filter((m) => m.mediaUrl);
}
