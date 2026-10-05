// Private player link: /player/<token>. The token is 32 random bytes
// (256 bits, unguessable), kept in settings, rotatable. Whoever holds
// the link can play the library, like/dislike — nothing else: adding,
// deleting and the Spotify login stay behind the dashboard login.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getCurrentSession } from "./auth";
import { getAllSettings, setSetting } from "./db";

const KEY = "musicPlayerToken";

export async function getPlayerToken(): Promise<string> {
  const cur = ((await getAllSettings())[KEY] ?? "").trim();
  if (cur.length >= 40) return cur;
  return rotatePlayerToken();
}

export async function rotatePlayerToken(): Promise<string> {
  const t = randomBytes(32).toString("base64url");
  await setSetting(KEY, t);
  return t;
}

export async function isValidPlayerToken(presented: string | null | undefined): Promise<boolean> {
  const p = (presented ?? "").trim();
  if (p.length < 40) return false;
  const cur = ((await getAllSettings())[KEY] ?? "").trim();
  if (cur.length !== p.length) return false;
  try {
    return timingSafeEqual(Buffer.from(p), Buffer.from(cur));
  } catch {
    return false;
  }
}

/** Dashboard session OR the private player token (?t= or x-player-token). */
export async function authorizeMusic(request: Request): Promise<boolean> {
  if (await getCurrentSession().catch(() => null)) return true;
  const url = new URL(request.url);
  return isValidPlayerToken(url.searchParams.get("t") ?? request.headers.get("x-player-token"));
}

// 404, not 401: a wrong token must not confirm that the endpoint exists.
export function notFound(): Response {
  return new Response("not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } });
}
