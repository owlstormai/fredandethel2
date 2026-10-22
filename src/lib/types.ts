/**
 * Companion — shared domain types.
 *
 * This file is the single source of truth for vocabulary used by both the
 * browser and the server. Keep it free of runtime dependencies so it can be
 * imported anywhere (client components, route handlers, tests).
 */

// ---------------------------------------------------------------------------
// Modes and models
// ---------------------------------------------------------------------------

/** demo = no paid API, simulated conversation. live = real OpenAI Realtime. */
export type AppMode = "demo" | "live";

/** Application-level model slots. Actual model IDs live in model_configs. */
export type ModelKey = "full" | "mini";

export interface ModelConfig {
  key: ModelKey;
  provider: "openai";
  modelId: string;
  label: string;
  tier: "full" | "mini";
  enabled: boolean;
  /** USD per 1M tokens. Estimates; see docs/COST_MODEL.md. */
  pricing: ModelPricing;
  pricingVersion: string;
}

export interface ModelPricing {
  textInput: number;
  textCachedInput: number;
  textOutput: number;
  audioInput: number;
  audioCachedInput: number;
  audioOutput: number;
}

// ---------------------------------------------------------------------------
// Users, profiles, preferences
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string | null;
  isDemo: boolean;
  demoSlug: string | null;
  createdAt: string;
}

export type CompanionVoice = "fred" | "ethel";

export type OnboardingStage =
  | "new" // never talked
  | "named" // we know what to call them
  | "interests" // at least one interest shared
  | "memory_decided" // they opted in or out of memory
  | "complete";

export interface Profile {
  userId: string;
  preferredName: string | null;
  companionVoice: CompanionVoice;
  onboardingStage: OnboardingStage;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export type HumorLevel = "off" | "gentle" | "playful";
export type PauseSensitivity = "patient" | "balanced" | "quick";
export type OrbColor = "cyan" | "violet" | "emerald" | "amber" | "white";
export type TextScale = "normal" | "large" | "xlarge";
export type MotionPreference = "system" | "reduced" | "full";

export interface Preferences {
  userId: string;
  humorLevel: HumorLevel;
  orbColor: OrbColor;
  textScale: TextScale;
  motion: MotionPreference;
  captions: boolean;
  pauseSensitivity: PauseSensitivity;
  modelKey: ModelKey;
  memoryEnabled: boolean;
  sensitiveMemoryEnabled: boolean;
  searchEnabled: boolean;
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: Omit<Preferences, "userId" | "updatedAt"> = {
  humorLevel: "gentle",
  orbColor: "cyan",
  textScale: "large",
  motion: "system",
  captions: true,
  pauseSensitivity: "patient",
  modelKey: "full",
  memoryEnabled: false,
  sensitiveMemoryEnabled: false,
  searchEnabled: false,
};

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export type ConsentScope =
  | "memory" // may store personal facts / stories / preferences
  | "sensitive_memory" // may store health, finances, grief, family conflict
  | "web_search" // may send a query (never memories) to web search
  | "transcripts"; // may keep full transcripts (otherwise only summaries)

export type ConsentSource = "ui" | "voice" | "seed";

export interface ConsentRecord {
  id: string;
  userId: string;
  scope: ConsentScope;
  granted: boolean;
  source: ConsentSource;
  /** For voice consent: the user's own words as transcribed. */
  evidence: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type MemoryKind =
  | "fact"
  | "preference"
  | "interest"
  | "relationship"
  | "story"
  | "summary";

/**
 * Provenance labels. Never silently promote a lower label to a higher one.
 *  confirmed  — user explicitly agreed to save this exact statement
 *  reported   — user said it, but was not asked to confirm saving it
 *  summarized — produced by post-conversation summarization
 *  inferred   — model/heuristic guess; shown as a suggestion, never injected
 */
export type MemoryStatus = "confirmed" | "reported" | "summarized" | "inferred";

export type MemorySensitivity = "normal" | "sensitive";

export type MemoryCategory =
  | "identity"
  | "family"
  | "friends"
  | "interest"
  | "routine"
  | "preference"
  | "story"
  | "health"
  | "finances"
  | "grief"
  | "other";

export interface Memory {
  id: string;
  userId: string;
  kind: MemoryKind;
  category: MemoryCategory;
  content: string;
  status: MemoryStatus;
  sensitivity: MemorySensitivity;
  importance: number; // 1..5
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  lastReferencedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type MemoryEventType =
  | "created"
  | "corrected"
  | "confirmed"
  | "deleted"
  | "recalled"
  | "suppressed" // a summary was redacted because a memory was deleted
  | "rejected"; // save attempted without consent

export interface MemoryEvent {
  id: string;
  userId: string;
  memoryId: string | null;
  event: MemoryEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type ConversationStatus = "active" | "ended" | "failed";

export interface Conversation {
  id: string;
  userId: string;
  mode: AppMode;
  modelKey: ModelKey;
  modelId: string;
  status: ConversationStatus;
  startedAt: string;
  endedAt: string | null;
  connectedSeconds: number;
  userSpeechSeconds: number;
  assistantSpeechSeconds: number;
  /** Conversation id this one continued from (model switch). */
  continuedFromId: string | null;
  summaryMemoryId: string | null;
  metadata: Record<string, unknown>;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface SearchSource {
  title: string;
  url: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  userId: string;
  seq: number;
  role: MessageRole;
  content: string;
  /** Provider item id (Realtime item_id) when known. */
  itemId: string | null;
  toolName: string | null;
  toolPayload: Record<string, unknown> | null;
  sources: SearchSource[] | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Usage and cost
// ---------------------------------------------------------------------------

export type UsageKind =
  | "realtime_response"
  | "web_search"
  | "summary"
  | "transcription"
  | "session";

export interface TokenUsage {
  inputTextTokens: number;
  inputAudioTokens: number;
  cachedTextTokens: number;
  cachedAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTextTokens: 0,
  inputAudioTokens: 0,
  cachedTextTokens: 0,
  cachedAudioTokens: 0,
  outputTextTokens: 0,
  outputAudioTokens: 0,
};

export interface UsageEvent extends TokenUsage {
  id: string;
  userId: string;
  conversationId: string | null;
  modelId: string;
  kind: UsageKind;
  searchCalls: number;
  durationSeconds: number;
  estimatedCostUsd: number;
  pricingVersion: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface UsageTotals extends TokenUsage {
  sessions: number;
  connectedSeconds: number;
  userSpeechSeconds: number;
  assistantSpeechSeconds: number;
  searchCalls: number;
  estimatedCostUsd: number;
}

export interface UsageSummary {
  range: "today" | "7d" | "all";
  totals: UsageTotals;
  byModel: Array<{ modelId: string; totals: UsageTotals }>;
  byDay: Array<{ day: string; estimatedCostUsd: number; sessions: number }>;
  caps: {
    dailyCostCapUsd: number;
    perUserDailyCostCapUsd: number;
    maxSessionMinutes: number;
    todaySpendUsd: number;
    userTodaySpendUsd: number;
  };
  pricingVersion: string;
  note: string;
}

// ---------------------------------------------------------------------------
// Session context (what the app injected into a model session)
// ---------------------------------------------------------------------------

export interface InjectedContext {
  memoryIds: string[];
  summaryIds: string[];
  /** Rough token estimate of the injected memory block. */
  estimatedTokens: number;
  humorLevel: HumorLevel;
  preferredName: string | null;
  companionVoice: CompanionVoice;
}

// ---------------------------------------------------------------------------
// Orb / conversation UI state
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | "disconnected"
  | "requesting_mic"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

export type OrbState =
  | "idle" // connected, nobody speaking
  | "connecting"
  | "listening" // user is speaking
  | "thinking" // user stopped, response not yet audible
  | "speaking" // assistant audio playing
  | "interrupted" // user barged in; assistant stopping
  | "muted"
  | "error"
  | "offline"; // not connected
