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

export type IGUser = {
  id: string;
  username: string;
  fullName: string | null;
  profilePicUrl: string | null;
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

function ensureKey(): string {
  if (!config.hikerApiKey) {
    throw new Error("HIKER_API_KEY is not configured");
  }
  return config.hikerApiKey;
}

async function callOne<T>(
  path: string,
  query: Record<string, string>,
): Promise<{ data: T; status: number } | { error: string; status: number }> {
  const url = new URL(path, config.hikerBaseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      "x-access-key": ensureKey(),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 300);
    return { error: `${res.status} ${path}: ${txt}`, status: res.status };
  }
  const data = (await res.json()) as T;
  return { data, status: res.status };
}

// HikerAPI has reshuffled paths between v1 and v2 multiple times; we
// try the path the user gave us first, then fall back to the v2 alias
// when the first one 404s. Other status codes (401 / 429 / 500) get
// surfaced immediately because they're real errors.
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
  for (const p of candidates) {
    const res = await callOne<T>(p, query);
    tried.push(p);
    if ("data" in res) return res.data;
    lastError = res.error;
    if (res.status !== 404) {
      throw new Error(`hikerapi ${res.error}`);
    }
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
  const ta = raw.taken_at ?? raw.takenAt ?? raw.device_timestamp;
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
  return {
    id,
    username:
      typeof u.username === "string" ? u.username : username.toLowerCase(),
    fullName: typeof u.full_name === "string" ? u.full_name : null,
    profilePicUrl:
      typeof u.profile_pic_url === "string" ? u.profile_pic_url : null,
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

async function fetchMediaList(
  path: string,
  userId: string,
): Promise<Record<string, unknown>[]> {
  const data = await call<Record<string, unknown>>(path, {
    user_id: userId,
    count: "12",
  });
  const items =
    (Array.isArray(data) ? data : null) ??
    (data.medias as unknown[]) ??
    (data.items as unknown[]) ??
    (data.media as unknown[]) ??
    [];
  return (Array.isArray(items) ? items : []).filter(
    (m): m is Record<string, unknown> => !!m && typeof m === "object",
  );
}

export async function getUserPosts(
  userId: string,
  username: string,
): Promise<IGMedia[]> {
  const items = await fetchMediaList("/v2/user/medias", userId);
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
