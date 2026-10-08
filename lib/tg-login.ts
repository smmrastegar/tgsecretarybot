import { createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** URL-safe, ≤ 64 chars (Telegram start payload limit), unguessable. */
export const newToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
export const LOGIN_COOKIE = "tgl";
