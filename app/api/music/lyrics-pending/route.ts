import { NextResponse } from "next/server";
import { editAccess, notFound } from "@/lib/music-token";
import { savePendingLyricsImage } from "@/lib/music-lyrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart { title, image }: a lyrics picture for a song that is not in the library yet; it is attached when a song with this title is added.
export async function POST(request: Request): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const form = await request.formData().catch(() => null);
  const title = String(form?.get("title") ?? "").trim();
  const img = form?.get("image");
  if (!title || !(img instanceof File) || img.size === 0) return NextResponse.json({ error: "title and image required" }, { status: 400 });
  try { return NextResponse.json({ ok: true, key: await savePendingLyricsImage(title, new Uint8Array(await img.arrayBuffer())) }); }
  catch { return NextResponse.json({ error: "that file is not a readable picture" }, { status: 415 }); }
}
