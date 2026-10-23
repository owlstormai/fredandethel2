/**
 * Static summary of docs/API_VERIFICATION.md for the developer panel. Keep in
 * sync with that document when it is re-verified. No secrets; safe to send to
 * an authenticated browser.
 */
import {
  DEFAULT_REALTIME_FULL_MODEL,
  DEFAULT_REALTIME_MINI_MODEL,
  DEFAULT_SEARCH_MODEL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  EPHEMERAL_KEY_TTL_SECONDS,
  MAX_REALTIME_SESSION_SECONDS,
  PRICING_VERSION,
  REALTIME_PRICING,
  TEXT_MODEL_PRICING,
  TRANSCRIPTION_PRICE_PER_MINUTE,
  WEB_SEARCH_PRICE_PER_CALL,
  getModelId,
  getSearchModelId,
  getTextModelId,
  getTranscriptionModelId,
  isLiveConfigured,
} from "@/lib/ai/models";
import { getVadMode } from "@/lib/ai/realtime/sessionConfig";
import { getCapConfig } from "@/lib/usage/caps";

export const VERIFIED_ON = "2026-10-22";
export const VERIFICATION_SOURCE = "docs/API_VERIFICATION.md";

export interface Deprecation {
  id: string;
  shutdown: string;
  replacement: string;
  note?: string;
}

/** From docs/API_VERIFICATION.md §1 and §8/§9 (deprecations page, fetched 2026-10-22). */
export const KNOWN_DEPRECATIONS: Deprecation[] = [
  { id: "gpt-realtime", shutdown: "2027-01-20", replacement: "gpt-realtime-2.1" },
  { id: "gpt-realtime-2025-08-28", shutdown: "2027-01-20", replacement: "gpt-realtime-2.1" },
  { id: "gpt-realtime-mini", shutdown: "2027-01-20", replacement: "gpt-realtime-2.1-mini" },
  { id: "gpt-realtime-mini-2025-12-15", shutdown: "2027-01-20", replacement: "gpt-realtime-2.1-mini" },
  { id: "gpt-realtime-mini-2025-10-06", shutdown: "2026-07-23", replacement: "gpt-realtime-2.1-mini", note: "already shut down" },
  { id: "gpt-4o-realtime-preview", shutdown: "2026-05-12", replacement: "gpt-realtime-2.1", note: "Realtime beta removed" },
  { id: "whisper-1", shutdown: "2027-02-26", replacement: "gpt-live-transcribe or gpt-transcribe" },
  { id: "gpt-4o-transcribe", shutdown: "2027-02-26", replacement: "gpt-live-transcribe or gpt-transcribe" },
  { id: "gpt-4o-mini-transcribe", shutdown: "2027-02-26", replacement: "gpt-live-transcribe or gpt-transcribe" },
  { id: "gpt-4o-transcribe-diarize", shutdown: "2027-02-26", replacement: "gpt-live-transcribe or gpt-transcribe" },
  { id: "gpt-5-nano", shutdown: "2026-12-11", replacement: "gpt-5.6-luna" },
  { id: "gpt-5-nano-2025-08-07", shutdown: "2026-12-11", replacement: "gpt-5.6-luna" },
  { id: "gpt-5-mini", shutdown: "2026-12-11", replacement: "gpt-5.6-terra" },
  { id: "gpt-5-mini-2025-08-07", shutdown: "2026-12-11", replacement: "gpt-5.6-terra" },
  { id: "gpt-4.1-mini", shutdown: "2027-01-14", replacement: "gpt-6-luna" },
  { id: "gpt-4o-mini", shutdown: "2027-01-14", replacement: "gpt-6-luna" },
  { id: "o4-mini", shutdown: "2026-10-23", replacement: "gpt-5.5" },
];

export interface ModelInUse {
  role: "realtime_full" | "realtime_mini" | "transcription" | "text" | "search";
  id: string;
  defaultId: string;
  envVar: string;
  overridden: boolean;
  deprecation: Deprecation | null;
}

export interface VerificationSummary {
  verifiedOn: string;
  source: string;
  pricingVersion: string;
  liveConfigured: boolean;
  /** Same key as live; the search tool runs server-side through the Responses API. */
  searchConfigured: boolean;
  vadMode: "semantic" | "server";
  modelsInUse: ModelInUse[];
  warnings: string[];
  deprecations: Deprecation[];
  facts: {
    realtimeMaxSessionMinutes: number;
    ephemeralTtlSeconds: number;
    ephemeralTtlRangeSeconds: [number, number];
    clientSecretsEndpoint: string;
    callsEndpoint: string;
    dataChannel: string;
    betaHeaderRemoved: boolean;
    realtimeHasBuiltInWebSearch: boolean;
    webSearchToolType: string;
    webSearchPricePerCallUsd: number;
    audioTokensPerSecond: { input: number; output: number };
    semanticVadMaxTimeoutsSeconds: { low: number; medium: number; high: number };
  };
  pricing: {
    realtime: typeof REALTIME_PRICING;
    text: typeof TEXT_MODEL_PRICING;
    transcriptionPerMinute: typeof TRANSCRIPTION_PRICE_PER_MINUTE;
  };
  caps: ReturnType<typeof getCapConfig>;
  unverified: string[];
}

export function findDeprecation(modelId: string): Deprecation | null {
  return KNOWN_DEPRECATIONS.find((d) => d.id === modelId) ?? null;
}

export function getVerificationSummary(): VerificationSummary {
  const bases: Array<Pick<ModelInUse, "role" | "id" | "defaultId" | "envVar">> = [
    { role: "realtime_full", id: getModelId("full"), defaultId: DEFAULT_REALTIME_FULL_MODEL, envVar: "COMPANION_REALTIME_FULL_MODEL" },
    { role: "realtime_mini", id: getModelId("mini"), defaultId: DEFAULT_REALTIME_MINI_MODEL, envVar: "COMPANION_REALTIME_MINI_MODEL" },
    { role: "transcription", id: getTranscriptionModelId(), defaultId: DEFAULT_TRANSCRIPTION_MODEL, envVar: "COMPANION_TRANSCRIPTION_MODEL" },
    { role: "text", id: getTextModelId(), defaultId: DEFAULT_TEXT_MODEL, envVar: "COMPANION_TEXT_MODEL" },
    { role: "search", id: getSearchModelId(), defaultId: DEFAULT_SEARCH_MODEL, envVar: "COMPANION_SEARCH_MODEL" },
  ];
  const modelsInUse: ModelInUse[] = bases.map((m) => ({ ...m, overridden: m.id !== m.defaultId, deprecation: findDeprecation(m.id) }));

  const warnings = modelsInUse
    .filter((m) => m.deprecation)
    .map((m) => `${m.role}: ${m.id} is deprecated (shutdown ${m.deprecation!.shutdown}); use ${m.deprecation!.replacement}.`);
  if (modelsInUse.some((m) => m.role === "transcription" && m.id === "gpt-transcribe")) {
    warnings.push("transcription: gpt-transcribe over WebRTC speech-to-speech is unconfirmed in the docs (see §Unverified 3).");
  }

  return {
    verifiedOn: VERIFIED_ON,
    source: VERIFICATION_SOURCE,
    pricingVersion: PRICING_VERSION,
    liveConfigured: isLiveConfigured(),
    searchConfigured: isLiveConfigured(),
    vadMode: getVadMode(),
    modelsInUse,
    warnings,
    deprecations: KNOWN_DEPRECATIONS,
    facts: {
      realtimeMaxSessionMinutes: MAX_REALTIME_SESSION_SECONDS / 60,
      ephemeralTtlSeconds: EPHEMERAL_KEY_TTL_SECONDS,
      ephemeralTtlRangeSeconds: [10, 7200],
      clientSecretsEndpoint: "POST /v1/realtime/client_secrets",
      callsEndpoint: "POST /v1/realtime/calls",
      dataChannel: "oai-events",
      betaHeaderRemoved: true,
      realtimeHasBuiltInWebSearch: false,
      webSearchToolType: "web_search",
      webSearchPricePerCallUsd: WEB_SEARCH_PRICE_PER_CALL,
      audioTokensPerSecond: { input: 10, output: 20 },
      semanticVadMaxTimeoutsSeconds: { low: 8, medium: 4, high: 2 },
    },
    pricing: {
      realtime: REALTIME_PRICING,
      text: TEXT_MODEL_PRICING,
      transcriptionPerMinute: TRANSCRIPTION_PRICE_PER_MINUTE,
    },
    caps: getCapConfig(),
    unverified: [
      "?model= query parameter on POST /v1/realtime/calls (model is sent inside the session object instead).",
      "Voice gender labels (Fred=cedar, Ethel=marin is Companion's own assignment).",
      "gpt-transcribe as input transcription over WebRTC speech-to-speech.",
      "max_output_tokens upper bound for 2.x realtime models (4096 vs 32,000).",
      "Default noise_reduction when omitted (Companion sets near_field explicitly).",
      "Web search content-token billing (developer docs: billed at model rates; business pricing: free). Budgeted as billed.",
      "Structured-output (text.format) parameters for the Responses API were not verified; summaries use instructed JSON + defensive parsing.",
    ],
  };
}
