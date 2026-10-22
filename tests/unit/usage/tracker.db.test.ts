/**
 * Integration test against the real test database (.env.test). Creates its own
 * user and removes it (cascade) afterwards.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PRICING_VERSION } from "@/lib/ai/models";
import { closePool, query, queryOne } from "@/lib/database/client";
import { checkCaps, getTodaySpend, getUsageSummary, recordUsage, USAGE_NOTE } from "@/lib/usage/tracker";

let userId: string;
let conversationId: string;

describe("usage tracker (db)", () => {
  beforeAll(async () => {
    const user = await queryOne<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`usage-${Date.now()}@test.local`]);
    userId = user!.id;
    const conv = await queryOne<{ id: string }>(
      `INSERT INTO conversations (user_id, mode, model_key, model_id, connected_seconds, user_speech_seconds, assistant_speech_seconds)
       VALUES ($1, 'live', 'full', 'gpt-realtime-2.1', 125.5, 40, 61) RETURNING id`,
      [userId],
    );
    conversationId = conv!.id;
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    if (userId) await query(`DELETE FROM users WHERE id = $1`, [userId]);
    await closePool();
  });

  it("recordUsage stores the estimated cost and pricing version", async () => {
    const { estimatedCostUsd } = await recordUsage({
      userId,
      conversationId,
      modelId: "gpt-realtime-2.1",
      kind: "realtime_response",
      inputAudioTokens: 600,
      outputAudioTokens: 1200,
      inputTextTokens: 1000,
      cachedTextTokens: 1000,
      metadata: { responseId: "resp_1" },
    });
    expect(estimatedCostUsd).toBeCloseTo(0.096 + 0.0004, 6);

    const row = await queryOne<{ estimated_cost_usd: string; pricing_version: string; kind: string; cached_text_tokens: number; metadata: Record<string, unknown> }>(
      `SELECT estimated_cost_usd, pricing_version, kind, cached_text_tokens, metadata FROM usage_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    expect(Number(row!.estimated_cost_usd)).toBeCloseTo(0.0964, 6);
    expect(row!.pricing_version).toBe(PRICING_VERSION);
    expect(row!.kind).toBe("realtime_response");
    expect(row!.cached_text_tokens).toBe(1000);
    expect(row!.metadata).toEqual({ responseId: "resp_1" });
  });

  it("records a web search with calls and a zero-cost session event", async () => {
    const search = await recordUsage({ userId, conversationId, modelId: "gpt-6-luna", kind: "web_search", searchCalls: 2, inputTextTokens: 2000, outputTextTokens: 100 });
    expect(search.estimatedCostUsd).toBeCloseTo(0.02 + (2000 * 0.1 + 100 * 0.5) / 1e6, 9);
    const session = await recordUsage({ userId, conversationId, modelId: "gpt-realtime-2.1", kind: "session" });
    expect(session.estimatedCostUsd).toBe(0);
  });

  it("checkCaps enforces the per-user cap, the global cap, and allows otherwise", async () => {
    const spend = await getTodaySpend(userId);
    expect(spend.userTodaySpendUsd).toBeGreaterThan(0.1);
    expect(spend.todaySpendUsd).toBeGreaterThanOrEqual(spend.userTodaySpendUsd);

    vi.stubEnv("COMPANION_DAILY_COST_CAP_USD", "1000000");
    vi.stubEnv("COMPANION_PER_USER_DAILY_COST_CAP_USD", "0.05");
    const user = await checkCaps(userId);
    expect(user).toMatchObject({ allowed: false, reason: "user_daily_cap" });
    expect((user as { detail: string }).detail).toContain("per-person daily cap");

    vi.stubEnv("COMPANION_DAILY_COST_CAP_USD", "0.000001");
    vi.stubEnv("COMPANION_PER_USER_DAILY_COST_CAP_USD", "1000000");
    const global = await checkCaps(userId);
    expect(global).toMatchObject({ allowed: false, reason: "daily_cap" });

    vi.stubEnv("COMPANION_DAILY_COST_CAP_USD", "1000000");
    vi.stubEnv("COMPANION_PER_USER_DAILY_COST_CAP_USD", "1000000");
    expect(await checkCaps(userId)).toEqual({ allowed: true });

    // Exactly at the cap counts as reached (>=).
    vi.stubEnv("COMPANION_PER_USER_DAILY_COST_CAP_USD", String(spend.userTodaySpendUsd));
    expect(await checkCaps(userId)).toMatchObject({ allowed: false, reason: "user_daily_cap" });
  });

  it("getUsageSummary aggregates tokens, cost, sessions and seconds", async () => {
    vi.stubEnv("COMPANION_DAILY_COST_CAP_USD", "5");
    vi.stubEnv("COMPANION_PER_USER_DAILY_COST_CAP_USD", "2");
    vi.stubEnv("COMPANION_MAX_SESSION_MINUTES", "30");

    for (const range of ["today", "7d", "all"] as const) {
      const summary = await getUsageSummary(userId, range);
      expect(summary.range).toBe(range);
      expect(summary.totals.sessions).toBe(1);
      expect(summary.totals.connectedSeconds).toBe(125.5);
      expect(summary.totals.userSpeechSeconds).toBe(40);
      expect(summary.totals.assistantSpeechSeconds).toBe(61);
      expect(summary.totals.inputAudioTokens).toBe(600);
      expect(summary.totals.outputAudioTokens).toBe(1200);
      expect(summary.totals.inputTextTokens).toBe(3000);
      expect(summary.totals.cachedTextTokens).toBe(1000);
      expect(summary.totals.searchCalls).toBe(2);
      expect(summary.totals.estimatedCostUsd).toBeCloseTo(0.0964 + 0.02 + 0.00025, 6);

      const realtime = summary.byModel.find((m) => m.modelId === "gpt-realtime-2.1")!;
      expect(realtime.totals.sessions).toBe(1);
      expect(realtime.totals.outputAudioTokens).toBe(1200);
      const text = summary.byModel.find((m) => m.modelId === "gpt-6-luna")!;
      expect(text.totals.searchCalls).toBe(2);
      expect(text.totals.sessions).toBe(0);

      expect(summary.byDay).toHaveLength(1);
      expect(summary.byDay[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(summary.byDay[0].sessions).toBe(1);
      expect(summary.byDay[0].estimatedCostUsd).toBeCloseTo(summary.totals.estimatedCostUsd, 6);

      expect(summary.caps).toMatchObject({ dailyCostCapUsd: 5, perUserDailyCostCapUsd: 2, maxSessionMinutes: 30 });
      expect(summary.caps.userTodaySpendUsd).toBeCloseTo(summary.totals.estimatedCostUsd, 6);
      expect(summary.pricingVersion).toBe(PRICING_VERSION);
      expect(summary.note).toBe(USAGE_NOTE);
      expect(summary.note).toContain("Connected minutes are not billable minutes");
    }
  });

  it("isolates users: a different user sees nothing", async () => {
    const other = await queryOne<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`usage-other-${Date.now()}@test.local`]);
    try {
      const summary = await getUsageSummary(other!.id, "all");
      expect(summary.totals.sessions).toBe(0);
      expect(summary.totals.estimatedCostUsd).toBe(0);
      expect(summary.byModel).toEqual([]);
      expect(summary.caps.userTodaySpendUsd).toBe(0);
      expect(summary.caps.todaySpendUsd).toBeGreaterThan(0); // global spend still visible
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [other!.id]);
    }
  });
});
