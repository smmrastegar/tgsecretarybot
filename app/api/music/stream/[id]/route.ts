import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { requireSessionOr401 } from "@/lib/auth";
import { getMusicTrack } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Audio with HTTP Range support (seeking, iOS/Safari need it).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const t = await getMusicTrack(Number((await ctx.params).id));
  if (!t?.filePath) return new Response("not found", { status: 404 });
  const st = await fs.stat(t.filePath).catch(() => null);
  if (!st) return new Response("missing", { status: 404 });
  const size = st.size;
  const headers: Record<string, string> = {
    "Content-Type": t.mime ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (m) {
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : size - 1;
    if (!m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    end = Math.min(end, size - 1);
    const stream = Readable.toWeb(createReadStream(t.filePath, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(t.filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
