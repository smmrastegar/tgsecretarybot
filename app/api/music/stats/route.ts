import { authorizeMusic, notFound } from "@/lib/music-token";
import { getMusicStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  return Response.json(await getMusicStats(), { headers: { "Cache-Control": "no-store" } });
}
