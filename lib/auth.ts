import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { isAllowedUser } from "./db";
import { SESSION_COOKIE_NAME, SESSION_TTL, readSessionFromToken, type Session } from "./session";

export type { Session };
export {
  SESSION_COOKIE_NAME,
  createSession,
  readSessionFromToken,
} from "./session";

export async function getCurrentSession(): Promise<Session | null> {
  const store = await cookies();
  const c = store.get(SESSION_COOKIE_NAME);
  if (!c?.value) return null;
  return readSessionFromToken(c.value);
}

// The one-line route guard. 78 routes carried the same 5-line
// try/catch around requireSession(); 61 more called it bare, which
// throws — and a thrown 401 surfaces from Next as a 500. Both shapes
// now collapse to:  const guard = await requireSessionOr401(); if (guard) return guard;
export async function requireSessionOr401(): Promise<NextResponse | null> {
  const s = await getCurrentSession();
  if (s) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function requireSession(): Promise<Session> {
  const s = await getCurrentSession();
  if (!s) throw Object.assign(new Error("unauthorized"), { status: 401 });
  return s;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

// --- Telegram Login Widget verification ---

export type TelegramLoginPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export function verifyTelegramLogin(
  payload: TelegramLoginPayload,
  botToken: string,
  maxAgeSeconds = 86400,
): boolean {
  const { hash, ...rest } = payload;
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.auth_date;
  if (ageSeconds > maxAgeSeconds) return false;
  return true;
}

export async function userIsAllowed(userId: number): Promise<boolean> {
  return isAllowedUser(userId);
}
