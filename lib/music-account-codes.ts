// The short code shown next to a song's source (Spotify / SoundCloud account, or Direct). The player works one out by itself from the name;
// the owner can type their own for any account. Stored as { "<accountId>": "ABC" } in one setting.
import { getAllSettings, setSetting } from "./db";

const KEY = "musicAccountCodes";
export const cleanCode = (raw: unknown): string => String(raw ?? "").replace(/[\s‌]+/g, "").slice(0, 4).toUpperCase();

export async function getAccountCodes(): Promise<Record<string, string>> {
  try {
    const j = JSON.parse((await getAllSettings())[KEY] || "{}") as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) { const c = cleanCode(v); if (/^\d+$/.test(k) && c) out[k] = c; }
    return out;
  } catch { return {}; }
}

/** An empty code puts the account back on automatic. */
export async function setAccountCode(id: number, code: string): Promise<void> {
  const all = await getAccountCodes();
  const c = cleanCode(code);
  if (c) all[String(id)] = c; else delete all[String(id)];
  await setSetting(KEY, JSON.stringify(all));
}
