/**
 * POST /api/realtime/session — unit test with every collaborator mocked. Checks
 * the live-path contract the browser depends on (API_VERIFICATION.md §2, §3):
 * what the browser receives, what is sent to OpenAI, and the guards in front.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig, Preferences, Profile, User } from "@/lib/types";
import { DEFAULT_PREFERENCES } from "@/lib/types";

vi.mock("@/lib/auth/session", () => ({ requireApiUser: vi.fn() }));
vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return { ...actual, isLiveConfigured: vi.fn(() => true) };
});
vi.mock("@/lib/ai/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openai")>();
  return { ...actual, createRealtimeClientSecret: vi.fn() };
});
vi.mock("@/lib/ai/modelConfigs", () => ({ resolveModelConfig: vi.fn() }));
vi.mock("@/lib/database/conversations", () => ({ createConversation: vi.fn(), getConversation: vi.fn() }));
vi.mock("@/lib/memory/service", () => ({
  buildMemoryContext: vi.fn(),
  getPreferences: vi.fn(),
  getProfile: vi.fn(),
  hasConsent: vi.fn(),
}));
vi.mock("@/lib/usage/tracker", () => ({ checkCaps: vi.fn(), recordUsage: vi.fn(async () => ({ estimatedCostUsd: 0 })) }));
vi.mock("@/lib/memory/personalityService", () => ({ buildStyleBlock: vi.fn(async () => "") }));

import { POST } from "@/app/api/realtime/session/route";
import { isLiveConfigured } from "@/lib/ai/models";
import { resolveModelConfig } from "@/lib/ai/modelConfigs";
import { createRealtimeClientSecret } from "@/lib/ai/openai";
import type { RealtimeSessionConfig } from "@/lib/ai/realtime/events";
import { requireApiUser } from "@/lib/auth/session";
import { createConversation, getConversation } from "@/lib/database/conversations";
import { buildMemoryContext, getPreferences, getProfile, hasConsent } from "@/lib/memory/service";
import { checkRateLimit, resetRateLimits } from "@/lib/privacy/rateLimit";
import { checkCaps } from "@/lib/usage/tracker";

const user: User = { id: "11111111-1111-4111-8111-111111111111", email: "u@example.com", isDemo: false, demoSlug: null, createdAt: "2026-01-01T00:00:00Z" };
const profile: Profile = { userId: user.id, preferredName: "Margaret", companionVoice: "ethel", onboardingStage: "complete", timezone: "America/New_York", createdAt: "x", updatedAt: "x" };
const preferences: Preferences = { ...DEFAULT_PREFERENCES, userId: user.id, updatedAt: "x", memoryEnabled: true, pauseSensitivity: "patient", searchEnabled: true };
const modelConfig: ModelConfig = {
  key: "full",
  provider: "openai",
  modelId: "gpt-realtime-2.1",
  label: "Full quality",
  tier: "full",
  enabled: true,
  pricing: { textInput: 4, textCachedInput: 0.4, textOutput: 24, audioInput: 32, audioCachedInput: 0.4, audioOutput: 64 },
  pricingVersion: "2026-10-22",
};
const MEMORY_BLOCK = "Facts the user asked you to remember (confirmed):\n- Granddaughter Lily plays the violin";

function post(body: unknown = { modelKey: "full" }): Promise<Response> {
  return POST(new Request("http://localhost/api/realtime/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

describe("POST /api/realtime/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    vi.mocked(requireApiUser).mockResolvedValue(user);
    vi.mocked(isLiveConfigured).mockReturnValue(true);
    vi.mocked(checkCaps).mockResolvedValue({ allowed: true });
    vi.mocked(resolveModelConfig).mockResolvedValue(modelConfig);
    vi.mocked(getPreferences).mockResolvedValue(preferences);
    vi.mocked(getProfile).mockResolvedValue(profile);
    vi.mocked(hasConsent).mockResolvedValue(true);
    vi.mocked(buildMemoryContext).mockResolvedValue({ block: MEMORY_BLOCK, memoryIds: ["m1"], summaryIds: [], estimatedTokens: 20 });
    vi.mocked(createRealtimeClientSecret).mockResolvedValue({ value: "ek_test_secret", expiresAt: "2026-10-22T12:10:00.000Z" });
    vi.mocked(createConversation).mockImplementation(async (input) => ({
      id: "22222222-2222-4222-8222-222222222222",
      userId: input.userId,
      mode: input.mode,
      modelKey: input.modelKey,
      modelId: input.modelId,
      status: "active",
      startedAt: "2026-10-22T12:00:00.000Z",
      endedAt: null,
      connectedSeconds: 0,
      userSpeechSeconds: 0,
      assistantSpeechSeconds: 0,
      continuedFromId: input.continuedFromId ?? null,
      summaryMemoryId: null,
      metadata: input.metadata ?? {},
    }));
  });

  it("returns only what the browser needs: secret, expiry, model/voice labels, calls URL, counts — never key, instructions or memory text", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(["callsUrl", "clientSecret", "context", "conversationId", "expiresAt", "maxSessionSeconds", "mode", "model", "voice"]);
    expect(body).toMatchObject({
      mode: "live",
      conversationId: "22222222-2222-4222-8222-222222222222",
      clientSecret: "ek_test_secret",
      expiresAt: "2026-10-22T12:10:00.000Z",
      model: { key: "full", id: "gpt-realtime-2.1" },
      voice: { label: "Ethel", id: "marin" },
      callsUrl: "https://api.openai.com/v1/realtime/calls",
      context: { estimatedTokens: 20, memoryCount: 1, summaryCount: 0 },
    });
    expect(body.callsUrl).not.toContain("model=");
    expect(text).not.toMatch(/Lily|violin|instructions|sk-|MEMORY/);
  });

  it("mints the secret with the documented GA session: type realtime, model, instructions incl. memory block, semantic_vad from pause sensitivity, tools, transcription, voice", async () => {
    await post();
    expect(createRealtimeClientSecret).toHaveBeenCalledTimes(1);
    const [session, ttl, options] = vi.mocked(createRealtimeClientSecret).mock.calls[0] as [RealtimeSessionConfig, number, { safetyIdentifier?: string }];
    expect(ttl).toBe(600);
    expect(session.type).toBe("realtime");
    expect(session.model).toBe("gpt-realtime-2.1");
    expect(session.output_modalities).toEqual(["audio"]);
    expect(session.instructions).toContain(MEMORY_BLOCK);
    expect(session.instructions).toContain("Mode: live.");
    expect(session.audio?.output?.voice).toBe("marin");
    expect(session.audio?.input?.turn_detection).toEqual({ type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true });
    expect(session.audio?.input?.transcription).toEqual({ model: "gpt-realtime-whisper" });
    expect(session.tools?.map((t) => t.name)).toContain("search_web");
    expect(session.tools?.every((t) => t.type === "function" && typeof t.parameters === "object")).toBe(true);
    // beta-era fields must be absent
    expect(session).not.toHaveProperty("modalities");
    expect(session).not.toHaveProperty("voice");
    // the safety identifier is an opaque hash, never the user id or email
    expect(options.safetyIdentifier).toMatch(/^[0-9a-f]{32}$/);
    expect(options.safetyIdentifier).not.toContain(user.id);
    expect(createConversation).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id, mode: "live", modelKey: "full", modelId: "gpt-realtime-2.1" }));
  });

  it("omits search_web when the user has not consented to web search", async () => {
    vi.mocked(hasConsent).mockResolvedValue(false);
    await post();
    const session = vi.mocked(createRealtimeClientSecret).mock.calls[0][0] as RealtimeSessionConfig;
    expect(session.tools?.map((t) => t.name)).not.toContain("search_web");
    expect(session.instructions).toContain("search_web is unavailable");
  });

  it("refuses demo users (403 demo_user) before touching OpenAI", async () => {
    vi.mocked(requireApiUser).mockResolvedValue({ ...user, isDemo: true, demoSlug: "margaret", email: null });
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("demo_user");
    expect(createRealtimeClientSecret).not.toHaveBeenCalled();
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("refuses when live is not configured (403 live_unavailable) and when the cap is reached (403 cap_reached)", async () => {
    vi.mocked(isLiveConfigured).mockReturnValue(false);
    expect((await (await post()).json()).error.code).toBe("live_unavailable");
    vi.mocked(isLiveConfigured).mockReturnValue(true);
    vi.mocked(checkCaps).mockResolvedValue({ allowed: false, reason: "user_daily_cap", detail: "cap" });
    const capped = await post();
    expect(capped.status).toBe(403);
    expect((await capped.json()).error).toMatchObject({ code: "cap_reached", details: { reason: "user_daily_cap" } });
    expect(createRealtimeClientSecret).not.toHaveBeenCalled();
  });

  it("validates the body and the continued conversation's ownership", async () => {
    expect((await post({ modelKey: "ultra" })).status).toBe(400);
    vi.mocked(getConversation).mockResolvedValue(null);
    const response = await post({ modelKey: "mini", continueConversationId: "33333333-3333-4333-8333-333333333333" });
    expect(response.status).toBe(404);
    expect(getConversation).toHaveBeenCalledWith(user.id, "33333333-3333-4333-8333-333333333333");
    expect(createRealtimeClientSecret).not.toHaveBeenCalled();
  });

  it("is rate limited per user like every other authenticated mutating route", async () => {
    for (let i = 0; i < 120; i += 1) checkRateLimit("default", user.id);
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(createRealtimeClientSecret).not.toHaveBeenCalled();
  });
});
