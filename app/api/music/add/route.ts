import { NextResponse } from "next/server";
import { editAccess, notFound } from "@/lib/music-token";
import { addUploadedSong, MAX_UPLOAD } from "@/lib/music-edit";
import { discardStaged, getStaged } from "@/lib/music-stage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST multipart { file, title?, artist?, cover? }: add a song by uploading its file. The dashboard, or a player link that may edit (the Main link by default).
export async function POST(request: Request): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const stagedToken = String(form?.get("staged") ?? "");
  const staged = stagedToken ? await getStaged(stagedToken) : null;
  if (!staged && !(file instanceof File)) return NextResponse.json({ error: stagedToken ? "that upload is gone; choose the file again" : "file required" }, { status: stagedToken ? 404 : 400 });
  if (!staged && file instanceof File && file.size > MAX_UPLOAD) return NextResponse.json({ error: "file too large (120 MB max)" }, { status: 413 });
  const cover = form?.get("cover");
  try {
    const r = await addUploadedSong(staged ? { path: staged.path, name: staged.name } : { data: new Uint8Array(await (file as File).arrayBuffer()), name: (file as File).name }, {
      title: String(form?.get("title") ?? ""), artist: String(form?.get("artist") ?? ""), album: String(form?.get("album") ?? ""),
      cover: cover instanceof File && cover.size > 0 ? new Uint8Array(await cover.arrayBuffer()) : null,
    });
    if (staged) await discardStaged(staged.token);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 415 }); }
}
