import { spawn } from "node:child_process";
import { getAllSettings, nextTrackToVerify, saveVerify, setSetting } from "@/lib/db";
import { ffmpegPath, analyzerReady } from "@/lib/music-analysis";
import { previewScore, PREVIEW_BAD as BAD, PREVIEW_OK as OK } from "@/lib/music-preview";
import { pageMeta } from "@/lib/music-spotsaver";
import { reportWarn } from "@/lib/report";

// Is each library file really the song it is filed under? The audio is compared with Spotify's
// 30 s preview of that song (deploy/audio-verify.py slides the preview over the file and reports
// the best spectral similarity): ≥ 0.5 same recording, < 0.35 a different song.
// A mismatch is repaired once automatically through SpotSaver (the old file keeps playing until
// the new one is in); if the replacement also fails the check it stays flagged for the owner.

// ---- the file's own ID3 tags (title / artist) against what the library says the song is ----
function norm(v: string): string[] {
  return v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\bfeat\.?\b|\bft\.?\b|\bremaster(ed)?\b|\bversion\b|\blive\b/g, " ")
    .split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2);
}
const overlap = (want: string[], have: Set<string>) => (want.length ? want.filter((w) => have.has(w) || [...have].some((h) => h.length > 3 && (h.includes(w) || w.includes(h)))).length / want.length : 1);

function readTags(file: string): Promise<{ title: string | null; artist: string | null }> {
  return new Promise(async (resolve) => {
    const child = spawn(await ffmpegPath(), ["-v", "error", "-i", file, "-f", "ffmetadata", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    const done = () => { clearTimeout(timer); const g = (k: string) => new RegExp(`^${k}=(.*)$`, "im").exec(out)?.[1]?.trim() || null; resolve({ title: g("title"), artist: g("artist") }); };
    child.on("close", done); child.on("error", done);
  });
}

/** match / mismatch / none (no tags to judge by). Needs BOTH the title and the artist to disagree to call it a mismatch. */
async function tagCheck(file: string, title: string | null, artist: string | null): Promise<{ status: string; title: string | null; artist: string | null }> {
  const t = await readTags(file);
  if (!t.title && !t.artist) return { status: "none", ...t };
  const titleOk = !t.title || overlap(norm(title ?? ""), new Set(norm(t.title))) >= 0.5;
  const artistOk = !t.artist || !artist || overlap(norm(artist), new Set(norm(t.artist))) >= 0.34 || overlap(norm(t.artist), new Set(norm(artist))) >= 0.5;
  return { status: !titleOk && !artistOk ? "mismatch" : !titleOk || !artistOk ? "partial" : "match", ...t };
}

/** Cron step (background, own lock): verify a few unchecked tracks. Never throws. */
export async function verifyStep(): Promise<number> {
  if (!(await analyzerReady())) return 0;
  const s = await getAllSettings();
  if (Date.now() - Number(s.musicVerifyLock || 0) < 150_000) return 0;
  await setSetting("musicVerifyLock", String(Date.now()));
  let done = 0;
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 40_000) {
      const t = await nextTrackToVerify();
      if (!t) break;
      const tag = await tagCheck(t.filePath, t.title, t.artist);
      const meta = await pageMeta(t.spotifyUrl);
      try {
        const score = meta?.previewUrl ? await previewScore(t.filePath, meta.previewUrl) : null;
        // The audio comparison is decisive when there is a preview; otherwise the file's own tags decide.
        let status: string;
        if (score != null) status = score >= OK ? "ok" : score < BAD ? "mismatch" : "unsure";
        else if (tag.status === "mismatch") status = "mismatch";
        else if (tag.status === "match") status = "tags_ok";
        else status = meta ? "nopreview" : "error";
        let fixes = t.fixes;
        if (status === "mismatch") {
          reportWarn("music", `track ${t.id}: file does not match the song (preview score ${score ?? "n/a"}, tags: ${tag.status})`);
          if (t.fixes < 1 && ((await getAllSettings()).spotsaverLicense ?? "").trim()) {
            // one automatic repair: queue a fresh copy; the size change re-triggers this check
            let list: number[] = [];
            try { list = JSON.parse((await getAllSettings()).spotsaverRedo || "[]") as number[]; } catch { /* reset */ }
            await setSetting("spotsaverRedo", JSON.stringify([...new Set([...list, t.id])].slice(-50)));
            fixes = t.fixes + 1;
          }
        }
        await saveVerify(t.id, status, score, t.sizeBytes, fixes, tag);
        done++;
      } catch { await saveVerify(t.id, "error", null, t.sizeBytes, t.fixes, tag); done++; }
    }
  } catch (err) { reportWarn("music", "verify step failed:", err); }
  finally { await setSetting("musicVerifyLock", "0"); }
  return done;
}
