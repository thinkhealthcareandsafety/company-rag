const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

const hits = new Map<string, number[]>();

/**
 * In-memory sliding-window limiter, keyed per user. Sufficient for a single
 * Next.js instance; a multi-instance deployment needs a shared store (e.g.
 * Redis/Upstash) instead — noted as a scaling follow-up in the README.
 */
export function isRateLimited(key: string): boolean {
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
