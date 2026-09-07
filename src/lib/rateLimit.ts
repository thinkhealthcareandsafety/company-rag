import { Redis } from "@upstash/redis";
import { getRedisEnv } from "@/lib/env";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

let redis: Redis | undefined;
function getRedis(): Redis | undefined {
  if (redis) return redis;
  const env = getRedisEnv();
  if (!env) return undefined;
  redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

const hits = new Map<string, number[]>();

/**
 * In-memory sliding-window limiter, keyed per user. Only correct for a single
 * Next.js instance — used as the fallback when Redis isn't configured.
 */
function isRateLimitedInMemory(key: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const existing = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (existing.length >= MAX_REQUESTS_PER_WINDOW) {
    hits.set(key, existing);
    return true;
  }

  existing.push(now);
  hits.set(key, existing);
  return false;
}

/**
 * Redis-backed sliding window using a sorted set per key: each request is a
 * member scored by its own timestamp, so trimming everything older than the
 * window and counting what's left gives an exact sliding count shared across
 * every server instance — unlike the in-memory map, this survives Render
 * spinning up multiple instances or restarting the process.
 */
async function isRateLimitedRedis(client: Redis, key: string): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const redisKey = `ratelimit:${key}`;

  await client.zremrangebyscore(redisKey, 0, windowStart);
  const count = await client.zcard(redisKey);
  if (count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  await client.zadd(redisKey, { score: now, member: `${now}:${Math.random()}` });
  await client.pexpire(redisKey, WINDOW_MS);
  return false;
}

export async function isRateLimited(key: string): Promise<boolean> {
  const client = getRedis();
  if (!client) return isRateLimitedInMemory(key);

  try {
    return await isRateLimitedRedis(client, key);
  } catch (err) {
    // Redis being unreachable shouldn't take the whole chat endpoint down —
    // degrade to the in-memory limiter for this request instead.
    console.error("Redis rate limit check failed, falling back to in-memory:", err);
    return isRateLimitedInMemory(key);
  }
}
