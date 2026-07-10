import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "tgsb_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type Session = {
  userId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
};

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET_TOKEN;
  if (s) return s;
  // In production a missing secret means the JWT would be signed with a
  // publicly-known constant — anyone could forge a session for any
  // userId. Refuse rather than run with a guessable key.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET (or WEBHOOK_SECRET_TOKEN) must be set in production",
    );
  }
  return "dev-session-secret-change-me";
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(sessionSecret());
}

export async function createSession(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionFromToken(
  token: string,
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== "number") return null;
    return {
      userId: payload.userId,
      username: (payload.username as string) ?? null,
      firstName: (payload.firstName as string) ?? null,
      lastName: (payload.lastName as string) ?? null,
      photoUrl: (payload.photoUrl as string) ?? null,
    };
  } catch {
    return null;
  }
}

export const SESSION_TTL = SESSION_TTL_SECONDS;
