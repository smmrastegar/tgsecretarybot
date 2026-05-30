import { SignJWT, jwtVerify } from "jose";
import type { Session } from "./session";

const MAGIC_TTL_SECONDS = 5 * 60;

function key(): Uint8Array {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ||
      process.env.WEBHOOK_SECRET_TOKEN ||
      "dev-session-secret-change-me",
  );
}

export async function createMagicToken(session: Session): Promise<string> {
  return new SignJWT({ ...session, purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_TTL_SECONDS}s`)
    .sign(key());
}

export async function readMagicToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.purpose !== "magic") return null;
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
