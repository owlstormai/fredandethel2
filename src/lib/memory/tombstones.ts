/**
 * Tombstones: the record of what the user asked us to forget.
 *
 * A tombstone matches a text when the normalised forms are equal, OR when the
 * tombstone has at least two keywords and >= 60% of them appear in the text.
 * Used to (a) refuse re-saving a deleted fact, (b) filter summaries at retrieval
 * time, and (c) redact summary sentences when a memory is deleted.
 *
 * Names are never keywords here: the user's preferred name and the demo display
 * names are excluded when a tombstone is created and when text is matched
 * against one, so two unrelated sentences about the same person do not match.
 *
 * Only an explicit user action may override a tombstone: `retireTombstonesFor`
 * is called by the memory service when the user confirms saving a statement
 * that matches one (see docs/DECISIONS.md). Automated paths never retire them.
 */
import { DEMO_PROFILES } from "@/lib/auth/demo";
import { deleteTombstones, insertTombstone, listTombstones, type TombstoneRecord } from "@/lib/database/memories";
import { getProfile } from "@/lib/database/profiles";
import { extractKeywords, keywordExclusions, normalizeText, overlapRatio } from "./normalize";

export type { TombstoneRecord };

export const TOMBSTONE_MIN_KEYWORDS = 2;
export const TOMBSTONE_OVERLAP_THRESHOLD = 0.6;

export interface TombstoneLike {
  normalized: string;
  keywords: readonly string[];
}

/** Pure matcher; `textKeywords` can be passed to avoid recomputing in loops. */
export function tombstoneMatchesText(
  tombstone: TombstoneLike,
  text: string,
  textKeywords?: readonly string[],
  exclude?: ReadonlySet<string>,
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized === tombstone.normalized) return true;
  if (tombstone.keywords.length < TOMBSTONE_MIN_KEYWORDS) return false;
  const keywords = textKeywords ?? extractKeywords(text, exclude);
  return overlapRatio(tombstone.keywords, keywords) >= TOMBSTONE_OVERLAP_THRESHOLD;
}

/** Pure: every tombstone the text matches. */
export function matchingTombstones<T extends TombstoneLike>(tombstones: readonly T[], text: string, exclude?: ReadonlySet<string>): T[] {
  if (tombstones.length === 0) return [];
  const keywords = extractKeywords(text, exclude);
  return tombstones.filter((t) => tombstoneMatchesText(t, text, keywords, exclude));
}

export function anyTombstoneMatches(tombstones: readonly TombstoneLike[], text: string, exclude?: ReadonlySet<string>): boolean {
  return matchingTombstones(tombstones, text, exclude).length > 0;
}

/**
 * Words that must never act as tombstone keywords for this user: the preferred
 * name from their profile plus the demo display names (lower-cased, raw and stemmed).
 */
export async function keywordExclusionsFor(userId: string): Promise<Set<string>> {
  const profile = await getProfile(userId);
  return keywordExclusions([profile?.preferredName, ...DEMO_PROFILES.map((p) => p.displayName)]);
}

/** The user's tombstones that the text matches (name keywords excluded). */
export async function findMatchingTombstones(userId: string, text: string, exclude?: ReadonlySet<string>): Promise<TombstoneRecord[]> {
  const [tombstones, exclusions] = await Promise.all([listTombstones(userId), exclude ?? keywordExclusionsFor(userId)]);
  return matchingTombstones(tombstones, text, exclusions);
}

export async function matchesTombstone(userId: string, text: string, exclude?: ReadonlySet<string>): Promise<boolean> {
  return (await findMatchingTombstones(userId, text, exclude)).length > 0;
}

export async function createTombstone(userId: string, content: string, exclude?: ReadonlySet<string>): Promise<TombstoneRecord> {
  const exclusions = exclude ?? (await keywordExclusionsFor(userId));
  return insertTombstone(userId, normalizeText(content), extractKeywords(content, exclusions));
}

/**
 * Deletes the given tombstones. ONLY for explicit user actions (a confirmed save
 * or the memory page); summarization and unconfirmed model saves must keep being
 * refused. Returns the number of tombstones retired.
 */
export async function retireTombstones(userId: string, tombstones: readonly Pick<TombstoneRecord, "id">[]): Promise<number> {
  if (tombstones.length === 0) return 0;
  return deleteTombstones(userId, tombstones.map((t) => t.id));
}

/** Retires every tombstone the text matches (see `retireTombstones`). */
export async function retireTombstonesFor(userId: string, text: string, exclude?: ReadonlySet<string>): Promise<number> {
  return retireTombstones(userId, await findMatchingTombstones(userId, text, exclude));
}

/** Flat, de-duplicated keyword list across all of a user's tombstones (handed to the summarizer). */
export async function listTombstoneKeywords(userId: string): Promise<string[]> {
  const tombstones = await listTombstones(userId);
  return Array.from(new Set(tombstones.flatMap((t) => t.keywords)));
}

export { listTombstones };
