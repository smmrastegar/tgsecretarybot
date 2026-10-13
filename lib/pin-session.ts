import { NextResponse } from "next/server";
import { listMusicPins } from "./db";
import type { Session } from "./session";

// A numeric-password session is only as strong as its password: switching the password off or deleting it ends
// the session, and the password's Spotify-account limits apply live to every request the session makes.
export type PinScope = { ids: number[]; mode: "any" | "all" };
export type PinState = { ok: boolean; scope: PinScope | null };

let cache: { at: number; pins: Awaited<ReturnType<typeof listMusicPins>> } | null = null;
async function pins() {
  if (!cache || Date.now() - cache.at > 5000) cache = { at: Date.now(), pins: await listMusicPins() };
  return cache.pins;
}

export async function pinState(s: Session | null): Promise<PinState> {
  if (!s || s.scope !== "music" || s.pinId == null) return { ok: !!s, scope: null }; // owner login, or an older session from before passwords were listed
  const p = (await pins()).find((x) => x.id === s.pinId);
  if (!p || !p.active) return { ok: false, scope: null };
  return { ok: true, scope: p.accountIds.length ? { ids: p.accountIds, mode: p.accountsMode } : null };
}

/** For routes a limited password must never reach (links, playlists, repairs …). Owner logins and unlimited passwords pass. */
export async function forbidScopedPin(s: Session | null): Promise<NextResponse | null> {
  const st = await pinState(s);
  if (!st.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (st.scope) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}
