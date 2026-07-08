import { createHmac, timingSafeEqual } from "crypto";

// Unguessable, stable per-email token so email cards in Telegram can
// link to a PUBLIC (no-login) view of the email + its attachments —
// same idea as the /share group links. The token is an HMAC of the
// email id, so it never expires and needs no DB row.
function secret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.WEBHOOK_SECRET_TOKEN ||
    "dev-session-secret-change-me"
  );
}

export function emailLinkToken(emailId: number): string {
  return createHmac("sha256", secret())
    .update(`email:${emailId}`)
    .digest("hex")
    .slice(0, 24);
}

export function verifyEmailLink(emailId: number, token: string): boolean {
  if (!token) return false;
  const expected = emailLinkToken(emailId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
