import { describe, expect, it } from "vitest";
import { REALTIME_PRICING, WEB_SEARCH_PRICE_PER_CALL } from "@/lib/ai/models";
import { ZERO_USAGE } from "@/lib/types";
import {
  audioSecondsToTokens,
  estimateCost,
  estimateRealtimeCost,
  estimateTextCost,
  estimateTranscriptionCost,
  estimateWebSearchCost,
} from "@/lib/usage/pricing";

describe("pricing", () => {
  it("known example: 600 input audio + 1200 output audio tokens on full ≈ $0.0960", () => {
    const cost = estimateRealtimeCost({ ...ZERO_USAGE, inputAudioTokens: 600, outputAudioTokens: 1200 }, REALTIME_PRICING.full);
    expect(cost).toBeCloseTo(0.096, 6);
  });

  it("does not double-count cached tokens", () => {
    // 1000 text input tokens, all cached: priced only at the cached rate ($0.40/1M), not also at $4/1M.
    const allCached = estimateRealtimeCost({ ...ZERO_USAGE, inputTextTokens: 1000, cachedTextTokens: 1000 }, REALTIME_PRICING.full);
    expect(allCached).toBeCloseTo(1000 * 0.4 / 1e6, 9);
    // Half cached: 500 at full + 500 at cached.
    const half = estimateRealtimeCost({ ...ZERO_USAGE, inputTextTokens: 1000, cachedTextTokens: 500 }, REALTIME_PRICING.full);
    expect(half).toBeCloseTo((500 * 4 + 500 * 0.4) / 1e6, 9);
    // Cached audio likewise.
    const audio = estimateRealtimeCost({ ...ZERO_USAGE, inputAudioTokens: 2000, cachedAudioTokens: 1500 }, REALTIME_PRICING.full);
    expect(audio).toBeCloseTo((500 * 32 + 1500 * 0.4) / 1e6, 9);
    // Cached can never exceed input (defensive clamp).
    const clamped = estimateRealtimeCost({ ...ZERO_USAGE, inputTextTokens: 100, cachedTextTokens: 999 }, REALTIME_PRICING.full);
    expect(clamped).toBeCloseTo(100 * 0.4 / 1e6, 9);
  });

  it("prices mini at mini rates and output text at $24/1M on 2.x full", () => {
    expect(estimateRealtimeCost({ ...ZERO_USAGE, outputTextTokens: 1_000_000 }, REALTIME_PRICING.full)).toBeCloseTo(24, 6);
    expect(estimateRealtimeCost({ ...ZERO_USAGE, outputAudioTokens: 1_000_000 }, REALTIME_PRICING.mini)).toBeCloseTo(20, 6);
  });

  it("text, search and transcription formulas", () => {
    expect(estimateTextCost("gpt-6-luna", 1_000_000, 0, 0)).toBeCloseTo(0.1, 9);
    expect(estimateTextCost("gpt-6-luna", 1_000_000, 1_000_000, 0)).toBeCloseTo(0.01, 9);
    expect(estimateTextCost("gpt-6-luna", 0, 0, 1_000_000)).toBeCloseTo(0.5, 9);
    expect(estimateTextCost("unknown-model", 1_000_000, 0, 0)).toBeCloseTo(0.1, 9); // falls back to default text model
    expect(estimateWebSearchCost("gpt-6-luna", 2, 10_000, 0, 1_000)).toBeCloseTo(2 * WEB_SEARCH_PRICE_PER_CALL + (10_000 * 0.1 + 1_000 * 0.5) / 1e6, 9);
    expect(WEB_SEARCH_PRICE_PER_CALL).toBe(0.01);
    expect(estimateTranscriptionCost("gpt-realtime-whisper", 120)).toBeCloseTo(0.034, 9);
    expect(estimateTranscriptionCost("made-up", 120)).toBe(0);
  });

  it("converts audio seconds to tokens at the documented rates", () => {
    expect(audioSecondsToTokens(60, "input")).toBe(600);
    expect(audioSecondsToTokens(60, "output")).toBe(1200);
    expect(audioSecondsToTokens(-5, "input")).toBe(0);
  });

  it("estimateCost dispatches by kind and rounds to 6 decimals", () => {
    expect(estimateCost({ kind: "realtime_response", modelId: "gpt-realtime-2.1", inputAudioTokens: 600, outputAudioTokens: 1200 })).toBe(0.096);
    expect(estimateCost({ kind: "realtime_response", modelId: "gpt-realtime-2.1-mini", outputAudioTokens: 1200 })).toBe(0.024);
    expect(estimateCost({ kind: "web_search", modelId: "gpt-6-luna", searchCalls: 1, inputTextTokens: 1000, outputTextTokens: 100 })).toBeCloseTo(0.01 + 0.00015, 9);
    expect(estimateCost({ kind: "summary", modelId: "gpt-6-luna", inputTextTokens: 4000, outputTextTokens: 200 })).toBeCloseTo(0.0005, 9);
    expect(estimateCost({ kind: "transcription", modelId: "gpt-realtime-whisper", durationSeconds: 60 })).toBe(0.017);
    expect(estimateCost({ kind: "session", modelId: "gpt-realtime-2.1" })).toBe(0);
  });
});
