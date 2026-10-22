/**
 * Memory service — SEAM FILE. Owner: server/memory agent.
 * Used by: tool dispatcher (live), demo brain (demo), realtime session minting, memory UI routes.
 * Every function is scoped by userId and enforces consent + provenance rules.
 *
 * Rules enforced here (see docs/DECISIONS.md):
 *  - Saving requires memory consent (latest consent_records row for "memory" AND
 *    preferences.memory_enabled). Sensitive content additionally requires
 *    "sensitive_memory" consent.
 *  - A statement matching a tombstone (something the user asked us to forget) is
 *    refused and logged as "rejected".
 *  - Near-duplicates are refused (the existing memory is returned).
 *  - Status is "confirmed" only when the user explicitly agreed to save THIS
 *    statement; otherwise "reported". Nothing here ever promotes a status.
 *  - Deleting creates a tombstone and redacts summaries that mention the fact.
 *  - Injected context never includes "inferred" items or deleted/tombstoned text.
 */
import { getLatestConsent, insertConsent } from "@/lib/database/consents";
import { getConversation, listRecentMessages } from "@/lib/database/conversations";
import { ensurePreferences, updatePreferences } from "@/lib/database/preferences";
import { ensureProfile, updateProfile as updateProfileRow } from "@/lib/database/profiles";
import type {
  ConsentScope,
  ConsentSource,
  HumorLevel,
  Memory,
  MemoryCategory,
  MemoryKind,
  MemorySensitivity,
  OnboardingStage,
  Preferences,
  Profile,
} from "@/lib/types";
import { estimateTokens, extractKeywords, normalizeText } from "./normalize";
import {
  findDuplicateMemory,
  getMemory,
  insertMemory,
  listMemories,
  logMemoryEvent,
  softDeleteMemory,
  touchLastReferenced,
} from "./repository";
import { rankMemories } from "./retrieval";
import { listRecentSummaries, suppressSummariesForDeletedMemory } from "./summaries";
import { createTombstone, matchesTombstone } from "./tombstones";

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

const SENSITIVE_CATEGORIES: ReadonlySet<MemoryCategory> = new Set(["health", "finances", "grief"]);
const STAGE_ORDER: OnboardingStage[] = ["new", "named", "interests", "memory_decided", "complete"];

function stageAtLeast(current: OnboardingStage, floor: OnboardingStage): OnboardingStage {
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(floor) ? current : floor;
}

function cleanContent(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

/** True when memory may be used at all: consent granted AND the preference switch is on. */
export async function isMemoryEnabled(userId: string): Promise<boolean> {
  const [consented, preferences] = await Promise.all([hasConsent(userId, "memory"), getPreferences(userId)]);
  return consented && preferences.memoryEnabled;
}

export async function isSensitiveMemoryEnabled(userId: string): Promise<boolean> {
  const [consented, preferences] = await Promise.all([hasConsent(userId, "sensitive_memory"), getPreferences(userId)]);
  return consented && preferences.sensitiveMemoryEnabled;
}

export async function rememberMemory(userId: string, input: RememberInput): Promise<RememberResult> {
  const content = cleanContent(input.content);
  if (!content) return { ok: false, reason: "duplicate" };
  const sensitivity: MemorySensitivity =
    input.sensitivity === "sensitive" || SENSITIVE_CATEGORIES.has(input.category) ? "sensitive" : "normal";

  if (!(await isMemoryEnabled(userId))) {
    await logMemoryEvent(userId, null, "rejected", { reason: "consent_required", kind: input.kind, category: input.category });
    return { ok: false, reason: "consent_required" };
  }
  if (sensitivity === "sensitive" && !(await isSensitiveMemoryEnabled(userId))) {
    await logMemoryEvent(userId, null, "rejected", { reason: "sensitive_consent_required", kind: input.kind, category: input.category });
    return { ok: false, reason: "sensitive_consent_required" };
  }
  if (await matchesTombstone(userId, content)) {
    await logMemoryEvent(userId, null, "rejected", { reason: "tombstoned", kind: input.kind, category: input.category });
    return { ok: false, reason: "tombstoned" };
  }
  const existing = await findDuplicateMemory(userId, content);
  if (existing) return { ok: false, reason: "duplicate", existing };

  const status: Memory["status"] = input.userConfirmed ? "confirmed" : "reported";
  const memory = await insertMemory(userId, {
    kind: input.kind,
    category: input.category,
    content,
    normalized: normalizeText(content),
    status,
    sensitivity,
    importance: Math.min(5, Math.max(1, Math.round(input.importance ?? 3))),
    sourceConversationId: input.sourceConversationId ?? null,
    metadata: input.userWords ? { userWords: input.userWords } : {},
  });
  await logMemoryEvent(userId, memory.id, "created", { status, userConfirmed: input.userConfirmed, sourceConversationId: input.sourceConversationId ?? null });
  return { ok: true, memory, status };
}

/**
 * Soft-deletes memories by id or by text match (normalised equality, then
 * keyword match: every keyword of the hint appears in the memory, or the two
 * share >= 60% of the memory's keywords). Each deletion writes a tombstone,
 * redacts summaries that mention the fact, and logs "deleted".
 */
export async function forgetMemory(userId: string, hint: { memoryId?: string; text?: string }): Promise<{ deleted: Memory[] }> {
  const targets: Memory[] = [];
  if (hint.memoryId) {
    const memory = await getMemory(userId, hint.memoryId);
    if (memory) targets.push(memory);
  } else if (hint.text && hint.text.trim()) {
    const normalized = normalizeText(hint.text);
    const hintKeywords = extractKeywords(hint.text);
    const live = await listMemories(userId, { excludeKinds: ["summary"] });
    for (const memory of live) {
      if (memory.status === "inferred" && normalized !== normalizeText(memory.content)) continue;
      const memoryKeywords = extractKeywords(memory.content);
      const exact = normalizeText(memory.content) === normalized;
      const shared = hintKeywords.filter((k) => memoryKeywords.includes(k)).length;
      const hintCovered = hintKeywords.length > 0 && shared === hintKeywords.length;
      const strongOverlap = memoryKeywords.length >= 2 && shared / memoryKeywords.length >= 0.6;
      if (exact || hintCovered || strongOverlap) targets.push(memory);
    }
  }

  const deleted: Memory[] = [];
  for (const memory of targets) {
    const removed = await softDeleteMemory(userId, memory.id);
    if (!removed) continue;
    await createTombstone(userId, memory.content);
    const suppression = await suppressSummariesForDeletedMemory(userId, memory);
    await logMemoryEvent(userId, memory.id, "deleted", { by: hint.memoryId ? "id" : "text", ...suppression });
    deleted.push(removed);
  }
  return { deleted };
}

/**
 * Keyword retrieval over live confirmed/reported/summarized memories (never
 * inferred, never deleted). Sensitive memories require sensitive consent.
 * Logs "recalled" and bumps last_referenced_at for what it returns.
 */
export async function recallMemories(userId: string, query: string, limit = 8): Promise<Memory[]> {
  if (!(await isMemoryEnabled(userId))) return [];
  const sensitiveOk = await isSensitiveMemoryEnabled(userId);
  const candidates = (await listMemories(userId, { statuses: ["confirmed", "reported", "summarized"], excludeKinds: ["summary"] })).filter(
    (m) => sensitiveOk || m.sensitivity !== "sensitive",
  );
  const ranked = rankMemories(candidates, query, limit).map((r) => r.memory);
  if (ranked.length > 0) {
    await touchLastReferenced(userId, ranked.map((m) => m.id));
    await logMemoryEvent(userId, null, "recalled", { count: ranked.length, memoryIds: ranked.map((m) => m.id), queryKeywords: extractKeywords(query) });
  }
  return ranked;
}

/** Latest consent record for the scope; false when the user never decided. */
export async function hasConsent(userId: string, scope: ConsentScope): Promise<boolean> {
  const latest = await getLatestConsent(userId, scope);
  return latest?.granted ?? false;
}

/**
 * Records a consent decision and mirrors it into preferences so the UI switch
 * and the consent log never disagree. Revoking memory consent keeps existing
 * memories but stops them from being injected or added to.
 */
export async function recordConsent(
  userId: string,
  scope: ConsentScope,
  granted: boolean,
  source: ConsentSource,
  evidence?: string,
): Promise<void> {
  await insertConsent(userId, { scope, granted, source, evidence: evidence?.slice(0, 1000) ?? null });
  await ensurePreferences(userId);
  if (scope === "memory") {
    await updatePreferences(userId, { memoryEnabled: granted, ...(granted ? {} : { sensitiveMemoryEnabled: false }) });
    const profile = await ensureProfile(userId);
    await updateProfileRow(userId, { onboardingStage: stageAtLeast(profile.onboardingStage, "memory_decided") });
  } else if (scope === "sensitive_memory") {
    await updatePreferences(userId, { sensitiveMemoryEnabled: granted });
  } else if (scope === "web_search") {
    await updatePreferences(userId, { searchEnabled: granted });
  }
}

export async function setPreferredName(userId: string, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return;
  const profile = await ensureProfile(userId);
  await updateProfileRow(userId, { preferredName: clean, onboardingStage: stageAtLeast(profile.onboardingStage, "named") });
}

export async function setHumorLevel(userId: string, level: HumorLevel): Promise<void> {
  await ensurePreferences(userId);
  await updatePreferences(userId, { humorLevel: level });
}

export async function getPreferences(userId: string): Promise<Preferences> {
  return ensurePreferences(userId);
}

interface ContextItem {
  /** Lower number = more important to keep. */
  tier: number;
  score: number;
  section: "transcript" | "confirmed" | "reported" | "summary";
  text: string;
  id: string | null;
}

const SECTION_HEADINGS = {
  confirmed: "Facts the user asked you to remember (confirmed):",
  reported: "Things the user mentioned (not confirmed — treat as likely, verify gently):",
  summary: "Recent conversation summaries:",
  transcript: "This conversation so far (you are continuing it after a model switch):",
} as const;

function trimLine(text: string, max = 240): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1).trimEnd()}…` : single;
}

/**
 * Bounded, relevant context for a new model session. Includes confirmed/reported
 * facts, recent summaries (minus tombstoned content), and — when
 * `continueConversationId` is set — the recent transcript of that conversation
 * so a switched model can pick up mid-thought. Never includes `inferred` items.
 */
export async function buildMemoryContext(
  userId: string,
  options: { maxTokens?: number; continueConversationId?: string; recentQuery?: string },
): Promise<MemoryContext> {
  const maxTokens = Math.max(50, options.maxTokens ?? 1200);
  // Memory consent gates stored facts and summaries. The transcript of the
  // conversation being continued (model switch / reconnect) is NOT memory — it
  // is the live conversation the user is having — so it is rehydrated regardless.
  const memoryOn = await isMemoryEnabled(userId);

  const sensitiveOk = memoryOn && (await isSensitiveMemoryEnabled(userId));
  const facts = memoryOn
    ? (await listMemories(userId, { statuses: ["confirmed", "reported"], excludeKinds: ["summary"] })).filter(
        (m) => sensitiveOk || m.sensitivity !== "sensitive",
      )
    : [];
  const ranked = rankMemories(facts, "", facts.length);
  if (options.recentQuery) {
    // Blend in query relevance without excluding unrelated facts entirely.
    const byQuery = new Map(rankMemories(facts, options.recentQuery, facts.length).map((r) => [r.memory.id, r.score]));
    for (const item of ranked) item.score += byQuery.get(item.memory.id) ?? 0;
    ranked.sort((a, b) => b.score - a.score);
  }

  const items: ContextItem[] = ranked.map((r) => ({
    tier: r.memory.status === "confirmed" ? 1 : 2,
    score: r.score,
    section: r.memory.status === "confirmed" ? "confirmed" : "reported",
    text: `- ${trimLine(r.memory.content)}`,
    id: r.memory.id,
  }));

  const summaries = memoryOn ? await listRecentSummaries(userId, 3) : [];
  summaries.forEach((s, index) => {
    items.push({ tier: 3, score: -index, section: "summary", text: `- ${trimLine(s.content, 600)}`, id: s.id });
  });

  if (options.continueConversationId) {
    const conversation = await getConversation(userId, options.continueConversationId);
    if (conversation) {
      const messages = await listRecentMessages(userId, conversation.id, 20);
      messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .forEach((m, index, all) => {
          items.push({
            tier: 0,
            score: index - all.length, // oldest lines are dropped first
            section: "transcript",
            text: `${m.role === "user" ? "User" : "Companion"}: ${trimLine(m.content, 300)}`,
            id: null,
          });
        });
    }
  }

  // Greedy fill: highest priority first; within a tier, highest score first.
  const order = [...items].sort((a, b) => a.tier - b.tier || b.score - a.score);
  const headingCost = Object.values(SECTION_HEADINGS).reduce((n, h) => n + estimateTokens(h) + 1, 0);
  let budget = maxTokens - Math.min(headingCost, Math.floor(maxTokens / 4));
  const kept = new Set<ContextItem>();
  for (const item of order) {
    const cost = estimateTokens(item.text) + 1;
    if (cost > budget) continue;
    budget -= cost;
    kept.add(item);
  }

  const sections: Array<ContextItem["section"]> = ["confirmed", "reported", "summary", "transcript"];
  const lines: string[] = [];
  for (const section of sections) {
    const rows = items.filter((i) => kept.has(i) && i.section === section);
    if (rows.length === 0) continue;
    lines.push(SECTION_HEADINGS[section]);
    lines.push(...rows.map((r) => r.text));
    lines.push("");
  }
  const block = lines.join("\n").trim();
  return {
    block,
    memoryIds: items.filter((i) => kept.has(i) && (i.section === "confirmed" || i.section === "reported")).map((i) => i.id as string),
    summaryIds: items.filter((i) => kept.has(i) && i.section === "summary").map((i) => i.id as string),
    estimatedTokens: estimateTokens(block),
  };
}

export async function getProfile(userId: string): Promise<Profile> {
  return ensureProfile(userId);
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, "preferredName" | "companionVoice" | "timezone" | "onboardingStage">>,
): Promise<Profile> {
  const current = await ensureProfile(userId);
  const next = { ...patch };
  if (patch.preferredName && !patch.onboardingStage) {
    next.onboardingStage = stageAtLeast(current.onboardingStage, "named");
  }
  return (await updateProfileRow(userId, next)) ?? current;
}
