import { NextResponse } from "next/server";
import { editAccess, notFound } from "@/lib/music-token";
import { MAX_UPLOAD } from "@/lib/music-edit";
import { finalizeUpload } from "@/lib/music-intake";
import { reportInfo, reportWarn } from "@/lib/report";
import { discardStaged, getStaged } from "@/lib/music-stage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST multipart { file, title, artist }: the file of a waiting song. Names as typed; the cover is the picture posted in the channel before it (else the one inside the file).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const id = Number((await ctx.params).id);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const stagedToken = String(form?.get("staged") ?? "");
  const staged = stagedToken ? await getStaged(stagedToken) : null;
  const title = String(form?.get("title") ?? "").trim(), artist = String(form?.get("artist") ?? "").trim();
  if (!Number.isFinite(id) || (!staged && !(file instanceof File))) return NextResponse.json({ error: stagedToken ? "that upload is gone; choose the file again" : "file required" }, { status: stagedToken ? 404 : 400 });
  if (!title || !artist) return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
  if (!staged && file instanceof File && file.size > MAX_UPLOAD) return NextResponse.json({ error: "file too large (120 MB max)" }, { status: 413 });
  const t0 = Date.now();
  const label = staged ? `${staged.name} (staged)` : (file as File).name;
  try {
    const trackId = await finalizeUpload(id, staged ? { path: staged.path, name: staged.name } : { data: new Uint8Array(await (file as File).arrayBuffer()), name: (file as File).name }, title.slice(0, 200), artist.slice(0, 200));
    if (staged) await discardStaged(staged.token);
    reportInfo("music", `upload for waiting item ${id}: ${label} → song ${trackId} in ${Math.round((Date.now() - t0) / 1000)} s`);
    return NextResponse.json({ ok: true, id: trackId });
  } catch (e) {
    reportWarn("music", `upload for waiting item ${id} (${label}) failed after ${Math.round((Date.now() - t0) / 1000)} s:`, e);
    return NextResponse.json({ error: e instanceof Error && e.message ? e.message : "The server could not process this file" }, { status: 400 });
  }
}
