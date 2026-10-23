/**
 * Text normalisation and keyword extraction for memory matching.
 * Pure functions, no I/O. Deliberately simple (no vectors): lowercase, strip
 * punctuation, drop stopwords, light suffix stemming. Good enough to match
 * "my granddaughter Lily plays the violin" against "Lily's violin playing".
 */

export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "so", "if", "then", "than", "too", "very", "just", "really",
  "i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "you", "your", "yours", "he", "him", "his",
  "she", "her", "hers", "it", "its", "they", "them", "their", "theirs", "this", "that", "these", "those",
  "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", "did",
  "doing", "not", "no", "yes", "dont", "doesnt", "didnt", "cant", "wont", "isnt", "im", "ive", "id", "ill",
  "of", "to", "in", "on", "at", "for", "with", "about", "from", "by", "as", "up", "down", "out", "over",
  "into", "onto", "off", "through", "between", "after", "before", "during", "since", "until", "while",
  "when", "where", "what", "which", "who", "whom", "whose", "how", "why", "there", "here",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must", "also", "even", "still", "yet",
  "like", "want", "wanted", "know", "think", "thought", "mean", "guess", "said", "say", "says", "tell", "told",
  "thing", "things", "something", "anything", "nothing", "everything", "one", "ones", "some", "any", "all",
  "every", "each", "much", "many", "more", "most", "other", "another", "such", "only", "own", "same",
  "get", "got", "gets", "getting", "go", "going", "went", "gone", "come", "came", "make", "made", "take", "took",
  "oh", "well", "okay", "ok", "um", "uh", "hmm", "yeah", "yep", "please", "thanks", "thank",
  "remember", "forget", "note", "sure", "actually", "maybe", "always", "never", "often", "sometimes", "usually",
  "today", "yesterday", "tomorrow", "now", "ago", "again", "back", "lot", "lots", "bit", "little", "quite",
  "kind", "sort", "right", "pretty", "good", "great", "nice", "fine", "ever", "whether", "because", "though",
  "user", "they're", "theyre", "we're", "were",
]);

const APOSTROPHE_RE = /[‘’'`]/g;
const NON_WORD_RE = /[^\p{L}\p{N}\s]+/gu;
const WHITESPACE_RE = /\s+/g;

/** Lowercase, strip punctuation, collapse whitespace. Stable storage form (`memories.normalized`). */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(APOSTROPHE_RE, "")
    .replace(NON_WORD_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(" ") : [];
}

/** Words whose -ing/-ed ending is not a suffix (or whose stem would be misleading). */
const NO_STEM: ReadonlySet<string> = new Set([
  "morning", "evening", "something", "nothing", "anything", "everything", "during", "ceiling", "building",
  "wedding", "clothing", "feeling", "meeting", "painting", "pudding", "darling", "sibling", "spring", "string",
  "lightning", "offspring", "stocking", "dumpling", "herring", "earring",
  "tired", "hundred", "wicked", "naked", "sacred", "hatred", "kindred", "wretched", "rugged", "ragged", "jagged",
  "blessed", "aged", "beloved", "crooked", "bed", "red", "shed", "need", "seed", "feed", "weed", "speed",
]);

/** Very light stemmer: plurals, -ing, -ed. Not linguistic, just consistent. */
export function stem(word: string): string {
  if (NO_STEM.has(word)) return word;
  let w = word;
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) {
    w = w.slice(0, -3);
    if (w.length > 3 && /([^aeiou])\1$/.test(w)) w = w.slice(0, -1); // running -> run
    return w;
  }
  if (w.length > 4 && w.endsWith("ed")) {
    w = w.slice(0, -2);
    if (w.length > 3 && /([^aeiou])\1$/.test(w)) w = w.slice(0, -1); // stopped -> stop
    return w;
  }
  if (w.length > 4 && /(oes|ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2); // tomatoes -> tomato, dishes -> dish
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    return w.slice(0, -1);
  }
  return w;
}

/**
 * Unique, stemmed, non-stopword keywords (min length 3, digits allowed). Order of
 * first appearance. `exclude` drops extra words (raw or stemmed, lower-case) —
 * used so a person's name never counts as a tombstone keyword.
 */
export function extractKeywords(text: string, exclude?: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenize(text)) {
    if (STOPWORDS.has(token)) continue;
    if (token.length < 3 && !/^\d+$/.test(token)) continue;
    const stemmed = stem(token);
    if (stemmed.length < 3 && !/^\d+$/.test(stemmed)) continue;
    if (STOPWORDS.has(stemmed)) continue;
    if (exclude && (exclude.has(token) || exclude.has(stemmed))) continue;
    if (!seen.has(stemmed)) {
      seen.add(stemmed);
      out.push(stemmed);
    }
  }
  return out;
}

/**
 * Lower-cased tokens (raw and stemmed) of the given names, for `extractKeywords`'
 * `exclude`. A name shared by two unrelated sentences ("Margaret prefers tea" /
 * "Margaret talked about her mornings") must never count as a shared keyword.
 */
export function keywordExclusions(names: ReadonlyArray<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    for (const token of tokenize(name)) {
      out.add(token);
      out.add(stem(token));
    }
  }
  return out;
}

/** Number of keywords shared by two keyword lists. */
export function keywordOverlap(a: readonly string[], b: readonly string[]): number {
  const set = new Set(a);
  let count = 0;
  for (const k of new Set(b)) if (set.has(k)) count += 1;
  return count;
}

/** Fraction (0..1) of `reference` keywords that also appear in `candidate`. */
export function overlapRatio(reference: readonly string[], candidate: readonly string[]): number {
  if (reference.length === 0) return 0;
  return keywordOverlap(reference, candidate) / new Set(reference).size;
}

/** Splits prose into sentences, keeping terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[^\s])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Rough token estimate used to bound injected context: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Deterministic 32-bit FNV-1a hash of the normalised text (stable template selection). */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  const input = normalizeText(text);
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
