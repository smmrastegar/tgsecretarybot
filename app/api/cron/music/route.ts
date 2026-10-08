import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getAllSettings, setSetting } from "@/lib/db";
import { fillMissingMeta, kickMusicQueue, repairLibrary, verifyLibraryLocal } from "@/lib/music";
import { analysisStep } from "@/lib/music-analysis";
import { spotdlFallbackStep } from "@/lib/music-spotdl";
import { runSync, SYNC_EVERY_MS } from "@/lib/music-sync";
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
  // One-off (v2): the first repair skipped files whose reported duration
  // was 0; check every stored file against Spotify's length by size.
  let verify: unknown = undefined;
  if (s.musicVerifyV2 !== "done") {
    try {
      verify = await verifyLibraryLocal();
      await setSetting("musicVerifyV2", "done");
      reportInfo("music", `local verify: ${JSON.stringify(verify)}`);
    } catch (err) {
      reportWarn("music", "local verify failed (will retry):", err);
    }
  }
  // Ongoing: tracks added since get their Spotify length filled in.
  let fill: unknown = undefined;
  if (s.musicRepairV1 === "done" && Date.now() > pausedUntil) {
    try {
      const r = await fillMissingMeta(10);
      if (r?.rateLimitedFor) await setSetting("musicRepairPauseUntil", String(Date.now() + (r.rateLimitedFor + 5) * 1000));
      fill = r ?? undefined;
    } catch (err) {
      reportWarn("music", "meta fill failed:", err);
    }
  }
  // Hourly: pull new songs from the imported Spotify lists.
  let sync: unknown = undefined;
  if (Date.now() - Number(s.musicSyncLast || 0) > SYNC_EVERY_MS) {
    await setSetting("musicSyncLast", String(Date.now())); // claim first: a failure must not retry every minute
    try {
      const r = await runSync();
      if (r.added > 0) reportInfo("music", `auto-sync: ${r.added} new song(s) from ${r.sources} Spotify list(s)`);
      if (r.errors.length) reportWarn("music", `auto-sync errors: ${r.errors.join("; ")}`);
      sync = r;
    } catch (err) {
      reportWarn("music", "auto-sync failed:", err);
    }
  }
  // Fallback: one "Track not found" track per tick via spotDL (runs in the
  // background; guarded by its own lock).
  void analysisStep().catch((err) => reportWarn("music", "analysis step failed:", err));
  void spotdlFallbackStep().catch((err) => reportWarn("music", "spotDL fallback failed:", err));
  return NextResponse.json({ ok: true, ...(await kickMusicQueue()), repair, verify, fill, sync });
}
