/**
 * Row -> domain mappers. Postgres returns snake_case columns, Date objects for
 * timestamps and strings for numeric; the domain uses camelCase, ISO strings
 * and numbers. Nothing here touches the network.
 */
import type {
  ConsentRecord,
  Conversation,
  ConversationMessage,
  Memory,
  MemoryEvent,
  ModelConfig,
  Preferences,
  Profile,
  SearchSource,
  User,
} from "@/lib/types";

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoRequired(value: Date | string): string {
  return toIso(value) as string;
}

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

// ----- users ----------------------------------------------------------------
export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  is_demo: boolean;
  demo_slug: string | null;
  token_version: number;
  created_at: Date;
  deleted_at: Date | null;
}

/** Internal view of a user: includes the password hash and token version. Never return to clients. */
export interface UserRecord extends User {
  passwordHash: string | null;
  tokenVersion: number;
  deletedAt: string | null;
}

export function mapUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    isDemo: row.is_demo,
    demoSlug: row.demo_slug,
    createdAt: toIsoRequired(row.created_at),
    passwordHash: row.password_hash,
    tokenVersion: row.token_version,
    deletedAt: toIso(row.deleted_at),
  };
}

export function toPublicUser(record: UserRecord): User {
  return {
    id: record.id,
    email: record.email,
    isDemo: record.isDemo,
    demoSlug: record.demoSlug,
    createdAt: record.createdAt,
  };
}

// ----- profiles -------------------------------------------------------------
export interface ProfileRow {
  user_id: string;
  preferred_name: string | null;
  companion_voice: Profile["companionVoice"];
  onboarding_stage: Profile["onboardingStage"];
  timezone: string | null;
  created_at: Date;
  updated_at: Date;
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    preferredName: row.preferred_name,
    companionVoice: row.companion_voice,
    onboardingStage: row.onboarding_stage,
    timezone: row.timezone,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

// ----- preferences ----------------------------------------------------------
export interface PreferencesRow {
  user_id: string;
  humor_level: Preferences["humorLevel"];
  orb_color: Preferences["orbColor"];
  text_scale: Preferences["textScale"];
  motion: Preferences["motion"];
  captions: boolean;
  pause_sensitivity: Preferences["pauseSensitivity"];
  model_key: Preferences["modelKey"];
  memory_enabled: boolean;
  sensitive_memory_enabled: boolean;
  search_enabled: boolean;
  updated_at: Date;
}

export function mapPreferences(row: PreferencesRow): Preferences {
  return {
    userId: row.user_id,
    humorLevel: row.humor_level,
    orbColor: row.orb_color,
    textScale: row.text_scale,
    motion: row.motion,
    captions: row.captions,
    pauseSensitivity: row.pause_sensitivity,
    modelKey: row.model_key,
    memoryEnabled: row.memory_enabled,
    sensitiveMemoryEnabled: row.sensitive_memory_enabled,
    searchEnabled: row.search_enabled,
    updatedAt: toIsoRequired(row.updated_at),
  };
}

// ----- consent --------------------------------------------------------------
export interface ConsentRow {
  id: string;
  user_id: string;
  scope: ConsentRecord["scope"];
  granted: boolean;
  source: ConsentRecord["source"];
  evidence: string | null;
  created_at: Date;
}

export function mapConsent(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope,
    granted: row.granted,
    source: row.source,
    evidence: row.evidence,
    createdAt: toIsoRequired(row.created_at),
  };
}

// ----- memories -------------------------------------------------------------
export interface MemoryRow {
  id: string;
  user_id: string;
  kind: Memory["kind"];
  category: Memory["category"];
  content: string;
  normalized: string;
  status: Memory["status"];
  sensitivity: Memory["sensitivity"];
  importance: number;
  source_conversation_id: string | null;
  source_message_id: string | null;
  last_referenced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  metadata: Record<string, unknown>;
}

export function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    category: row.category,
    content: row.content,
    status: row.status,
    sensitivity: row.sensitivity,
    importance: Number(row.importance),
    sourceConversationId: row.source_conversation_id,
    sourceMessageId: row.source_message_id,
    lastReferencedAt: toIso(row.last_referenced_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    deletedAt: toIso(row.deleted_at),
  };
}

export interface MemoryEventRow {
  id: string;
  user_id: string;
  memory_id: string | null;
  event: MemoryEvent["event"];
  payload: Record<string, unknown>;
  created_at: Date;
}

export function mapMemoryEvent(row: MemoryEventRow): MemoryEvent {
  return {
    id: row.id,
    userId: row.user_id,
    memoryId: row.memory_id,
    event: row.event,
    payload: row.payload ?? {},
    createdAt: toIsoRequired(row.created_at),
  };
}

// ----- conversations --------------------------------------------------------
export interface ConversationRow {
  id: string;
  user_id: string;
  mode: Conversation["mode"];
  model_key: Conversation["modelKey"];
  model_id: string;
  status: Conversation["status"];
  started_at: Date;
  ended_at: Date | null;
  connected_seconds: string | number;
  user_speech_seconds: string | number;
  assistant_speech_seconds: string | number;
  continued_from_id: string | null;
  summary_memory_id: string | null;
  metadata: Record<string, unknown>;
}

export function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    modelKey: row.model_key,
    modelId: row.model_id,
    status: row.status,
    startedAt: toIsoRequired(row.started_at),
    endedAt: toIso(row.ended_at),
    connectedSeconds: toNumber(row.connected_seconds),
    userSpeechSeconds: toNumber(row.user_speech_seconds),
    assistantSpeechSeconds: toNumber(row.assistant_speech_seconds),
    continuedFromId: row.continued_from_id,
    summaryMemoryId: row.summary_memory_id,
    metadata: row.metadata ?? {},
  };
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  seq: number;
  role: ConversationMessage["role"];
  content: string;
  item_id: string | null;
  tool_name: string | null;
  tool_payload: Record<string, unknown> | null;
  sources: SearchSource[] | null;
  created_at: Date;
}

export function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    seq: Number(row.seq),
    role: row.role,
    content: row.content,
    itemId: row.item_id,
    toolName: row.tool_name,
    toolPayload: row.tool_payload,
    sources: row.sources,
    createdAt: toIsoRequired(row.created_at),
  };
}

// ----- model configs --------------------------------------------------------
export interface ModelConfigRow {
  key: ModelConfig["key"];
  provider: "openai";
  model_id: string;
  label: string;
  tier: ModelConfig["tier"];
  enabled: boolean;
  pricing: ModelConfig["pricing"];
  pricing_version: string;
  updated_at: Date;
}

export function mapModelConfig(row: ModelConfigRow): ModelConfig {
  return {
    key: row.key,
    provider: row.provider,
    modelId: row.model_id,
    label: row.label,
    tier: row.tier,
    enabled: row.enabled,
    pricing: row.pricing,
    pricingVersion: row.pricing_version,
  };
}
