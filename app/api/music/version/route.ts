import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { musicAccess, notFound } from "@/lib/music-token";

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
  const access = await musicAccess(request);
  if (!access) return notFound();
  // Who this is, for Settings → About: the Main link, one of the extra links (by name), or the dashboard / numeric-password session.
  const who = access.kind === "link" ? { name: access.name, kind: access.linkId === 0 ? "main" : "link" } : { name: "Dashboard login", kind: "session" };
  return NextResponse.json({ build: buildId(), who }, { headers: { "Cache-Control": "no-store" } });
}
