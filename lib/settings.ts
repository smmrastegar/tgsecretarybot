import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  envOverride,
  type SettingKey,
} from "./config";
import { getAllSettings, setSetting, hasDb } from "./db";
import { redisDelete, redisEnabled, redisGet, redisSet } from "./redis";

type SettingsCache = { values: Record<SettingKey, string>; expiresAt: number };
let cache: SettingsCache | null = null;
const TTL_SECONDS = 30;
const REDIS_KEY = "tgsb:settings";

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

  if (redisEnabled()) {
    const cached = await redisGet<Record<SettingKey, string>>(REDIS_KEY);
    if (cached && typeof cached === "object") {
      const values = { ...DEFAULT_SETTINGS, ...cached } as Record<SettingKey, string>;
      cache = { values, expiresAt: Date.now() + TTL_SECONDS * 1000 };
      return values;
    }
  }

  const values = await loadSettings();
  cache = { values, expiresAt: Date.now() + TTL_SECONDS * 1000 };
  if (redisEnabled()) {
    await redisSet(REDIS_KEY, values, TTL_SECONDS);
  }
  return values;
}

export function invalidateSettingsCache(): void {
  cache = null;
  if (redisEnabled()) {
    void redisDelete(REDIS_KEY);
  }
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
