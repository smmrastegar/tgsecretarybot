import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getAllSettings, setSetting } from "@/lib/db";
import { kickMusicQueue, repairLibrary } from "@/lib/music";
import { reportInfo, reportWarn } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every minute: moves the library queue along and times out stuck jobs.
// One-off: the first run after the 2026-10 queue bug repairs the library
// (metadata + covers from Spotify, requeue of audio that belongs to a
// different track). Guarded by a settings flag plus a 10-minute lock so
// overlapping cron ticks never run it twice.
export async function GET(request: Request): Promise<NextResponse> {
  const secret = config.cronSecret;
  const ok = secret && (request.headers.get("authorization") === `Bearer ${secret}` || new URL(request.url).searchParams.get("secret") === secret);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const s = await getAllSettings();
  let repair: unknown = undefined;
  const lockAge = Date.now() - Number(s.musicRepairLock || 0);
  if (s.musicRepairV1 !== "done" && lockAge > 10 * 60 * 1000) {
    await setSetting("musicRepairLock", String(Date.now()));
    try {
      const r = await repairLibrary();
      await setSetting("musicRepairV1", "done");
      reportInfo("music", `library repair: ${JSON.stringify(r)}`);
      repair = r;
    } catch (err) {
      reportWarn("music", "library repair failed (will retry):", err);
      repair = { error: String(err) };
    }
  }
  return NextResponse.json({ ok: true, ...(await kickMusicQueue()), repair });
}
