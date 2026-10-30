import { NextResponse } from "next/server";
import { canAccessTrack, editAccess, notFound } from "@/lib/music-token";
import { getMusicTrack } from "@/lib/db";
import { replaceSongAudio } from "@/lib/music-edit";
import { discardStaged, getStaged } from "@/lib/music-stage";
import { background } from "@/lib/background";
import { syncChannelCopy } from "@/lib/music-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { staged }: replace this song's audio with a file the owner staged (listened to and confirmed). Likes, plays, playlists, cover and lyrics stay.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await editAccess(request);
  if (!access) return notFound();
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id) || !(await getMusicTrack(id)) || !(await canAccessTrack(access, id))) return NextResponse.json({ error: "no such song" }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { staged?: string };
  const s = await getStaged(String(b.staged ?? ""));
  if (!s) return NextResponse.json({ error: "that upload is gone; choose the file again" }, { status: 404 });
  try { await replaceSongAudio(id, s); await discardStaged(s.token); background("musicChannelSync", syncChannelCopy(id)); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "could not replace the audio" }, { status: 400 }); }
}
