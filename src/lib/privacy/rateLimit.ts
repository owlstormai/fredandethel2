/**
 * In-memory token-bucket rate limiter.
 *
 * PER-INSTANCE ONLY: buckets live in this process. On a multi-instance deploy
 * each instance enforces the limit independently (so the effective limit is
 * N x the configured one). Good enough for the MVP; swap the store for Redis or
 * Postgres if the app is scaled out. Keys are `${group}:${userId|ip}`.
 */
import { jsonError } from "@/lib/api/respond";

export type RateLimitGroup = "auth" | "demoLogin" | "demoTurn" | "memories" | "tools" | "events" | "default";

/** Requests allowed per minute, per key. */
export const RATE_LIMITS: Record<RateLimitGroup, number> = {
  auth: 10,
  demoLogin: 30, // demo profiles have no password to brute-force; shared IPs (kiosks, families) sign in often
  demoTurn: 60,
  memories: 60,
  tools: 60,
  events: 120,
  default: 120,
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 50_000;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(group: RateLimitGroup, key: string, now: number = Date.now()): RateLimitDecision {
  const limit = RATE_LIMITS[group];
  const refillPerMs = limit / WINDOW_MS;
  const id = `${group}:${key}`;
  let bucket = buckets.get(id);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) evictStale(now);
    bucket = { tokens: limit, updatedAt: now };
    buckets.set(id, bucket);
  }
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
  return { allowed: false, retryAfterSeconds };
}

function evictStale(now: number): void {
  for (const [id, bucket] of buckets) {
    if (now - bucket.updatedAt > WINDOW_MS) buckets.delete(id);
  }
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/** Best-effort client IP for unauthenticated routes. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Returns a 429 response (with Retry-After) when over the limit, otherwise null. */
export function enforceRateLimit(group: RateLimitGroup, key: string): Response | null {
  const decision = checkRateLimit(group, key);
  if (decision.allowed) return null;
  const response = jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", {
    retryAfterSeconds: decision.retryAfterSeconds,
  });
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}

/** Tests only. */
export function resetRateLimits(): void {
  buckets.clear();
}
