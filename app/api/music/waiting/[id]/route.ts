import { NextResponse } from "next/server";
import { editAccess, notFound } from "@/lib/music-token";
import { MAX_UPLOAD } from "@/lib/music-edit";
import { finalizeUpload } from "@/lib/music-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST multipart { file, title, artist }: the file of a waiting song. Names as typed; the cover is the picture posted in the channel before it (else the one inside the file).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const id = Number((await ctx.params).id);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const title = String(form?.get("title") ?? "").trim(), artist = String(form?.get("artist") ?? "").trim();
  if (!Number.isFinite(id) || !(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (!title || !artist) return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ error: "file too large (120 MB max)" }, { status: 413 });
  try {
    const trackId = await finalizeUpload(id, { data: new Uint8Array(await file.arrayBuffer()), name: file.name }, title.slice(0, 200), artist.slice(0, 200));
    return NextResponse.json({ ok: true, id: trackId });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
