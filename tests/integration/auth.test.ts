import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("next/headers", async () => ({ cookies: async () => (await import("./helpers")).cookieJar }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as demoList, POST as demoLogin } from "@/app/api/auth/demo/route";
import { GET as me } from "@/app/api/me/route";
import { createSession, getCurrentUser, requireApiUser, requirePageUser, SESSION_COOKIE } from "@/lib/auth/session";
import { revokeAllSessions } from "@/lib/auth/service";
import { RATE_LIMITS } from "@/lib/privacy/rateLimit";
import type { AuthResponse, MeResponse } from "@/lib/api/contracts";
import { cookieJar, createUser, ensureSchema, jsonRequest, readJson, teardown, truncateAll } from "./helpers";

beforeAll(ensureSchema);
beforeEach(async () => {
  await truncateAll();
  cookieJar.reset();
});
afterAll(teardown);

describe("signup / login / session", () => {
  it("signs up, sets a cookie, and /api/me works", async () => {
    const response = await signup(jsonRequest("/api/auth/signup", "POST", { email: "Ann@Example.com", password: "a-long-password", preferredName: "Ann" }));
    expect(response.status).toBe(201);
    const body = await readJson<AuthResponse>(response);
    expect(body.user.email).toBe("ann@example.com");
    expect(body.user.isDemo).toBe(false);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(true);

    const meResponse = await me();
    expect(meResponse.status).toBe(200);
    const meBody = await readJson<MeResponse>(meResponse);
    expect(meBody.user.id).toBe(body.user.id);
    expect(meBody.profile.preferredName).toBe("Ann");
    expect(meBody.profile.onboardingStage).toBe("named");
    expect(meBody.preferences.memoryEnabled).toBe(false);
    expect(meBody.consents).toEqual({ memory: false, sensitive_memory: false, web_search: false, transcripts: false });
    expect(meBody.mode).toBe("demo"); // no OPENAI_API_KEY in tests
    expect(meBody.capabilities.liveConfigured).toBe(false);
  });

  it("rejects duplicate emails with 409 and weak bodies with 400", async () => {
    await signup(jsonRequest("/api/auth/signup", "POST", { email: "dup@example.com", password: "a-long-password" }));
    const dup = await signup(jsonRequest("/api/auth/signup", "POST", { email: "DUP@example.com", password: "another-long-password" }));
    expect(dup.status).toBe(409);
    const weak = await signup(jsonRequest("/api/auth/signup", "POST", { email: "x@example.com", password: "short" }));
    expect(weak.status).toBe(400);
  });

  it("logs in with the right password and gives a generic 401 otherwise", async () => {
    const { user, password } = await createUser({ email: "bob@example.com" });
    cookieJar.reset();
    const bad = await login(jsonRequest("/api/auth/login", "POST", { email: "bob@example.com", password: "wrong-password-here" }));
    expect(bad.status).toBe(401);
    const unknown = await login(jsonRequest("/api/auth/login", "POST", { email: "nobody@example.com", password: "wrong-password-here" }));
    expect(unknown.status).toBe(401);
    expect((await readJson<{ error: { message: string } }>(unknown)).error.message).toBe(
      (await readJson<{ error: { message: string } }>(bad.clone())).error.message,
    );
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);

    const good = await login(jsonRequest("/api/auth/login", "POST", { email: "bob@example.com", password }));
    expect(good.status).toBe(200);
    expect((await getCurrentUser())?.id).toBe(user.id);
  });

  it("logout clears the cookie and requireApiUser then throws 401", async () => {
    await createUser();
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    const { user, tokenVersion } = await createUser();
    await createSession(user, tokenVersion);
    expect(await requireApiUser()).toMatchObject({ id: user.id });
    await logout();
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    await expect(requireApiUser()).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    await expect(requirePageUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect((await me()).status).toBe(401);
  });

  it("bumping token_version signs the user out everywhere", async () => {
    const { user, tokenVersion } = await createUser();
    await createSession(user, tokenVersion);
    expect((await getCurrentUser())?.id).toBe(user.id);
    await revokeAllSessions(user.id);
    expect(await getCurrentUser()).toBeNull();
    await createSession(user); // reads the new version
    expect((await getCurrentUser())?.id).toBe(user.id);
  });

  it("rate-limits auth attempts per ip", async () => {
    let last: Response | null = null;
    for (let i = 0; i <= RATE_LIMITS.auth; i += 1) {
      last = await login(jsonRequest("/api/auth/login", "POST", { email: "x@example.com", password: "whatever-long" }, { "x-forwarded-for": "5.5.5.5" }));
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("demo profiles", () => {
  it("lists the fictional profiles and signs one in without a password", async () => {
    const list = await demoList();
    expect(list.status).toBe(200);
    const body = await readJson<{ profiles: Array<{ slug: string; displayName: string; blurb: string; companionVoice: string }> }>(list);
    expect(body.profiles.map((p) => p.slug).sort()).toEqual(["margaret", "walter"]);
    expect(body.profiles.find((p) => p.slug === "margaret")?.companionVoice).toBe("ethel");
    expect(body.profiles.find((p) => p.slug === "walter")?.companionVoice).toBe("fred");

    const response = await demoLogin(jsonRequest("/api/auth/demo", "POST", { slug: "margaret" }));
    expect(response.status).toBe(200);
    const auth = await readJson<AuthResponse>(response);
    expect(auth.user.isDemo).toBe(true);
    expect(auth.user.demoSlug).toBe("margaret");
    expect(auth.user.email).toBeNull();

    const meBody = await readJson<MeResponse>(await me());
    expect(meBody.mode).toBe("demo");
    expect(meBody.profile.preferredName).toBe("Margaret");
    expect(meBody.profile.companionVoice).toBe("ethel");
    expect(meBody.preferences.memoryEnabled).toBe(true);
    expect(meBody.consents.memory).toBe(true);

    // Signing in again reuses the same user.
    const again = await readJson<AuthResponse>(await demoLogin(jsonRequest("/api/auth/demo", "POST", { slug: "margaret" })));
    expect(again.user.id).toBe(auth.user.id);
  });

  it("refuses unknown slugs and is 403 when disabled", async () => {
    expect((await demoLogin(jsonRequest("/api/auth/demo", "POST", { slug: "nobody" }))).status).toBe(404);
    const previous = process.env.COMPANION_ENABLE_DEMO_PROFILES;
    process.env.COMPANION_ENABLE_DEMO_PROFILES = "false";
    try {
      expect((await demoList()).status).toBe(403);
      expect((await demoLogin(jsonRequest("/api/auth/demo", "POST", { slug: "margaret" }))).status).toBe(403);
    } finally {
      process.env.COMPANION_ENABLE_DEMO_PROFILES = previous;
    }
  });
});
