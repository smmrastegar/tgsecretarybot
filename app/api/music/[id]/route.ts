import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { deleteMusicTrack, getAllSettings, getMusicTrack, setSetting, setTrackMeta, updateMusicTrack } from "@/lib/db";
import { canAccessTrack, editAccess, notFound } from "@/lib/music-token";
import { kickMusicQueue, removeMusicFiles } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_r: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const gone = await deleteMusicTrack(id);
  if (gone) await removeMusicFiles([gone.filePath, gone.coverPath]);
  return NextResponse.json({ ok: true });
}

// POST = retry a failed track.
export async function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  // A song the owner sent by hand has no source to download again.
  if ((await getMusicTrack(id))?.source === "manual") return NextResponse.json({ error: "این آهنگ دستی است؛ دانلود دوباره ندارد" }, { status: 400 });
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

// PATCH { title, artist, album? }: fix a song's names. The dashboard, or a player link that may edit (the Main link by default).
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const access = await editAccess(request);
  if (!access) return notFound();
  const id = Number((await ctx.params).id);
  const t = Number.isFinite(id) ? await getMusicTrack(id) : null;
  if (!t || !(await canAccessTrack(access, id))) return NextResponse.json({ error: "no such song" }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { title?: string; artist?: string; album?: string };
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : undefined;
  const artist = typeof b.artist === "string" ? b.artist.trim().slice(0, 200) : undefined;
  const album = typeof b.album === "string" ? b.album.trim().slice(0, 200) : undefined;
  if (title === "" || artist === "") return NextResponse.json({ error: "title and artist cannot be empty" }, { status: 400 });
  if (t.source === "soundcloud" && (title !== undefined || artist !== undefined)) await setTrackMeta(id, { title, artist, state: "manual", suggestions: null }); // the automatic name cleanup leaves it alone from now on
  else await updateMusicTrack(id, { title, artist });
  if (album !== undefined) await updateMusicTrack(id, { album: album || null });
  return NextResponse.json({ ok: true });
}
