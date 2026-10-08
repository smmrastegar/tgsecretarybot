import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAllSettings, getMusicTrack, nextSpotdlCandidate, setSetting, updateMusicTrack } from "@/lib/db";
import { reportInfo, reportWarn } from "@/lib/report";
import { MUSIC_DIR } from "@/lib/music";
import { spotsaverDownloadTrack, spotsaverReady } from "@/lib/music-spotsaver";

// Fallback downloader: spotDL (YouTube Music matched to the Spotify track)
// for tracks the Telegram downloader bot does not have. Installed by
// deploy/spotdl-setup.sh; absent → every function here is a no-op.
const TOOLS = "/var/lib/tgsb-tools";
const BIN = `${TOOLS}/spotdl/bin/spotdl`;
const TIMEOUT_MS = 4 * 60 * 1000;

export async function spotdlReady(): Promise<boolean> {
  try { await fs.access(BIN); return true; } catch { return false; }
}

function run(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { env: { ...process.env, HOME: `${TOOLS}/home`, PATH: `${process.env.PATH ?? ""}:${TOOLS}/home/.config/spotdl` }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const add = (b: Buffer) => { out = (out + b.toString()).slice(-4000); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
  });
}

/** Download one library track with spotDL. Returns true when it is now ready. */
export async function spotdlDownloadTrack(trackId: number): Promise<boolean> {
  const t = await getMusicTrack(trackId);
  if (!t?.spotifyId || !(await spotdlReady())) return false;
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(MUSIC_DIR, ".spotdl-"));
  try {
    await updateMusicTrack(trackId, { status: "downloading", error: null });
    const r = await run(["download", t.spotifyUrl, "--format", "mp3", "--bitrate", "192k", "--output", `${tmp}/{track-id}.{output-ext}`]);
    const files = (await fs.readdir(tmp)).filter((f) => f.endsWith(".mp3"));
    if (r.code !== 0 || files.length === 0) {
      const why = r.out.replace(/\s+/g, " ").trim().slice(-160);
      await updateMusicTrack(trackId, { status: "failed", error: `Track not found (spotDL هم نشد: ${why})`.slice(0, 300) });
      return false;
    }
    const dest = path.join(MUSIC_DIR, `${trackId}.mp3`);
    await fs.rename(path.join(tmp, files[0]!), dest);
    const st = await fs.stat(dest);
    await updateMusicTrack(trackId, { filePath: dest, mime: "audio/mpeg", sizeBytes: st.size, durationS: t.spotifyDurationS ?? t.durationS ?? null, status: "ready", error: null });
    return true;
  } catch (err) {
    await updateMusicTrack(trackId, { status: "failed", error: `Track not found (spotDL خطا: ${String(err).slice(0, 120)})` }).catch(() => {});
    return false;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Cron step: give ONE failed track a second chance — first through the owner's SpotSaver
 * subscription (if configured), then through spotDL. Runs in the background with its own lock.
 */
export async function spotdlFallbackStep(): Promise<{ tried: number | null; ok?: boolean; ready: boolean }> {
  const saver = await spotsaverReady();
  const dl = await spotdlReady();
  if (!saver && !dl) return { tried: null, ready: false };
  const s = await getAllSettings();
  if (Date.now() - Number(s.musicSpotdlLock || 0) < TIMEOUT_MS + 30_000) return { tried: null, ready: true };
  const id = await nextSpotdlCandidate();
  if (id == null) return { tried: null, ready: true };
  await setSetting("musicSpotdlLock", String(Date.now()));
  try {
    if (saver) {
      const why = await spotsaverDownloadTrack(id);
      if (!why) { reportInfo("music", `SpotSaver fallback for track ${id}: ready`); return { tried: id, ok: true, ready: true }; }
      reportWarn("music", `SpotSaver fallback for track ${id} failed: ${why}`);
      await updateMusicTrack(id, { status: "failed", error: `Track not found (SpotSaver: ${why})`.slice(0, 300) });
    }
    if (!dl) return { tried: id, ok: false, ready: true };
    const ok = await spotdlDownloadTrack(id);
    (ok ? reportInfo : reportWarn)("music", `spotDL fallback for track ${id}: ${ok ? "ready" : "failed"}`);
    return { tried: id, ok, ready: true };
  } finally {
    await setSetting("musicSpotdlLock", "0");
  }
}
