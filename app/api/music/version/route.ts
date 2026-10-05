import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { authorizeMusic, notFound } from "@/lib/music-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The deployed build id, so an open or installed player can notice a new
// deploy and reload itself.
let id: string | null = null;
function buildId(): string {
  if (id) return id;
  try { id = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim(); } catch { id = "dev"; }
  return id;
}
export async function GET(request: Request): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  return NextResponse.json({ build: buildId() }, { headers: { "Cache-Control": "no-store" } });
}
