import { allowedTrackIds, musicAccess, notFound } from "@/lib/music-token";
import { getLinkStats, getMusicStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  const headers = { "Cache-Control": "no-store" };
  // Dashboard: everything. A player link: only its own listening, likes and songs.
  if (access.kind === "session") return Response.json(await getMusicStats(null), { headers });
  const allowed = await allowedTrackIds(access);
  return Response.json(await getLinkStats(access.linkId, allowed ? [...allowed] : null), { headers });
}
