import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All notes/watchlist global knobs live in the `settings` key-value
// table; we just project them out here so the UI gets a tidy JSON
// shape to bind to.
const KEYS = [
  "notesWatchlistEnabled",
  "notesWatchlistForwardToInbox",
  "notesWatchlistCooldownMinutes",
  "notesWatchlistMinMessageLength",
  "notesAutoArchiveDays",
  "notesDailyDigestEnabled",
  "notesDailyDigestHourUTC",
] as const;
type Key = (typeof KEYS)[number];

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const s = await getSettings();
  const out: Partial<Record<Key, string>> = {};
  for (const k of KEYS) out[k] = s[k];
  return NextResponse.json({ settings: out });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as Partial<
    Record<Key, string>
  >;
  const patch: Partial<Record<Key, string>> = {};
  for (const k of KEYS) {
    if (body[k] === undefined) continue;
    patch[k] = String(body[k]);
  }
  await updateSettings(patch);
  const s = await getSettings();
  const out: Partial<Record<Key, string>> = {};
  for (const k of KEYS) out[k] = s[k];
  return NextResponse.json({ settings: out });
}
