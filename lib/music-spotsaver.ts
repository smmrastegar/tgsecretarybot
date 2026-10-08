import { promises as fs } from "node:fs";
import path from "node:path";
import { getAllSettings, getMusicTrack, updateMusicTrack } from "@/lib/db";
import { MUSIC_DIR } from "@/lib/music";

// Fallback downloader: the owner's SpotSaver (spotsaver.net) subscription. Its web page
// calls three endpoints — match a song to a source video, ask for an MP3, fetch it —
// and the licence key (stored in settings.spotsaverLicense, never in the repo) goes
// along with the request. The conversion runs on their servers, so a datacenter IP
// like ours is not a problem. Used only for songs the Telegram downloader bot could not
// deliver; any failure just leaves the track failed with the reason.
const BASE = "https://spotsaver.net";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_BYTES = 60 * 1024 * 1024;

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

/** Download one library track through SpotSaver. Returns null on success, else a short reason. */
export async function spotsaverDownloadTrack(trackId: number): Promise<string | null> {
  const t = await getMusicTrack(trackId);
  if (!t?.title) return "no title";
  const key = ((await getAllSettings()).spotsaverLicense ?? "").trim();
  if (!key) return "no licence configured";
  const artist = (t.artist ?? "").split(/,\s*/)[0] ?? "";
  try {
    await updateMusicTrack(trackId, { status: "downloading", error: null });
    const id = await post("/api/get-id/", { title: t.title, artist }, 40_000);
    const videoId = String(id.json.videoId ?? "");
    if (!id.json.success || !videoId) return `no match (${id.status})`;
    const candidateIds = Array.isArray(id.json.candidateIds) ? id.json.candidateIds : [];
    const dl = await post("/api/download/", { videoId, candidateIds, format: "mp3", title: `${t.title} - ${artist}`.trim(), licenseKey: key }, 150_000);
    const url = String(dl.json.downloadUrl ?? dl.json.url ?? dl.json.fileUrl ?? dl.json.mediaUrl ?? "");
    if (!url.startsWith("https://")) return dl.status === 429 ? "rate limited" : String(dl.json.error ?? `no download link (${dl.status})`).slice(0, 80);
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(180_000) });
    if (!r.ok) return `file fetch ${r.status}`;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100_000 || buf.length > MAX_BYTES) return `unexpected file size ${buf.length}`;
    // The source is a matched video: make sure it is this song. 320 kbps MP3 ⇒ seconds = bytes·8/320000.
    const secs = (buf.length * 8) / 320_000;
    if (t.spotifyDurationS && Math.abs(secs - t.spotifyDurationS) > Math.max(12, t.spotifyDurationS * 0.07)) return `wrong length (${Math.round(secs)}s vs ${t.spotifyDurationS}s)`;
    await fs.mkdir(MUSIC_DIR, { recursive: true });
    const dest = path.join(MUSIC_DIR, `${trackId}.mp3`);
    await fs.writeFile(dest, buf);
    await updateMusicTrack(trackId, { filePath: dest, mime: "audio/mpeg", sizeBytes: buf.length, durationS: t.spotifyDurationS ?? Math.round(secs), status: "ready", error: null });
    return null;
  } catch (err) {
    return String(err instanceof Error ? err.message : err).slice(0, 100);
  }
}
