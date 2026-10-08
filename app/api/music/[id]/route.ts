import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteMusicTrack, getAllSettings, getMusicTrack, setSetting, updateMusicTrack } from "@/lib/db";
import { kickMusicQueue, removeMusicFiles } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_r: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const gone = await deleteMusicTrack(id);
  if (gone) await removeMusicFiles([gone.filePath, gone.coverPath]);
  return NextResponse.json({ ok: true });
}

// POST = retry a failed track.
export async function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  // ?via=spotsaver: skip the Telegram bot and fetch a fresh copy through the SpotSaver subscription
  // (the background fallback picks it up within a minute and replaces the file).
  if (new URL(request.url).searchParams.get("via") === "spotsaver") {
    const t = await getMusicTrack(id);
    if (t?.status === "ready") {
      // keep playing the current file until the new one is in
      let list: number[] = [];
      try { list = JSON.parse((await getAllSettings()).spotsaverRedo || "[]") as number[]; } catch { /* reset */ }
      await setSetting("spotsaverRedo", JSON.stringify([...new Set([...list, id])].slice(-50)));
    } else await updateMusicTrack(id, { status: "failed", error: "Track not found" });
    return NextResponse.json({ ok: true, via: "spotsaver" });
  }
  await updateMusicTrack(id, { status: "queued", error: null });
  await kickMusicQueue().catch(() => {});
  return NextResponse.json({ ok: true });
}
