import { NextResponse } from "next/server";
import { canAccessTrack, editAccess, notFound } from "@/lib/music-token";
import { getMusicTrack } from "@/lib/db";
import { saveCover } from "@/lib/music-edit";
import { background } from "@/lib/background";
import { syncChannelCopy } from "@/lib/music-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart { image }: a new cover for one song. The dashboard, or a player link that may edit.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await editAccess(request);
  if (!access) return notFound();
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id) || !(await getMusicTrack(id)) || !(await canAccessTrack(access, id))) return NextResponse.json({ error: "no such song" }, { status: 404 });
  const img = (await request.formData().catch(() => null))?.get("image");
  if (!(img instanceof File) || img.size === 0) return NextResponse.json({ error: "image required" }, { status: 400 });
  if (img.size > 25 * 1024 * 1024) return NextResponse.json({ error: "image too large (25 MB max)" }, { status: 413 });
  try { await saveCover(id, new Uint8Array(await img.arrayBuffer())); background("musicChannelSync", syncChannelCopy(id)); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: "that file is not a readable picture" }, { status: 415 }); }
}
