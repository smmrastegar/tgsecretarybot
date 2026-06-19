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

// Push a value to the head of a list, cap the list to maxLength, and
// reset the key TTL. Used for short-lived ring buffers (debug log,
// rate counters) where DB writes would be overkill.
export async function redisListPush(args: {
  key: string;
  value: unknown;
  maxLength?: number;
  ttlSeconds?: number;
}): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.lpush(args.key, JSON.stringify(args.value));
    if (args.maxLength && args.maxLength > 0) {
      await r.ltrim(args.key, 0, args.maxLength - 1);
    }
    if (args.ttlSeconds && args.ttlSeconds > 0) {
      await r.expire(args.key, args.ttlSeconds);
    }
  } catch (err) {
    console.error("[redis] lpush failed:", err);
  }
}

export async function redisListRange<T = unknown>(
  key: string,
  start = 0,
  end = -1,
): Promise<T[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    const items = (await r.lrange(key, start, end)) as Array<string | T>;
    const out: T[] = [];
    for (const it of items) {
      if (typeof it === "string") {
        try {
          out.push(JSON.parse(it) as T);
        } catch {
          // skip malformed
        }
      } else {
        out.push(it as T);
      }
    }
    return out;
  } catch (err) {
    console.error("[redis] lrange failed:", err);
    return [];
  }
}
