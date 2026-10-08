import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAllSettings, nextTrackToVerify, saveVerify, setSetting } from "@/lib/db";
import { ffmpegPath, PY, analyzerReady } from "@/lib/music-analysis";
import { pageMeta } from "@/lib/music-spotsaver";
import { reportWarn } from "@/lib/report";

// Is each library file really the song it is filed under? The audio is compared with Spotify's
// 30 s preview of that song (deploy/audio-verify.py slides the preview over the file and reports
// the best spectral similarity): ≥ 0.5 same recording, < 0.35 a different song.
// A mismatch is repaired once automatically through SpotSaver (the old file keeps playing until
// the new one is in); if the replacement also fails the check it stays flagged for the owner.
const OK = 0.5;
const BAD = 0.35;

function run(file: string, preview: string): Promise<{ ok: boolean; score?: number; error?: string }> {
  return new Promise(async (resolve) => {
    const script = path.join(process.cwd(), "deploy", "audio-verify.py");
    const child = spawn(PY, [script, file, preview, await ffmpegPath()], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", () => { clearTimeout(timer); try { resolve(JSON.parse(out.trim().split("\n").pop() ?? "{}")); } catch { resolve({ ok: false, error: "no output" }); } });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e) }); });
  });
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
      const meta = await pageMeta(t.spotifyUrl);
      if (!meta?.previewUrl) { await saveVerify(t.id, meta ? "nopreview" : "error", null, t.sizeBytes, t.fixes); done++; continue; }
      const tmp = path.join(os.tmpdir(), `tgsb-prev-${t.id}.mp3`);
      try {
        const r = await fetch(meta.previewUrl, { signal: AbortSignal.timeout(30_000) });
        if (!r.ok) { await saveVerify(t.id, "error", null, t.sizeBytes, t.fixes); done++; continue; }
        await fs.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
        const v = await run(t.filePath, tmp);
        if (!v.ok || v.score == null) { await saveVerify(t.id, "error", null, t.sizeBytes, t.fixes); done++; continue; }
        const status = v.score >= OK ? "ok" : v.score < BAD ? "mismatch" : "unsure";
        let fixes = t.fixes;
        if (status === "mismatch") {
          reportWarn("music", `track ${t.id}: file does not match Spotify's preview (score ${v.score})`);
          if (t.fixes < 1 && ((await getAllSettings()).spotsaverLicense ?? "").trim()) {
            // one automatic repair: queue a fresh copy; the size change re-triggers this check
            let list: number[] = [];
            try { list = JSON.parse((await getAllSettings()).spotsaverRedo || "[]") as number[]; } catch { /* reset */ }
            await setSetting("spotsaverRedo", JSON.stringify([...new Set([...list, t.id])].slice(-50)));
            fixes = t.fixes + 1;
          }
        }
        await saveVerify(t.id, status, v.score, t.sizeBytes, fixes);
        done++;
      } catch { await saveVerify(t.id, "error", null, t.sizeBytes, t.fixes); done++; }
      finally { await fs.unlink(tmp).catch(() => {}); }
    }
  } catch (err) { reportWarn("music", "verify step failed:", err); }
  finally { await setSetting("musicVerifyLock", "0"); }
  return done;
}
