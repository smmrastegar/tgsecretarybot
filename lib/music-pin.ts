import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getAllSettings, setSetting } from "@/lib/db";
import type { Session } from "@/lib/session";

// The numeric password for the music pages (playlist.bz). It only ever yields a session with
// scope "music" — the owner's account, but limited to the player — so a guessed PIN cannot reach
// the rest of the dashboard. Stored as a salted scrypt hash in settings.musicPin; wrong guesses
// are throttled per address and overall.
export const PIN_RE = /^\d{6,10}$/;

type Stored = { salt: string; hash: string; userId: number; username: string | null; firstName: string | null };

const digest = (pin: string, salt: string) => scryptSync(pin, Buffer.from(salt, "hex"), 32);

export async function pinConfigured(): Promise<boolean> {
  return Boolean((await getAllSettings()).musicPin);
}

export async function setPin(pin: string, owner: Session): Promise<void> {
  const salt = randomBytes(16).toString("hex");
  const stored: Stored = { salt, hash: digest(pin, salt).toString("hex"), userId: owner.userId, username: owner.username ?? null, firstName: owner.firstName ?? null };
  await setSetting("musicPin", JSON.stringify(stored), owner.userId);
}

export async function clearPin(actorId?: number): Promise<void> {
  await setSetting("musicPin", "", actorId);
}

// In-memory throttle (a restart resets it, which only helps the owner).
const byIp = new Map<string, { n: number; until: number }>();
let global = { n: 0, since: Date.now(), until: 0 };
const IP_MAX = 5, IP_LOCK = 15 * 60_000, GLOBAL_MAX = 40, GLOBAL_WINDOW = 3_600_000;

export async function checkPin(pin: string, ip: string): Promise<{ ok: true; session: Session } | { ok: false; error: string; status: number }> {
  const now = Date.now();
  const rec = byIp.get(ip);
  if ((rec && rec.until > now) || global.until > now) return { ok: false, error: "تلاش‌های زیاد؛ کمی بعد دوباره امتحان کن", status: 429 };
  const raw = (await getAllSettings()).musicPin;
  let st: Stored | null = null;
  try { st = raw ? (JSON.parse(raw) as Stored) : null; } catch { st = null; }
  if (!st) return { ok: false, error: "رمز عددی هنوز تنظیم نشده (از داشبورد اصلی تنظیمش کن)", status: 404 };
  const good = PIN_RE.test(pin) && timingSafeEqual(digest(pin, st.salt), Buffer.from(st.hash, "hex"));
  if (!good) {
    const r = rec && rec.until <= now && rec.n < IP_MAX ? rec : { n: 0, until: 0 };
    r.n += 1; if (r.n >= IP_MAX) { r.until = now + IP_LOCK; r.n = 0; }
    byIp.set(ip, r);
    if (now - global.since > GLOBAL_WINDOW) global = { n: 0, since: now, until: 0 };
    global.n += 1; if (global.n >= GLOBAL_MAX) global.until = now + GLOBAL_WINDOW;
    return { ok: false, error: "رمز اشتباه است", status: 401 };
  }
  byIp.delete(ip);
  return { ok: true, session: { userId: st.userId, username: st.username, firstName: st.firstName, scope: "music" } };
}
