import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";

describe("session tokens", () => {
  it("round-trips sub and token version", async () => {
    const token = await signSessionToken({ sub: "user-1", v: 3 });
    expect(await verifySessionToken(token)).toEqual({ sub: "user-1", v: 3 });
  });
  it("rejects tampered or expired tokens", async () => {
    const token = await signSessionToken({ sub: "user-1", v: 1 });
    expect(await verifySessionToken(token.slice(0, -2) + "xx")).toBeNull();
    const expired = await signSessionToken({ sub: "user-1", v: 1 }, -10);
    expect(await verifySessionToken(expired)).toBeNull();
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });
  it("rejects tokens signed with another secret", async () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-that-is-long-enough-123";
    const token = await signSessionToken({ sub: "user-1", v: 1 });
    process.env.AUTH_SECRET = original;
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("passwords", () => {
  it("hashes with bcrypt and verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
