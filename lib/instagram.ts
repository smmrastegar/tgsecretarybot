// Instagram story detection. Public Instagram doesn't expose story
// data without auth, so we keep this layer pluggable: if the operator
// sets INSTAGRAM_STORIES_API_URL (+ optional API key/header), we hit
// that and trust its response. Otherwise we return [] and the cron
// is effectively a no-op until a provider is configured.
//
// Expected provider response shape (JSON):
//   { stories: [ { id: "<unique>", url: "<full https url>",
//                  takenAt: "<ISO 8601>" }, ... ] }
// Anything else is ignored gracefully.

export type DetectedStory = {
  id: string;
  url: string;
  takenAt: Date;
};

function envOr(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export async function detectInstagramStories(
  username: string,
): Promise<DetectedStory[]> {
  const base = envOr("INSTAGRAM_STORIES_API_URL");
  if (!base) return [];
  const url = base.includes("{username}")
    ? base.replace(/\{username\}/g, encodeURIComponent(username))
    : `${base.replace(/\/$/, "")}/${encodeURIComponent(username)}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "tgsecretarybot/1.0",
  };
  const apiKey = envOr("INSTAGRAM_STORIES_API_KEY");
  const headerName = envOr("INSTAGRAM_STORIES_API_HEADER", "X-RapidAPI-Key");
  if (apiKey && headerName) headers[headerName] = apiKey;
  const apiHost = envOr("INSTAGRAM_STORIES_API_HOST");
  if (apiHost) headers["X-RapidAPI-Host"] = apiHost;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => null)) as
    | { stories?: unknown }
    | null;
  if (!data || !Array.isArray(data.stories)) return [];
  const out: DetectedStory[] = [];
  for (const raw of data.stories) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : String(r.id ?? "");
    const sUrl = typeof r.url === "string" ? r.url : null;
    const takenAtStr = typeof r.takenAt === "string" ? r.takenAt : null;
    if (!id || !sUrl) continue;
    const takenAt = takenAtStr ? new Date(takenAtStr) : new Date();
    if (Number.isNaN(takenAt.getTime())) continue;
    out.push({ id, url: sUrl, takenAt });
  }
  return out;
}
