import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { editAccess, notFound } from "@/lib/music-token";
import { discardStaged, getStaged } from "@/lib/music-stage";
import { AUDIO_TYPES } from "@/lib/music-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };

// GET → the staged audio (with Range, so the preview can seek).
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const s = await getStaged((await ctx.params).token);
  if (!s) return new Response("gone", { status: 404 });
  const size = (await fs.stat(s.path)).size;
  const headers: Record<string, string> = { "Content-Type": AUDIO_TYPES[s.ext] ?? "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (m) {
    let start = m[1] ? Number(m[1]) : 0, end = m[2] ? Number(m[2]) : size - 1;
    if (!m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    end = Math.min(end, size - 1);
    return new Response(Readable.toWeb(createReadStream(s.path, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(s.path)) as ReadableStream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

// DELETE → throw the staged file away.
export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  await discardStaged((await ctx.params).token);
  return NextResponse.json({ ok: true });
}
