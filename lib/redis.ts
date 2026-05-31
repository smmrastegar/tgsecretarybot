import { Redis } from "@upstash/redis";

let cached: Redis | null = null;
let configured: boolean | null = null;

export function redisEnabled(): boolean {
  if (configured !== null) return configured;
  configured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
  return configured;
}

export function getRedis(): Redis | null {
  if (!redisEnabled()) return null;
  if (!cached) cached = Redis.fromEnv();
  return cached;
}

export async function redisGet<T = unknown>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const v = await r.get<T>(key);
    return v ?? null;
  } catch (err) {
    console.error("[redis] get failed:", err);
    return null;
  }
}

export async function redisSet(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    if (ttlSeconds && ttlSeconds > 0) {
      await r.set(key, value, { ex: ttlSeconds });
    } else {
      await r.set(key, value);
    }
  } catch (err) {
    console.error("[redis] set failed:", err);
  }
}

export async function redisDelete(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch (err) {
    console.error("[redis] del failed:", err);
  }
}
