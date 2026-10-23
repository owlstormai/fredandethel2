/**
 * API contracts — zod schemas for every route's request body and the TS
 * types of its response. Route handlers validate with these; the browser
 * client imports the types. Keep this file dependency-light (zod only).
 */
import { z } from "zod";
import type {
  AppMode,
  ConsentRecord,
  Conversation,
  ConversationMessage,
  InjectedContext,
  Intent,
  Memory,
  ModelConfig,
  PersonalityProfile,
  Preferences,
  Profile,
  SearchSource,
  Tone,
  ToneEvent,
  UsageSummary,
  User,
} from "@/lib/types";

// ----- shared enums ---------------------------------------------------------
export const modelKeySchema = z.enum(["full", "mini"]);
export const humorLevelSchema = z.enum(["off", "gentle", "playful"]);
export const pauseSensitivitySchema = z.enum(["patient", "balanced", "quick"]);
export const orbColorSchema = z.enum(["cyan", "violet", "emerald", "amber", "white"]);
export const textScaleSchema = z.enum(["normal", "large", "xlarge"]);
export const motionSchema = z.enum(["system", "reduced", "full"]);
export const companionVoiceSchema = z.enum(["fred", "ethel"]);
export const consentScopeSchema = z.enum(["memory", "sensitive_memory", "web_search", "transcripts"]);
export const memoryKindSchema = z.enum(["fact", "preference", "interest", "relationship", "story", "summary"]);
export const memoryStatusSchema = z.enum(["confirmed", "reported", "summarized", "inferred"]);
export const memorySensitivitySchema = z.enum(["normal", "sensitive"]);
export const memoryCategorySchema = z.enum([
  "identity", "family", "friends", "interest", "routine", "preference",
  "story", "health", "finances", "grief", "other",
]);

// ----- auth -----------------------------------------------------------------
export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  preferredName: z.string().trim().min(1).max(60).optional(),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export const demoLoginSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,32}$/) });

export interface AuthResponse { user: User }

// ----- me -------------------------------------------------------------------
export interface MeResponse {
  user: User;
  profile: Profile;
  preferences: Preferences;
  consents: Record<ConsentRecord["scope"], boolean>;
  /** Effective mode for this user: demo users are always demo; others live when configured. */
  mode: AppMode;
  capabilities: { liveConfigured: boolean; searchConfigured: boolean; summariesConfigured: boolean };
}

// ----- profile / preferences ------------------------------------------------
export const profilePatchSchema = z.object({
  preferredName: z.string().trim().min(1).max(60).nullable().optional(),
  companionVoice: companionVoiceSchema.optional(),
  timezone: z.string().max(64).nullable().optional(),
}).strict();

export const preferencesPatchSchema = z.object({
  humorLevel: humorLevelSchema.optional(),
  orbColor: orbColorSchema.optional(),
  textScale: textScaleSchema.optional(),
  motion: motionSchema.optional(),
  captions: z.boolean().optional(),
  pauseSensitivity: pauseSensitivitySchema.optional(),
  modelKey: modelKeySchema.optional(),
  memoryEnabled: z.boolean().optional(),
  sensitiveMemoryEnabled: z.boolean().optional(),
  searchEnabled: z.boolean().optional(),
}).strict();

// ----- consent --------------------------------------------------------------
export const consentSchema = z.object({
  scope: consentScopeSchema,
  granted: z.boolean(),
  source: z.enum(["ui", "voice"]).default("ui"),
  evidence: z.string().max(1000).optional(),
});

// ----- realtime session (live) ---------------------------------------------
export const realtimeSessionRequestSchema = z.object({
  modelKey: modelKeySchema,
  /** Continue this conversation's context with (possibly) another model. */
  continueConversationId: z.string().uuid().optional(),
});

export interface RealtimeSessionResponse {
  mode: "live";
  conversationId: string;
  clientSecret: string;      // ephemeral, short-lived, scoped to one session
  expiresAt: string;
  model: { key: "full" | "mini"; id: string };
  voice: { label: string; id: string };
  /** Browser-side SDP endpoint (no key inside). */
  callsUrl: string;
  context: Pick<InjectedContext, "estimatedTokens"> & { memoryCount: number; summaryCount: number };
  maxSessionSeconds: number;
}

// ----- conversations --------------------------------------------------------
export const createConversationSchema = z.object({
  mode: z.enum(["demo", "live"]),
  modelKey: modelKeySchema,
  continueConversationId: z.string().uuid().optional(),
});

export interface ConversationWithMessages extends Conversation { messages: ConversationMessage[] }

/** Client -> server telemetry batch. Ordered; idempotent per itemId where given. */
export const conversationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    content: z.string().max(20_000),
    itemId: z.string().max(128).optional(),
    sources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(2000) })).max(20).optional(),
  }),
  z.object({
    type: z.literal("usage"),
    responseId: z.string().max(128).optional(),
    inputTextTokens: z.number().int().nonnegative(),
    inputAudioTokens: z.number().int().nonnegative(),
    cachedTextTokens: z.number().int().nonnegative(),
    cachedAudioTokens: z.number().int().nonnegative(),
    outputTextTokens: z.number().int().nonnegative(),
    outputAudioTokens: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("speech"),
    speaker: z.enum(["user", "assistant"]),
    seconds: z.number().nonnegative().max(3600),
  }),
  z.object({ type: z.literal("connected"), seconds: z.number().nonnegative().max(7200) }),
  z.object({ type: z.literal("client_error"), code: z.string().max(64), message: z.string().max(500) }),
]);
export const conversationEventsBatchSchema = z.object({
  events: z.array(conversationEventSchema).min(1).max(200),
});

export interface EndConversationResponse {
  conversation: Conversation;
  summary: Memory | null;
  /** Inferred candidates awaiting user confirmation (never injected). */
  suggestedMemories: Memory[];
  /** True when this conversation updated the user's (inferred, words-only) conversation-style profile. */
  styleUpdated?: boolean;
  /** How the conversation felt, from this conversation's tone events (inferred). Absent when there were none. */
  feel?: { dominantTone: string; intents: string[]; line: string };
}

// ----- demo turn (server-side simulated brain, same memory store) ----------
export const demoTurnSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
});
export interface DemoTurnResponse {
  reply: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; output: string }>;
  uiActions: Array<Record<string, unknown>>;
  simulated: true;
}

// ----- tools ----------------------------------------------------------------
export const toolDispatchSchema = z.object({
  conversationId: z.string().uuid(),
  callId: z.string().max(128),
  name: z.string().max(64),
  arguments: z.record(z.string(), z.unknown()),
});
export interface ToolDispatchResponse {
  output: string;
  sources?: SearchSource[];
  uiAction?: Record<string, unknown>;
}

// ----- memories -------------------------------------------------------------
export const createMemorySchema = z.object({
  content: z.string().trim().min(1).max(1000),
  kind: memoryKindSchema.exclude(["summary"]).default("fact"),
  category: memoryCategorySchema.default("other"),
  sensitivity: memorySensitivitySchema.default("normal"),
  importance: z.number().int().min(1).max(5).default(3),
});
export const patchMemorySchema = z.object({
  content: z.string().trim().min(1).max(1000).optional(),
  /** Only upward confirmation by the user is allowed via API: anything -> confirmed. */
  confirm: z.literal(true).optional(),
  category: memoryCategorySchema.optional(),
  importance: z.number().int().min(1).max(5).optional(),
}).strict();

export interface MemoriesResponse { memories: Memory[]; tombstones: number }

export interface MemoryExport {
  exportedAt: string;
  user: User;
  profile: Profile;
  preferences: Preferences;
  consents: ConsentRecord[];
  memories: Memory[];
  conversations: Array<Conversation & { messages: ConversationMessage[] }>;
  /** Inferred conversation-style profile (words only, never audio); null when none. */
  personality: PersonalityProfile | null;
  /** Per-turn tone/intent observations (live: reported by the model; demo: lexical). */
  toneEvents: ToneEvent[];
}

// ----- conversation-style profile ------------------------------------------
export interface StyleProfileResponse {
  profile: PersonalityProfile | null;
  /** Plain-language rows for the memory page ("Humor: you joke often…"). */
  description: Array<{ label: string; value: string }>;
  /** Last 20 tone observations, newest first. Cues are internal and never returned. */
  recentTones: Array<{ tone: Tone; intensity: number; intent: Intent | null; createdAt: string }>;
}

// ----- usage / models / health ---------------------------------------------
export type UsageResponse = UsageSummary;
export interface ModelsResponse { models: ModelConfig[]; defaultKey: "full" | "mini" }
export interface HealthResponse {
  ok: boolean;
  db: "ok" | "error";
  liveConfigured: boolean;
  version: string;
}

export interface ApiError { error: { code: string; message: string; details?: unknown } }

// ----- additive response types (Agent C) -----------------------------------
export interface ProfileResponse { profile: Profile }
export interface PreferencesResponse { preferences: Preferences }
export interface ConsentResponse { consent: ConsentRecord }
export interface DemoProfilesResponse {
  profiles: Array<{ slug: string; displayName: string; blurb: string; companionVoice: Profile["companionVoice"] }>;
}
export interface ConversationsListResponse { conversations: Conversation[] }
export interface ConversationResponse { conversation: Conversation }
export interface ConversationEventsResponse { ok: true; received: number; stored: number }
export interface DeleteMemoryResponse { deleted: Memory[] }
export interface MemoryResponse { memory: Memory }
export interface OkResponse { ok: true }
