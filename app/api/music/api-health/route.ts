import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { getAllSettings, listApiHealth } from "@/lib/db";
import { noteApi, probeApis } from "@/lib/api-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → the last 7 days of Spotify / SoundCloud call outcomes + the state the latest probe saw.
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const [days, s] = await Promise.all([listApiHealth(7), getAllSettings()]);
  const pausedUntil = Number(s.scMetaPauseUntil || 0);
  return NextResponse.json({
    days,
    state: { spotify: s.apiProbe_spotify ?? "ok", soundcloud: s.apiProbe_soundcloud ?? "ok" },
    probedAt: Number(s.apiProbeAt || 0) || null,
    cleanupPausedUntil: pausedUntil > Date.now() ? pausedUntil : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

// POST → probe both providers right now (one call each).
export async function POST(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const results = await probeApis();
  for (const r of results) noteApi(r.provider, r.ok ? "ok" : r.status === 429 ? "limited" : "error", { retryAfterS: r.retryAfterS, error: r.ok ? undefined : r.detail });
  return NextResponse.json({ results });
}
