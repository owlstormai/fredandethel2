/**
 * Memory service — SEAM FILE. Owner: server/memory agent.
 * Used by: tool dispatcher (live), demo brain (demo), realtime session minting, memory UI routes.
 * Every function is scoped by userId and enforces consent + provenance rules.
 */
import type {
  ConsentScope,
  ConsentSource,
  HumorLevel,
  Memory,
  MemoryCategory,
  MemoryKind,
  MemorySensitivity,
  Preferences,
} from "@/lib/types";

export interface RememberInput {
  content: string;
  kind: Exclude<MemoryKind, "summary">;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
  /** True only when the user explicitly agreed to save THIS statement. */
  userConfirmed: boolean;
  /** The user's own words, when captured. */
  userWords?: string;
  importance?: number;
  sourceConversationId?: string;
}

export type RememberResult =
  | { ok: true; memory: Memory; status: Memory["status"] }
  | { ok: false; reason: "consent_required" | "sensitive_consent_required" | "tombstoned" | "duplicate"; existing?: Memory };

export interface MemoryContext {
  /** Plain-text block to inject into model instructions. Empty string when memory is off. */
  block: string;
  memoryIds: string[];
  summaryIds: string[];
  estimatedTokens: number;
}

export async function rememberMemory(_userId: string, _input: RememberInput): Promise<RememberResult> {
  throw new Error("not implemented: rememberMemory");
}

export async function forgetMemory(_userId: string, _hint: { memoryId?: string; text?: string }): Promise<{ deleted: Memory[] }> {
  throw new Error("not implemented: forgetMemory");
}

export async function recallMemories(_userId: string, _query: string, _limit?: number): Promise<Memory[]> {
  throw new Error("not implemented: recallMemories");
}

export async function hasConsent(_userId: string, _scope: ConsentScope): Promise<boolean> {
  throw new Error("not implemented: hasConsent");
}

export async function recordConsent(
  _userId: string,
  _scope: ConsentScope,
  _granted: boolean,
  _source: ConsentSource,
  _evidence?: string,
): Promise<void> {
  throw new Error("not implemented: recordConsent");
}

export async function setPreferredName(_userId: string, _name: string): Promise<void> {
  throw new Error("not implemented: setPreferredName");
}

export async function setHumorLevel(_userId: string, _level: HumorLevel): Promise<void> {
  throw new Error("not implemented: setHumorLevel");
}

export async function getPreferences(_userId: string): Promise<Preferences> {
  throw new Error("not implemented: getPreferences");
}

/**
 * Bounded, relevant context for a new model session. Includes confirmed/reported
 * facts, recent summaries (minus tombstoned content), and — when
 * `continueConversationId` is set — the recent transcript of that conversation
 * so a switched model can pick up mid-thought. Never includes `inferred` items.
 */
export async function buildMemoryContext(
  _userId: string,
  _options: { maxTokens?: number; continueConversationId?: string; recentQuery?: string },
): Promise<MemoryContext> {
  throw new Error("not implemented: buildMemoryContext");
}

export async function getProfile(_userId: string): Promise<import("@/lib/types").Profile> {
  throw new Error("not implemented: getProfile");
}

export async function updateProfile(
  _userId: string,
  _patch: Partial<Pick<import("@/lib/types").Profile, "preferredName" | "companionVoice" | "timezone" | "onboardingStage">>,
): Promise<import("@/lib/types").Profile> {
  throw new Error("not implemented: updateProfile");
}
