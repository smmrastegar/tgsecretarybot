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

type Attempt = { reason: string } | { buf: Buffer; secs: number };

/** Ask for one source video, download it, and check it really is this song (by length). */
async function tryVideo(videoId: string, candidateIds: unknown[], name: string, key: string, expectS: number | null): Promise<Attempt> {
  const dl = await post("/api/download/", { videoId, candidateIds, format: "mp3", title: name, licenseKey: key }, 150_000);
  const url = String(dl.json.downloadUrl ?? dl.json.url ?? dl.json.fileUrl ?? dl.json.mediaUrl ?? "");
  if (!url.startsWith("https://")) return { reason: dl.status === 429 ? "rate limited" : String(dl.json.error ?? `no download link (${dl.status})`).slice(0, 80) };
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!r.ok) return { reason: `file fetch ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100_000 || buf.length > MAX_BYTES) return { reason: `unexpected file size ${buf.length}` };
  // 320 kbps MP3 ⇒ seconds = bytes·8/320000. A matched video of another length is a different version.
  const secs = (buf.length * 8) / 320_000;
  if (expectS && Math.abs(secs - expectS) > Math.max(10, expectS * 0.05)) return { reason: `wrong length (${Math.round(secs)}s vs ${expectS}s)` };
  return { buf, secs };
}

/** Download one library track through SpotSaver. Returns null on success, else a short reason. */
export async function spotsaverDownloadTrack(trackId: number): Promise<string | null> {
  const t = await getMusicTrack(trackId);
  if (!t?.title) return "no title";
  const key = ((await getAllSettings()).spotsaverLicense ?? "").trim();
  if (!key) return "no licence configured";
  const artists = (t.artist ?? "").split(/,\s*/).filter(Boolean);
  const first = artists[0] ?? "";
  // Different phrasings make the matcher pick different videos; the length check weeds out wrong versions.
  const queries: Array<{ title: string; artist: string }> = [
    { title: t.title, artist: first },
    { title: t.title, artist: artists.join(" ") },
    { title: t.title, artist: `${first} official audio` },
    { title: t.title, artist: "" },
    { title: `${t.title} (Audio)`, artist: first },
  ];
  const seen = new Set<string>();
  let lastReason = "no match";
  try {
    await updateMusicTrack(trackId, { status: "downloading", error: null });
    for (const q of queries) {
      const id = await post("/api/get-id/", q, 40_000);
      const ids = [String(id.json.videoId ?? ""), ...(Array.isArray(id.json.candidateIds) ? id.json.candidateIds.map(String) : [])].filter((v) => v && !seen.has(v));
      if (!id.json.success || ids.length === 0) { if (!ids.length && id.json.success) continue; lastReason = lastReason === "no match" ? `no match (${id.status})` : lastReason; continue; }
      for (const vid of ids.slice(0, 2)) {
        seen.add(vid);
        const a = await tryVideo(vid, [], `${t.title} - ${first}`.trim(), key, t.spotifyDurationS);
        if ("buf" in a) {
          await fs.mkdir(MUSIC_DIR, { recursive: true });
          const dest = path.join(MUSIC_DIR, `${trackId}.mp3`);
          await fs.writeFile(dest, a.buf);
          await updateMusicTrack(trackId, { filePath: dest, mime: "audio/mpeg", sizeBytes: a.buf.length, durationS: t.spotifyDurationS ?? Math.round(a.secs), status: "ready", error: null });
          return null;
        }
        lastReason = a.reason;
        if (a.reason === "rate limited") return a.reason;
      }
    }
    return lastReason;
  } catch (err) {
    return String(err instanceof Error ? err.message : err).slice(0, 100);
  }
}
