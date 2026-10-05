import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { disconnectSpotify, getSpotifyConfig, redirectUri, saveSpotifyCredentials } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const c = await getSpotifyConfig();
  return NextResponse.json({ hasCredentials: Boolean(c.clientId && c.clientSecret), clientId: c.clientId, connected: Boolean(c.refreshToken), redirectUri: redirectUri() });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string; disconnect?: boolean };
  if (b.disconnect) { await disconnectSpotify(); return NextResponse.json({ ok: true }); }
  if (!b.clientId?.trim()) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  await saveSpotifyCredentials(b.clientId, b.clientSecret ?? "");
  return NextResponse.json({ ok: true });
}
