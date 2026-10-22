import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, enforceRateLimit, RATE_LIMITS, resetRateLimits } from "@/lib/privacy/rateLimit";

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then refuses with a retry hint", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.auth; i += 1) {
      expect(checkRateLimit("auth", "1.2.3.4", now).allowed).toBe(true);
    }
    const refused = checkRateLimit("auth", "1.2.3.4", now);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
  it("refills over time and keeps keys independent", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.auth; i += 1) checkRateLimit("auth", "a", now);
    expect(checkRateLimit("auth", "a", now).allowed).toBe(false);
    expect(checkRateLimit("auth", "b", now).allowed).toBe(true);
    expect(checkRateLimit("auth", "a", now + 60_000).allowed).toBe(true);
  });
  it("produces a 429 response with Retry-After", async () => {
    for (let i = 0; i < RATE_LIMITS.memories; i += 1) checkRateLimit("memories", "u1");
    const response = enforceRateLimit("memories", "u1");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = await response!.json();
    expect(body.error.code).toBe("rate_limited");
  });
  it("reads the first forwarded ip", () => {
    const request = new Request("http://localhost/x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientIp(request)).toBe("9.9.9.9");
    expect(clientIp(new Request("http://localhost/x"))).toBe("unknown");
  });
});
