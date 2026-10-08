import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getMusicTrack, updateMusicTrack } from "@/lib/db";
import { MUSIC_DIR } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX = 120 * 1024 * 1024;
const EXT: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", wav: "audio/wav" };

// POST multipart (field "file"): the owner supplies the audio of a track the downloaders could
// not find. Dashboard session only. The track becomes "ready" with Spotify's own length.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const t = Number.isFinite(id) ? await getMusicTrack(id) : null;
  if (!t) return NextResponse.json({ error: "no such track" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "file too large (120 MB max)" }, { status: 413 });
  const e = (/\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1] ?? "").toLowerCase();
  if (!EXT[e]) return NextResponse.json({ error: "supported: mp3, m4a, aac, ogg, opus, flac, wav" }, { status: 415 });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  const dest = path.join(MUSIC_DIR, `${id}.${e}`);
  if (t.filePath && t.filePath !== dest) await fs.unlink(t.filePath).catch(() => {});
  await fs.writeFile(dest, buf);
  await updateMusicTrack(id, { filePath: dest, mime: EXT[e], sizeBytes: buf.length, durationS: t.spotifyDurationS ?? t.durationS ?? null, status: "ready", error: null });
  return NextResponse.json({ ok: true, size: buf.length });
}
