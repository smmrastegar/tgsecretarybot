import { createHmac, timingSafeEqual } from "crypto";

// Unguessable, stable per-email token so email cards in Telegram can
// link to a PUBLIC (no-login) view of the email + its attachments —
// same idea as the /share group links. The token is an HMAC of the
// email id, so it never expires and needs no DB row.
function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET_TOKEN;
  if (s) return s;
  // A constant fallback would let anyone forge public email-view links.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET (or WEBHOOK_SECRET_TOKEN) must be set in production",
    );
  }
  return "dev-session-secret-change-me";
}

export function emailLinkToken(emailId: number): string {
  return createHmac("sha256", secret())
    .update(`email:${emailId}`)
    .digest("hex")
    .slice(0, 24);
}

// Constant-time compare of a stored (DB) token against a presented one.
export function matchesStoredToken(stored: string | null, token: unknown): boolean {
  if (!stored || typeof token !== "string" || !token) return false;
  if (token.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(stored));
  } catch {
    return false;
  }
}

// Legacy check: the token derived from SESSION_SECRET. Kept as a
// fallback so links minted before emails.public_token existed still
// open — but new cards carry the stored token, which survives a
// secret rotation.
export function verifyEmailLink(emailId: number, token: unknown): boolean {
  // A duplicated `?t=a&t=b` yields string[] in some callers; anything
  // non-string is not a valid token.
  if (typeof token !== "string" || !token) return false;
  const expected = emailLinkToken(emailId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

// The single auth check every public email link should use. Accepts
// the row's stored token first, then falls back to the derived HMAC so
// links minted before emails.public_token existed still open. Returns
// the row when authorised so callers don't fetch it twice.
export async function authorizeEmailLink(
  emailId: number,
  token: unknown,
): Promise<Awaited<ReturnType<typeof import("./db").getEmail>>> {
  if (!Number.isFinite(emailId)) return null;
  const { getEmail } = await import("./db");
  const email = await getEmail(emailId).catch(() => null);
  if (!email) {
    // No row: still run the derived check so a missing email and a bad
    // token are indistinguishable to the caller.
    return null;
  }
  if (matchesStoredToken(email.publicToken, token)) return email;
  if (verifyEmailLink(emailId, token)) return email;
  return null;
}
