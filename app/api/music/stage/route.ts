import { NextResponse } from "next/server";
import { editAccess, notFound } from "@/lib/music-token";
import { MAX_UPLOAD } from "@/lib/music-edit";
import { stageFile } from "@/lib/music-stage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST multipart { file }: save an audio file WITHOUT adding it to the library; the answer says what it is (length, size, tags) so the owner can listen and confirm.
export async function POST(request: Request): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ error: "file too large (120 MB max)" }, { status: 413 });
  try {
    const { token, name, sizeBytes, durationS, tags } = await stageFile({ data: new Uint8Array(await file.arrayBuffer()), name: file.name });
    return NextResponse.json({ ok: true, token, name, sizeBytes, durationS, tags });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 415 }); }
}
