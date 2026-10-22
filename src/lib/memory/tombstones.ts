/**
 * Tombstones: the record of what the user asked us to forget.
 *
 * A tombstone matches a text when the normalised forms are equal, OR when the
 * tombstone has at least two keywords and >= 60% of them appear in the text.
 * Used to (a) refuse re-saving a deleted fact, (b) filter summaries at retrieval
 * time, and (c) redact summary sentences when a memory is deleted.
 */
import { insertTombstone, listTombstones, type TombstoneRecord } from "@/lib/database/memories";
import { extractKeywords, normalizeText, overlapRatio } from "./normalize";

export type { TombstoneRecord };

export const TOMBSTONE_MIN_KEYWORDS = 2;
export const TOMBSTONE_OVERLAP_THRESHOLD = 0.6;

export interface TombstoneLike {
  normalized: string;
  keywords: readonly string[];
}

/** Pure matcher; `textKeywords` can be passed to avoid recomputing in loops. */
export function tombstoneMatchesText(tombstone: TombstoneLike, text: string, textKeywords?: readonly string[]): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized === tombstone.normalized) return true;
  if (tombstone.keywords.length < TOMBSTONE_MIN_KEYWORDS) return false;
  const keywords = textKeywords ?? extractKeywords(text);
  return overlapRatio(tombstone.keywords, keywords) >= TOMBSTONE_OVERLAP_THRESHOLD;
}

export function anyTombstoneMatches(tombstones: readonly TombstoneLike[], text: string): boolean {
  if (tombstones.length === 0) return false;
  const keywords = extractKeywords(text);
  return tombstones.some((t) => tombstoneMatchesText(t, text, keywords));
}

export async function matchesTombstone(userId: string, text: string): Promise<boolean> {
  const tombstones = await listTombstones(userId);
  return anyTombstoneMatches(tombstones, text);
}

export async function createTombstone(userId: string, content: string): Promise<TombstoneRecord> {
  return insertTombstone(userId, normalizeText(content), extractKeywords(content));
}

/** Flat, de-duplicated keyword list across all of a user's tombstones (handed to the summarizer). */
export async function listTombstoneKeywords(userId: string): Promise<string[]> {
  const tombstones = await listTombstones(userId);
  return Array.from(new Set(tombstones.flatMap((t) => t.keywords)));
}

export { listTombstones };
