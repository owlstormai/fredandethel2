/**
 * Conversation summaries are memories of kind "summary" (status "summarized").
 * Deleted facts must never leak back through them, so:
 *   - at retrieval time, summaries are filtered sentence-by-sentence through tombstones;
 *   - on delete, `suppressSummariesForDeletedMemory` redacts matching sentences in place
 *     (memory_event "suppressed"), soft-deleting a summary that has nothing left.
 * Names (the user's preferred name, demo display names) are never keywords for
 * any of this matching. Summaries carry a sensitivity label (keyword classifier)
 * so they are gated by sensitive consent exactly like facts.
 */
import { listTombstones } from "@/lib/database/memories";
import type { ConversationMessage, Memory, MemoryCategory, MemoryKind, MemorySensitivity } from "@/lib/types";
import { extractKeywords, keywordOverlap, normalizeText, splitSentences } from "./normalize";
import { findDuplicateMemory, insertMemory, listSummaryMemories, logMemoryEvent, softDeleteMemory, updateMemory } from "./repository";
import { classifySensitivity } from "./sensitivity";
import { anyTombstoneMatches, keywordExclusionsFor, tombstoneMatchesText, type TombstoneLike } from "./tombstones";

export const SUPPRESS_MIN_SHARED_KEYWORDS = 2;

/** Drops sentences that match any tombstone (equality or keyword overlap). Pure. `exclude` = name words to ignore. */
export function redactTombstonedSentences(text: string, tombstones: readonly TombstoneLike[], exclude?: ReadonlySet<string>): string {
  if (tombstones.length === 0) return text;
  const kept = splitSentences(text).filter((sentence) => {
    const keywords = extractKeywords(sentence, exclude);
    return !tombstones.some((t) => tombstoneMatchesText(t, sentence, keywords, exclude));
  });
  return kept.join(" ");
}

/**
 * Drops sentences sharing >= 2 keywords with the deleted memory (>= 1 when the
 * memory itself has only one keyword). Pure; returns the redacted text. Words in
 * `exclude` (names) never count as shared.
 */
export function redactSentencesAboutMemory(text: string, deletedContent: string, exclude?: ReadonlySet<string>): { text: string; removed: number } {
  const deletedKeywords = extractKeywords(deletedContent, exclude);
  if (deletedKeywords.length === 0) return { text, removed: 0 };
  const threshold = Math.min(SUPPRESS_MIN_SHARED_KEYWORDS, deletedKeywords.length);
  const deletedNormalized = normalizeText(deletedContent);
  let removed = 0;
  const kept = splitSentences(text).filter((sentence) => {
    const shared = keywordOverlap(deletedKeywords, extractKeywords(sentence, exclude));
    const matches = shared >= threshold || normalizeText(sentence) === deletedNormalized;
    if (matches) removed += 1;
    return !matches;
  });
  return { text: kept.join(" "), removed };
}

/** Recent summaries with tombstoned sentences removed; summaries left empty are skipped. */
export async function listRecentSummaries(userId: string, limit = 3): Promise<Memory[]> {
  const [summaries, tombstones, exclude] = await Promise.all([listSummaryMemories(userId, limit), listTombstones(userId), keywordExclusionsFor(userId)]);
  const out: Memory[] = [];
  for (const summary of summaries) {
    const redacted = redactTombstonedSentences(summary.content, tombstones, exclude).trim();
    if (!redacted) continue;
    if (anyTombstoneMatches(tombstones, redacted, exclude)) continue;
    out.push(redacted === summary.content ? summary : { ...summary, content: redacted });
  }
  return out;
}

export async function suppressSummariesForDeletedMemory(
  userId: string,
  memory: Pick<Memory, "id" | "content">,
  exclude?: ReadonlySet<string>,
): Promise<{ redacted: number; removed: number }> {
  const [summaries, exclusions] = await Promise.all([listSummaryMemories(userId, 50), exclude ?? keywordExclusionsFor(userId)]);
  let redacted = 0;
  let removed = 0;
  for (const summary of summaries) {
    const result = redactSentencesAboutMemory(summary.content, memory.content, exclusions);
    if (result.removed === 0) continue;
    const remaining = result.text.trim();
    if (!remaining) {
      await softDeleteMemory(userId, summary.id);
      await logMemoryEvent(userId, summary.id, "suppressed", {
        deletedMemoryId: memory.id,
        sentencesRemoved: result.removed,
        emptied: true,
      });
      removed += 1;
    } else {
      await updateMemory(userId, summary.id, { content: remaining, normalized: normalizeText(remaining) });
      await logMemoryEvent(userId, summary.id, "suppressed", {
        deletedMemoryId: memory.id,
        sentencesRemoved: result.removed,
        emptied: false,
      });
      redacted += 1;
    }
  }
  return { redacted, removed };
}

/**
 * Stores a summary memory after filtering it through tombstones. Null when
 * nothing survives. The sensitivity is the caller's, or else the keyword
 * classifier's verdict on the text (health / finances / grief / family conflict
 * => "sensitive"), so sensitive summaries are gated like sensitive facts.
 */
export async function storeSummaryMemory(
  userId: string,
  input: { content: string; sourceConversationId: string; modelId?: string; sensitivity?: MemorySensitivity },
): Promise<Memory | null> {
  const [tombstones, exclude] = await Promise.all([listTombstones(userId), keywordExclusionsFor(userId)]);
  const content = redactTombstonedSentences(input.content, tombstones, exclude).trim();
  if (!content || anyTombstoneMatches(tombstones, content, exclude)) return null;
  const sensitivity: MemorySensitivity = input.sensitivity ?? classifySensitivity(content);
  const memory = await insertMemory(userId, {
    kind: "summary",
    category: "other",
    content,
    normalized: normalizeText(content),
    status: "summarized",
    sensitivity,
    importance: 2,
    sourceConversationId: input.sourceConversationId,
    metadata: input.modelId ? { modelId: input.modelId } : {},
  });
  await logMemoryEvent(userId, memory.id, "created", { kind: "summary", sourceConversationId: input.sourceConversationId });
  return memory;
}

export interface CandidateInput {
  content: string;
  kind: Exclude<MemoryKind, "summary">;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
  status: "reported" | "inferred";
}

/**
 * Stores a summarizer candidate with its own provenance label ("reported" or
 * "inferred" — never promoted). Skips tombstoned, duplicate, and (without
 * sensitive consent) sensitive candidates. Returns null when skipped.
 */
export async function storeCandidateMemory(
  userId: string,
  candidate: CandidateInput,
  options: { sourceConversationId: string; sensitiveAllowed: boolean },
): Promise<Memory | null> {
  if (candidate.sensitivity === "sensitive" && !options.sensitiveAllowed) return null;
  const [tombstones, exclude] = await Promise.all([listTombstones(userId), keywordExclusionsFor(userId)]);
  if (anyTombstoneMatches(tombstones, candidate.content, exclude)) {
    await logMemoryEvent(userId, null, "rejected", { reason: "tombstoned", status: candidate.status, sourceConversationId: options.sourceConversationId });
    return null;
  }
  if (await findDuplicateMemory(userId, candidate.content)) return null;
  const memory = await insertMemory(userId, {
    kind: candidate.kind,
    category: candidate.category,
    content: candidate.content,
    normalized: normalizeText(candidate.content),
    status: candidate.status,
    sensitivity: candidate.sensitivity,
    importance: candidate.status === "inferred" ? 2 : 3,
    sourceConversationId: options.sourceConversationId,
  });
  await logMemoryEvent(userId, memory.id, "created", { status: candidate.status, source: "summarizer" });
  return memory;
}

// ---------------------------------------------------------------------------
// Heuristic (no-API) summary
// ---------------------------------------------------------------------------

const FIRST_PERSON: Array<[RegExp, (name: string) => string]> = [
  [/\bI'm\b/g, (n) => `${n} is`],
  [/\bI am\b/g, (n) => `${n} is`],
  [/\bI've\b/g, (n) => `${n} has`],
  [/\bI have\b/g, (n) => `${n} has`],
  [/\bI'd\b/g, (n) => `${n} would`],
  [/\bI'll\b/g, (n) => `${n} will`],
  [/\bI was\b/g, (n) => `${n} was`],
  [/\bI\b/g, (n) => n],
  [/\bmy\b/gi, () => "their"],
  [/\bmine\b/gi, () => "theirs"],
  [/\bmyself\b/gi, () => "themselves"],
  [/\bme\b/gi, () => "them"],
  [/\bwe're\b/gi, () => "they are"],
  [/\bwe\b/gi, () => "they"],
  [/\bour\b/gi, () => "their"],
];

/** Rewrites first-person statements into third person about `name` (or "The user"). */
export function toThirdPerson(sentence: string, name: string | null): string {
  const subject = name ?? "The user";
  let out = sentence;
  for (const [re, replacement] of FIRST_PERSON) out = out.replace(re, replacement(subject));
  // "The user is" at sentence start may now be followed by a verb agreeing with "I"; accept the roughness.
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Up to three sentences drawn from the user's longest statements, rewritten
 * without first person. Returns null when the user said nothing substantial.
 * With `allowSensitive: false` (no sensitive-memory consent) statements the
 * keyword classifier marks sensitive are dropped before composing.
 */
export function heuristicSummary(
  messages: readonly ConversationMessage[],
  preferredName: string | null,
  options: { allowSensitive?: boolean } = {},
): string | null {
  const allowSensitive = options.allowSensitive ?? true;
  const statements = messages
    .filter((m) => m.role === "user" && m.content.trim().length >= 12)
    .map((m) => m.content.trim())
    .filter((s) => allowSensitive || classifySensitivity(s) !== "sensitive")
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  if (statements.length === 0) return null;
  const sentences = statements
    .map((s) => splitSentences(s)[0] ?? s)
    .map((s) => s.length > 180 ? `${s.slice(0, 177).trimEnd()}...` : s)
    .map((s) => toThirdPerson(s, preferredName))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return Array.from(new Set(sentences)).join(" ");
}
