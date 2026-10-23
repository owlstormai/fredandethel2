/**
 * Local cost ESTIMATE for a Realtime session from token usage. Used by the
 * developer comparison view only; the server (src/lib/usage) is the record of
 * truth. Prices are USD per 1M tokens (src/lib/ai/models.ts), labeled estimates.
 *
 * OpenAI reports cached tokens as a subset of input tokens, so cached text /
 * audio tokens are billed at the cached rate and subtracted from the full rate.
 */
import type { ModelPricing, TokenUsage } from "@/lib/types";

export function estimateRealtimeCostUsd(usage: TokenUsage, pricing: ModelPricing): number {
  const perToken = (tokens: number, pricePerMillion: number) => (Math.max(0, tokens) * pricePerMillion) / 1_000_000;
  const uncachedText = Math.max(0, usage.inputTextTokens - usage.cachedTextTokens);
  const uncachedAudio = Math.max(0, usage.inputAudioTokens - usage.cachedAudioTokens);
  return (
    perToken(uncachedText, pricing.textInput) +
    perToken(usage.cachedTextTokens, pricing.textCachedInput) +
    perToken(uncachedAudio, pricing.audioInput) +
    perToken(usage.cachedAudioTokens, pricing.audioCachedInput) +
    perToken(usage.outputTextTokens, pricing.textOutput) +
    perToken(usage.outputAudioTokens, pricing.audioOutput)
  );
}

export function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
