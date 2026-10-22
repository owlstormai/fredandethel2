/**
 * Model registry — the ONLY place model IDs, prices and voice mappings live.
 * All values verified against OpenAI docs on 2026-10-22 (docs/API_VERIFICATION.md).
 * Prices are USD per 1M tokens and are ESTIMATES used for the developer panel.
 */
import type { CompanionVoice, ModelConfig, ModelKey, ModelPricing } from "@/lib/types";

export const PRICING_VERSION = "2026-10-22";

/** Verified 2026-10-22: gpt-realtime / gpt-realtime-mini are deprecated (shutdown 2027-01-20). */
export const DEFAULT_REALTIME_FULL_MODEL = "gpt-realtime-2.1";
export const DEFAULT_REALTIME_MINI_MODEL = "gpt-realtime-2.1-mini";
/** Non-deprecated live transcription model for Realtime input audio. $0.017/min. */
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";
/** Cheapest current text model that supports the Responses `web_search` tool. */
export const DEFAULT_TEXT_MODEL = "gpt-6-luna";
export const DEFAULT_SEARCH_MODEL = "gpt-6-luna";

export const REALTIME_PRICING: Record<"full" | "mini", ModelPricing> = {
  full: { textInput: 4.0, textCachedInput: 0.4, textOutput: 24.0, audioInput: 32.0, audioCachedInput: 0.4, audioOutput: 64.0 },
  mini: { textInput: 0.6, textCachedInput: 0.06, textOutput: 2.4, audioInput: 10.0, audioCachedInput: 0.3, audioOutput: 20.0 },
};

/** Text models: USD per 1M tokens (input, cached input, output). */
export const TEXT_MODEL_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

/** Transcription: USD per minute of audio. */
export const TRANSCRIPTION_PRICE_PER_MINUTE: Record<string, number> = {
  "gpt-realtime-whisper": 0.017,
  "gpt-live-transcribe": 0.017,
  "gpt-transcribe": 0.0045,
};

/** Web search tool: USD per call (search content tokens billed at model rates). */
export const WEB_SEARCH_PRICE_PER_CALL = 10 / 1000;

/** Audio token rates documented by OpenAI: 1 token / 100ms input, 1 token / 50ms output. */
export const AUDIO_TOKENS_PER_SECOND = { input: 10, output: 20 } as const;

export const EPHEMERAL_KEY_TTL_SECONDS = 600;
export const MAX_REALTIME_SESSION_SECONDS = 60 * 60;

/**
 * Fred and Ethel. OpenAI does not label voice gender; "cedar" is commonly
 * perceived as male-leaning and "marin" as female-leaning, and both are the
 * voices OpenAI recommends for gpt-realtime. Override via env if desired.
 */
export const COMPANION_VOICES: Record<CompanionVoice, { label: string; openaiVoice: string; description: string }> = {
  fred: {
    label: "Fred",
    openaiVoice: process.env.COMPANION_VOICE_FRED ?? "cedar",
    description: "Warm, unhurried, a little wry.",
  },
  ethel: {
    label: "Ethel",
    openaiVoice: process.env.COMPANION_VOICE_ETHEL ?? "marin",
    description: "Bright, kind, quick to laugh.",
  },
};

export function getModelId(key: ModelKey): string {
  if (key === "full") return process.env.COMPANION_REALTIME_FULL_MODEL ?? DEFAULT_REALTIME_FULL_MODEL;
  return process.env.COMPANION_REALTIME_MINI_MODEL ?? DEFAULT_REALTIME_MINI_MODEL;
}

export function getTextModelId(): string {
  return process.env.COMPANION_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
}

export function getSearchModelId(): string {
  return process.env.COMPANION_SEARCH_MODEL ?? DEFAULT_SEARCH_MODEL;
}

export function getTranscriptionModelId(): string {
  return process.env.COMPANION_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL;
}

/** Default rows for model_configs (seeded; DB values win at runtime if present). */
export function defaultModelConfigs(): ModelConfig[] {
  return [
    {
      key: "full",
      provider: "openai",
      modelId: getModelId("full"),
      label: "Full quality",
      tier: "full",
      enabled: true,
      pricing: REALTIME_PRICING.full,
      pricingVersion: PRICING_VERSION,
    },
    {
      key: "mini",
      provider: "openai",
      modelId: getModelId("mini"),
      label: "Lower cost (mini)",
      tier: "mini",
      enabled: true,
      pricing: REALTIME_PRICING.mini,
      pricingVersion: PRICING_VERSION,
    },
  ];
}

export function pricingForModelId(modelId: string): ModelPricing | null {
  if (modelId === getModelId("full")) return REALTIME_PRICING.full;
  if (modelId === getModelId("mini")) return REALTIME_PRICING.mini;
  if (/mini/.test(modelId)) return REALTIME_PRICING.mini;
  if (/^gpt-realtime/.test(modelId)) return REALTIME_PRICING.full;
  return null;
}

/** True when live mode can be offered at all. Never exposed to the browser directly. */
export function isLiveConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 20);
}
