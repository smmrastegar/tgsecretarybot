import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath, PY } from "@/lib/music-analysis";

/** Thresholds for deploy/audio-verify.py scores: ≥ OK is the same recording, < BAD a different song. */
export const PREVIEW_OK = 0.5;
export const PREVIEW_BAD = 0.35;

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

/** Similarity (0–1) of an audio file to Spotify's 30 s preview of the song; null when it cannot be judged. */
export async function previewScore(file: string, previewUrl: string): Promise<number | null> {
  const tmp = path.join(os.tmpdir(), `tgsb-prev-${process.pid}-${Date.now()}.mp3`);
  try {
    const r = await fetch(previewUrl, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!r?.ok) return null;
    await fs.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
    const v = await run(file, tmp);
    return v.ok && v.score != null ? v.score : null;
  } finally { await fs.unlink(tmp).catch(() => {}); }
}
