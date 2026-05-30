import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  envOverride,
  type SettingKey,
} from "./config";
import { getAllSettings, setSetting, hasDb } from "./db";

type SettingsCache = { values: Record<SettingKey, string>; expiresAt: number };
let cache: SettingsCache | null = null;
const TTL_MS = 30_000;

async function loadSettings(): Promise<Record<SettingKey, string>> {
  const out = { ...DEFAULT_SETTINGS } as Record<SettingKey, string>;
  if (hasDb()) {
    try {
      const stored = await getAllSettings();
      for (const k of SETTING_KEYS) {
        if (stored[k] !== undefined) out[k] = stored[k]!;
      }
    } catch (err) {
      console.error("[settings] load failed:", err);
    }
  }
  for (const k of SETTING_KEYS) {
    const env = envOverride(k);
    if (env !== undefined) out[k] = env;
  }
  return out;
}

export async function getSettings(): Promise<Record<SettingKey, string>> {
  if (cache && Date.now() < cache.expiresAt) return cache.values;
  const values = await loadSettings();
  cache = { values, expiresAt: Date.now() + TTL_MS };
  return values;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function get<K extends SettingKey>(key: K): Promise<string> {
  const s = await getSettings();
  return s[key];
}

export async function getNumber(
  key: SettingKey,
  fallback = 0,
): Promise<number> {
  const v = await get(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getBool(key: SettingKey): Promise<boolean> {
  const v = (await get(key)).toLowerCase();
  return v !== "false" && v !== "0" && v !== "";
}

export async function updateSettings(
  patch: Partial<Record<SettingKey, string>>,
  actorId?: number,
): Promise<Record<SettingKey, string>> {
  if (!hasDb()) throw new Error("DATABASE_URL not configured");
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(k as SettingKey)) continue;
    await setSetting(k, v ?? "", actorId);
  }
  invalidateSettingsCache();
  return getSettings();
}

export type SettingsView = Record<SettingKey, string>;
