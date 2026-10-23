/**
 * Cost estimation. Prices come from src/lib/ai/models.ts (USD per 1M tokens,
 * verified 2026-10-22). Everything here is an ESTIMATE and labeled as such in
 * the developer panel; no real billing happens in the MVP.
 *
 * Formulas
 *   realtime  = (textIn − textCached)·textInput + textCached·textCachedInput + textOut·textOutput
 *             + (audioIn − audioCached)·audioInput + audioCached·audioCachedInput + audioOut·audioOutput, all / 1e6
 *   text      = (in − cached)·input + cached·cachedInput + out·output, / 1e6
 *   search    = calls · WEB_SEARCH_PRICE_PER_CALL + text(model, tokens)
 *   transcribe= seconds / 60 · pricePerMinute
 * Cached tokens are a SUBSET of input tokens (see the documented usage example),
 * so they are priced at the cached rate and subtracted from the full-rate input.
 */
import {
  AUDIO_TOKENS_PER_SECOND,
  DEFAULT_TEXT_MODEL,
  PRICING_VERSION,
  REALTIME_PRICING,
  TEXT_MODEL_PRICING,
  TRANSCRIPTION_PRICE_PER_MINUTE,
  WEB_SEARCH_PRICE_PER_CALL,
  pricingForModelId,
} from "@/lib/ai/models";
import type { ModelPricing, TokenUsage, UsageKind } from "@/lib/types";

const PER_MILLION = 1_000_000;

function nonNegative(n: number | undefined | null): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Realtime (audio+text) cost. Cached tokens priced once, at the cached rate. */
export function estimateRealtimeCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inText = nonNegative(usage.inputTextTokens);
  const inAudio = nonNegative(usage.inputAudioTokens);
  const cachedText = Math.min(inText, nonNegative(usage.cachedTextTokens));
  const cachedAudio = Math.min(inAudio, nonNegative(usage.cachedAudioTokens));
  const outText = nonNegative(usage.outputTextTokens);
  const outAudio = nonNegative(usage.outputAudioTokens);

  const cost =
    (inText - cachedText) * pricing.textInput +
    cachedText * pricing.textCachedInput +
    outText * pricing.textOutput +
    (inAudio - cachedAudio) * pricing.audioInput +
    cachedAudio * pricing.audioCachedInput +
    outAudio * pricing.audioOutput;
  return cost / PER_MILLION;
}

export function textPricingFor(modelId: string): { input: number; cachedInput: number; output: number; known: boolean } {
  const exact = TEXT_MODEL_PRICING[modelId];
  if (exact) return { ...exact, known: true };
  return { ...TEXT_MODEL_PRICING[DEFAULT_TEXT_MODEL], known: false };
}

/** Responses/Chat text model cost. Unknown model ids fall back to the default text model's prices. */
export function estimateTextCost(modelId: string, inputTokens: number, cachedTokens: number, outputTokens: number): number {
  const p = textPricingFor(modelId);
  const input = nonNegative(inputTokens);
  const cached = Math.min(input, nonNegative(cachedTokens));
  const output = nonNegative(outputTokens);
  return ((input - cached) * p.input + cached * p.cachedInput + output * p.output) / PER_MILLION;
}

/** Per-minute transcription models. Unknown model -> 0 (unpriced, flagged by `known`). */
export function estimateTranscriptionCost(modelId: string, seconds: number): number {
  const perMinute = TRANSCRIPTION_PRICE_PER_MINUTE[modelId];
  if (perMinute === undefined) return 0;
  return (nonNegative(seconds) / 60) * perMinute;
}

export function estimateWebSearchCost(
  modelId: string,
  searchCalls: number,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number,
): number {
  return nonNegative(searchCalls) * WEB_SEARCH_PRICE_PER_CALL + estimateTextCost(modelId, inputTokens, cachedTokens, outputTokens);
}

/** Documented rates: 1 token / 100ms of user audio, 1 token / 50ms of assistant audio. */
export function audioSecondsToTokens(seconds: number, direction: "input" | "output"): number {
  return Math.round(nonNegative(seconds) * AUDIO_TOKENS_PER_SECOND[direction]);
}

export interface CostInput extends Partial<TokenUsage> {
  modelId: string;
  kind: UsageKind;
  searchCalls?: number;
  durationSeconds?: number;
}

/** Single entry point used by the tracker: cost by usage kind. */
export function estimateCost(input: CostInput): number {
  const usage: TokenUsage = {
    inputTextTokens: nonNegative(input.inputTextTokens),
    inputAudioTokens: nonNegative(input.inputAudioTokens),
    cachedTextTokens: nonNegative(input.cachedTextTokens),
    cachedAudioTokens: nonNegative(input.cachedAudioTokens),
    outputTextTokens: nonNegative(input.outputTextTokens),
    outputAudioTokens: nonNegative(input.outputAudioTokens),
  };
  switch (input.kind) {
    case "realtime_response": {
      const pricing = pricingForModelId(input.modelId) ?? REALTIME_PRICING.full;
      return roundUsd(estimateRealtimeCost(usage, pricing));
    }
    case "web_search":
      return roundUsd(
        estimateWebSearchCost(input.modelId, input.searchCalls ?? 0, usage.inputTextTokens, usage.cachedTextTokens, usage.outputTextTokens),
      );
    case "summary":
      return roundUsd(estimateTextCost(input.modelId, usage.inputTextTokens, usage.cachedTextTokens, usage.outputTextTokens));
    case "transcription":
      return roundUsd(estimateTranscriptionCost(input.modelId, input.durationSeconds ?? 0));
    case "session":
      return 0;
  }
}

export { PRICING_VERSION };
