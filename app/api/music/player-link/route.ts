import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { config } from "@/lib/config";
import { getPlayerToken, rotatePlayerToken } from "@/lib/music-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function link(t: string): string {
  return `${(config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "")}/player/${t}`;
}

// GET → the private link; POST → rotate (old link stops working at once).
export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  return NextResponse.json({ url: link(await getPlayerToken()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  return NextResponse.json({ url: link(await rotatePlayerToken()) }, { headers: { "Cache-Control": "no-store" } });
}
