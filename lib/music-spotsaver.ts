import { promises as fs } from "node:fs";
import path from "node:path";
import { getAllSettings, getMusicTrack, updateMusicTrack } from "@/lib/db";
import { MUSIC_DIR } from "@/lib/music";
import { reportWarn } from "@/lib/report";

// Fallback downloader: the owner's SpotSaver (spotsaver.net) subscription. Its web page
// calls three endpoints — match a song to a source video, ask for an MP3, fetch it —
// and the licence key (stored in settings.spotsaverLicense, never in the repo) goes
// along with the request. The conversion runs on their servers, so a datacenter IP
// like ours is not a problem. Used only for songs the Telegram downloader bot could not
// deliver; any failure just leaves the track failed with the reason.
const BASE = "https://spotsaver.net";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_BYTES = 40 * 1024 * 1024;

export async function spotsaverReady(): Promise<boolean> {
  return ((await getAllSettings()).spotsaverLicense ?? "").trim().length > 8;
}

async function post(pathname: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

type Got = { buf: Buffer; secs: number };

/** Ask for one source video and download it (any length — the caller judges). */
async function getVideo(videoId: string, candidateIds: unknown[], name: string, key: string): Promise<Got | { reason: string }> {
  const dl = await post("/api/download/", { videoId, candidateIds, format: "mp3", title: name, licenseKey: key }, 150_000);
  const url = String(dl.json.downloadUrl ?? dl.json.url ?? dl.json.fileUrl ?? dl.json.mediaUrl ?? "");
  if (!url.startsWith("https://")) return { reason: dl.status === 429 ? "rate limited" : String(dl.json.error ?? `no download link (${dl.status})`).slice(0, 80) };
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!r.ok) return { reason: `file fetch ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100_000 || buf.length > MAX_BYTES) return { reason: `unexpected file size ${buf.length}` };
  return { buf, secs: (buf.length * 8) / 320_000 }; // 320 kbps MP3 ⇒ seconds = bytes·8/320000
}

/** The page's own view of a song (title / artist as it phrases them). */
export async function pageMeta(spotifyUrl: string): Promise<{ title: string; artist: string; previewUrl: string } | null> {
  try {
    const r = await fetch(`${BASE}/api/spotify/?url=${encodeURIComponent(spotifyUrl)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    const j = (await r.json()) as { items?: Array<{ title?: string; artist?: string; previewUrl?: string | null }> };
    const i = j.items?.[0];
    return i?.title ? { title: i.title, artist: i.artist ?? "", previewUrl: i.previewUrl ?? "" } : null;
  } catch { return null; }
}

/**
 * Download one library track through SpotSaver the way its own page does (its title/artist
 * wording → matched video → MP3). A file whose length is within 5 % of Spotify's is taken at once;
 * otherwise a few other phrasings are tried and the closest-length file wins, as long as it is
 * between half and double the expected length (the same song, a different edit). Returns null on
 * success, else a short reason.
 */
export async function spotsaverDownloadTrack(trackId: number, redo = false): Promise<string | null> {
  const t = await getMusicTrack(trackId);
  if (!t?.title) return "no title";
  const key = ((await getAllSettings()).spotsaverLicense ?? "").trim();
  if (!key) return "no licence configured";
  const artists = (t.artist ?? "").split(/,\s*/).filter(Boolean);
  const first = artists[0] ?? "";
  const expect = t.spotifyDurationS ?? 0;
  const meta = await pageMeta(t.spotifyUrl);
  const queries: Array<{ title: string; artist: string }> = [
    ...(meta ? [meta] : []),
    { title: t.title, artist: first },
    { title: t.title, artist: `${first} official audio` },
    { title: t.title, artist: "" },
  ];
  const seen = new Set<string>();
  let best: Got | null = null;
  let lastReason = "no match";
  try {
    // A re-download of a working track must never leave it unplayable if SpotSaver fails.
    if (!redo) await updateMusicTrack(trackId, { status: "downloading", error: null });
    for (const q of queries) {
      const id = await post("/api/get-id/", q, 40_000);
      const vid = String(id.json.videoId ?? "");
      if (!id.json.success || !vid) { lastReason = `no match (${id.status})`; continue; }
      if (seen.has(vid)) continue;
      seen.add(vid);
      const got = await getVideo(vid, Array.isArray(id.json.candidateIds) ? id.json.candidateIds : [], `${t.title} - ${first}`.trim(), key);
      if (!("buf" in got)) { lastReason = got.reason; if (got.reason === "rate limited") return got.reason; continue; }
      if (!expect || Math.abs(got.secs - expect) <= expect * 0.05) { best = got; break; }
      if (got.secs >= expect * 0.5 && got.secs <= expect * 2 && (!best || Math.abs(got.secs - expect) < Math.abs(best.secs - expect))) best = got;
      else lastReason = `wrong length (${Math.round(got.secs)}s vs ${expect}s)`;
    }
    if (!best) return lastReason;
    await fs.mkdir(MUSIC_DIR, { recursive: true });
    const dest = path.join(MUSIC_DIR, `${trackId}.mp3`);
    await fs.writeFile(dest, best.buf);
    // The file's own length is what the player should show (it can differ from Spotify's edit).
    await updateMusicTrack(trackId, { filePath: dest, mime: "audio/mpeg", sizeBytes: best.buf.length, durationS: Math.round(best.secs), status: "ready", error: null });
    if (expect && Math.abs(best.secs - expect) > expect * 0.05) reportWarn("music", `SpotSaver gave track ${trackId} a different edit: ${Math.round(best.secs)}s vs Spotify's ${expect}s`);
    return null;
  } catch (err) {
    return String(err instanceof Error ? err.message : err).slice(0, 100);
  }
}
