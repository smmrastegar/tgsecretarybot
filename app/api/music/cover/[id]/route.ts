import { promises as fs } from "node:fs";
import { requireSessionOr401 } from "@/lib/auth";
import { getMusicTrack } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_r: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const t = await getMusicTrack(Number((await ctx.params).id));
  if (!t?.coverPath) return new Response("none", { status: 404 });
  const buf = await fs.readFile(t.coverPath).catch(() => null);
  if (!buf) return new Response("missing", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
