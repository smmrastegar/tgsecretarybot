import { allowedTrackIds, musicAccess, notFound } from "@/lib/music-token";
import { getMusicStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  const allowed = await allowedTrackIds(access);
  return Response.json(await getMusicStats(allowed ? [...allowed] : null), { headers: { "Cache-Control": "no-store" } });
}
