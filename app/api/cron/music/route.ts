import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getAllSettings, setSetting } from "@/lib/db";
import { kickMusicQueue, repairLibrary } from "@/lib/music";
import { reportInfo, reportWarn } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every minute: moves the library queue along and times out stuck jobs.
// One-off: after the 2026-10 queue bug the library is repaired in small
// steps (30 tracks a minute, resumable via musicRepairCursor, paused on
// a Spotify 429): metadata + covers from Spotify, requeue of audio that
// belongs to a different track.
export async function GET(request: Request): Promise<NextResponse> {
  const secret = config.cronSecret;
  const ok = secret && (request.headers.get("authorization") === `Bearer ${secret}` || new URL(request.url).searchParams.get("secret") === secret);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const s = await getAllSettings();
  let repair: unknown = undefined;
  const lockAge = Date.now() - Number(s.musicRepairLock || 0);
  const pausedUntil = Number(s.musicRepairPauseUntil || 0);
  if (s.musicRepairV1 !== "done" && lockAge > 4 * 60 * 1000 && Date.now() > pausedUntil) {
    await setSetting("musicRepairLock", String(Date.now()));
    try {
      const after = Number(s.musicRepairCursor || 0);
      const r = await repairLibrary({ afterId: after, limit: 30 });
      if (r.lastId > after) await setSetting("musicRepairCursor", String(r.lastId));
      if (r.rateLimitedFor > 0) await setSetting("musicRepairPauseUntil", String(Date.now() + (r.rateLimitedFor + 5) * 1000));
      if (r.done) {
        await setSetting("musicRepairV1", "done");
        reportInfo("music", "library repair finished");
      }
      repair = r;
    } catch (err) {
      reportWarn("music", "library repair step failed (will retry):", err);
      repair = { error: String(err) };
    } finally {
      await setSetting("musicRepairLock", "0");
    }
  }
  return NextResponse.json({ ok: true, ...(await kickMusicQueue()), repair });
}
