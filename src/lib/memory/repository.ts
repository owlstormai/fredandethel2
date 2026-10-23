/**
 * Memory-module facade over the database repositories, plus the few helpers
 * that need both normalisation and SQL (duplicate detection, event logging).
 * Keeps the service file focused on rules rather than plumbing.
 */
import {
  findMemoryByNormalized,
  getMemory,
  insertMemory,
  insertMemoryEvent,
  listMemories,
  listMemoryEvents,
  listSummaryMemories,
  softDeleteMemory,
  touchLastReferenced,
  updateMemory,
  type InsertMemoryInput,
} from "@/lib/database/memories";
import type { Memory, MemoryEventType, MemoryKind } from "@/lib/types";
import { extractKeywords, normalizeText } from "./normalize";

export {
  findMemoryByNormalized,
  getMemory,
  insertMemory,
  listMemories,
  listMemoryEvents,
  listSummaryMemories,
  softDeleteMemory,
  touchLastReferenced,
  updateMemory,
};
export type { InsertMemoryInput };

export const DUPLICATE_MIN_KEYWORDS = 2;

/**
 * Near-duplicate: identical normalised text, or an identical keyword set of at
 * least two keywords ("I love gardening." vs "love gardening"). Summaries are
 * never considered duplicates of facts.
 */
export async function findDuplicateMemory(userId: string, content: string, kind?: MemoryKind): Promise<Memory | null> {
  const normalized = normalizeText(content);
  const exact = await findMemoryByNormalized(userId, normalized, kind);
  if (exact) return exact;
  const keywords = extractKeywords(content);
  if (keywords.length < DUPLICATE_MIN_KEYWORDS) return null;
  const key = [...keywords].sort().join(" ");
  const candidates = await listMemories(userId, { excludeKinds: ["summary"] });
  return (
    candidates.find((m) => {
      if (kind && m.kind !== kind) return false;
      const other = extractKeywords(m.content);
      return other.length === keywords.length && [...other].sort().join(" ") === key;
    }) ?? null
  );
}

export async function logMemoryEvent(
  userId: string,
  memoryId: string | null,
  event: MemoryEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await insertMemoryEvent(userId, memoryId, event, payload);
}
