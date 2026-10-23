/**
 * Conversation-style ("personality") profile of the USER — pure, no I/O.
 *
 * HONESTY: the Realtime API gives the app transcripts, not prosody. Every score
 * here is inferred from the user's WORDS — laughter markers ("haha"),
 * exclamation density, question rate, words per message, story cues ("back
 * when", "I remember"), warmth vocabulary ("thank you", "dear"), humor cues,
 * contractions and slang versus formal words — never from pitch, pace or volume.
 * The profile is labelled "inferred" everywhere it is shown and is resettable.
 *
 * Deterministic: the same messages always produce the same traits.
 */
import type { HumorStyle, Intent, PersonalityProfile, StyleProfileTraits, StyleTrait, Tone } from "@/lib/types";
import { extractKeywords, stem, STOPWORDS, tokenize } from "./normalize";
import { classifySensitivity } from "./sensitivity";
import { dominantIntent, dominantTone, INTENTS, TONE_ADJECTIVE, TONES } from "./tone";

export const STYLE_TRAITS = ["humor", "energy", "formality", "verbosity", "warmth", "curiosity", "storytelling", "directness"] as const satisfies readonly StyleTrait[];
export const HUMOR_STYLES = ["wordplay", "dry", "self-deprecating", "playful", "observational", "none"] as const satisfies readonly HumorStyle[];
export const PACES = ["unhurried", "steady", "brisk"] as const;

export const MAX_TOPICS = 8;
export const MAX_PHRASES = 6;
export const MAX_NOTES = 5;
export const MAX_HUMOR_STYLES = 4;
/** Fewer user messages than this and a conversation says nothing about style. */
export const MIN_MESSAGES_FOR_ANALYSIS = 3;
/** Confidence reaches ~1 at this many messages. */
export const FULL_CONFIDENCE_MESSAGES = 40;
/** The prompt block is withheld until the profile rests on at least this many messages. */
export const MIN_EVIDENCE_FOR_PROMPT = 6;
/** One observation moves a mature profile by at most this fraction. */
export const MAX_MERGE_WEIGHT = 0.5;
/** Rough upper bound for the prompt block (~120 tokens). */
export const PROMPT_BLOCK_MAX_CHARS = 520;

export function emptyTraits(): StyleProfileTraits {
  return {
    scores: { humor: 0, energy: 0, formality: 0.5, verbosity: 0, warmth: 0, curiosity: 0, storytelling: 0, directness: 0 },
    humorStyle: [],
    topics: [],
    phrases: [],
    pace: "steady",
    notes: [],
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

// ----- lexical cues ----------------------------------------------------------

const LAUGHTER_RE = /\b(?:ha){2,}h?\b|\bhah\b|\bhehe+\b|\bheh\b|\blol\b|\blmao\b|😂|🤣|😄|😆/giu;
const JOKE_CUE_RE = /\b(?:just |only )?(?:kidding|joking|teasing)\b|\bjoke[sd]?\b|\bpun(?:s| intended)?\b|\bfunny\b|\bhilarious\b|\bget it\?|\bwisecrack\b|\bthat'?s what i call\b/gi;
const BANG_QUESTION_RE = /\?!|!\?/g;
const INTENSIFIER_RE = /\b(?:so|really|very|absolutely|totally|incredibly|wonderful|amazing|fantastic|terrific|marvell?ous|love|loved|best|great)\b/gi;
const UPBEAT_SHORT_RE = /^(?:oh boy|wow|yes!|great!|lovely!|wonderful!|oh my|you bet|how about that)\b/i;
const CONTRACTION_RE = /\b\w+'(?:t|re|ve|ll|d|m)\b/gi;
const SLANG_RE = /\b(?:gonna|wanna|gotta|kinda|sorta|yeah|yep|nope|ya|dunno|ain'?t|y'?all|folks|buddy|heck|darn|gosh|kiddo)\b/gi;
const FORMAL_RE = /\b(?:sir|ma'?am|madam|kindly|regarding|furthermore|however|therefore|nevertheless|i would (?:like|appreciate)|would you be so kind|good (?:morning|afternoon|evening)|i beg your pardon|pardon me|if i may|whom|shall)\b/gi;
const WARMTH_RE = /\bthank(?:s| you)\b|\bmuch obliged\b|\bappreciate\b|\b(?:my )?dear\b|\bbless(?:ed| you)?\b|\byou'?re (?:very |so )?(?:kind|sweet|good)\b|\bthat'?s kind\b|\bsweetheart\b|\blove(?:ly)?\b|\bglad (?:you'?re here|to talk|to hear)\b|\bnice (?:talking|chatting|of you)\b|\bhope you\b|\btake care\b|\bhow are you\b|\bbless\b/gi;
const CURIOSITY_RE = /\bi wonder\b|\bcurious\b|\btell me (?:about|more)\b|\bwhat do you think\b|\bhow does\b|\bwhy (?:is|do|does|did)\b/gi;
const STORY_CUE_RE = /\bi remember\b|\bback when\b|\bwhen i was\b|\byears ago\b|\bused to\b|\bone time\b|\bonce,? \b|\bin those days\b|\bback in\b|\bgrowing up\b|\bthe old days\b|\bmy late\b|\bwhen we were\b/gi;
const SEQUENCE_RE = /\b(?:and then|then|after that|eventually|finally|next thing|afterwards|later on|by the time|so then)\b/gi;
const PAST_TENSE_RE = /\b(?:was|were|had|went|came|took|made|got|said|told|saw|did|spent|played|worked|lived|drove|walked|sat|stood|met|left|found|thought|knew|gave|ran|built|bought|married|moved|taught|grew)\b|\b\w{3,}ed\b/gi;
const IMPERATIVE_RE = /^(?:please )?(?:tell|give|show|explain|look|find|stop|don'?t|do not|let'?s|just|read|play|remind|check|skip|go on|answer|say)\b/i;
const DISAGREE_RE = /^(?:no|nope|actually|wrong|not (?:really|quite|true)|that'?s not|i disagree|i don'?t think so|no,)\b/i;
const SELF_DEPRECATING_RE = /\b(?:at my age|my old (?:brain|bones|knees|memory)|too old|old (?:man|woman|fool|timer)|i'?m no (?:expert|spring chicken)|senior moment|these old)\b/i;
const OBSERVATIONAL_RE = /\bhave you noticed\b|\bisn'?t it (?:funny|odd|strange) how\b|\bwhy is it that\b|\bever notice\b|\bthe thing about\b/i;
const DRY_RE = /\bi suppose\b|\bnaturally\b|\bof course it (?:did|was|would)\b|\bhow (?:thrilling|exciting|convenient)\b|\bwhat a surprise\b|\bshocking\b|\bapparently\b/i;
const WORDPLAY_RE = /\bpun(?:s| intended)?\b|\bplay on words\b|\bget it\?|\bno pun\b|\bso to speak\b|\bif you'?ll pardon the\b/i;

/** Generic words (stems) that say nothing about what someone likes to talk about. */
const TOPIC_NOISE: ReadonlySet<string> = new Set([
  "morning", "afternoon", "evening", "night", "week", "weekend", "year", "time", "day", "days", "people", "person",
  "home", "house", "way", "someth", "anyth", "everyth", "nothing", "haha", "hah", "lol", "hehe", "yes", "really", "sure",
  "whole", "last", "first", "next", "long", "old", "new", "big", "small", "better", "best", "guess", "course",
  "thank", "please", "sorry", "okay", "talk", "chat", "call", "ask", "feel", "felt", "look", "seem", "put", "keep",
  "start", "end", "turn", "try", "need", "use", "stay", "let", "tri", "spent", "spend", "come", "went", "ha",
  "finally", "eventually", "behind", "brought", "bring", "built", "build", "climb", "around", "across", "through", "along",
  "another", "anyone", "everyone", "someone", "rather", "actually", "sometimes", "usually", "often", "later", "earlier",
  "took", "made", "told", "said", "asked", "started", "stopped", "happened", "happen", "wanted", "thought", "knew",
  "correct", "expect", "kindly", "regard", "regarding", "forecast", "tomorrow", "yesterday", "today", "tonight",
  "thing", "stuff", "lot", "bit", "kind", "sort", "part", "side", "place", "while", "since", "until", "almost", "already",
]);
/** Remnants of contractions after punctuation stripping ("he's" -> "hes"), never part of an expression. */
const CONTRACTION_REMNANTS: ReadonlySet<string> = new Set(["hes", "shes", "thats", "whats", "theres", "heres", "youre", "theyre", "weve", "youve", "theyve", "youll", "theyll", "youd", "theyd", "wont", "wasnt", "werent", "arent", "havent", "hasnt", "couldnt", "wouldnt", "shouldnt", "aint", "lets"]);
/** A signature expression does not begin with a bare determiner / preposition / conjunction. */
const WEAK_STARTERS: ReadonlySet<string> = new Set(["the", "a", "an", "my", "your", "his", "her", "their", "our", "its", "this", "that", "these", "those", "and", "but", "or", "so", "of", "to", "in", "on", "at", "for", "with", "is", "was", "are", "were", "be"]);

interface MessageFeatures {
  words: number;
  laughter: number;
  jokeCues: number;
  bangQuestions: number;
  exclamations: number;
  hasQuestion: boolean;
  intensifiers: number;
  upbeatShort: boolean;
  contractions: number;
  slang: number;
  formal: number;
  warmth: number;
  curiosity: number;
  storyCues: number;
  sequencing: number;
  pastTense: number;
  imperative: boolean;
  shortDeclarative: boolean;
  disagree: boolean;
}

function featuresOf(raw: string): MessageFeatures {
  const text = raw.replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  const exclamations = count(text, /!/g);
  const hasQuestion = text.includes("?");
  return {
    words,
    laughter: count(text, LAUGHTER_RE),
    jokeCues: count(text, JOKE_CUE_RE),
    bangQuestions: count(text, BANG_QUESTION_RE),
    exclamations,
    hasQuestion,
    intensifiers: count(text, INTENSIFIER_RE),
    upbeatShort: words <= 6 && (UPBEAT_SHORT_RE.test(text) || exclamations > 0),
    contractions: count(text, CONTRACTION_RE),
    slang: count(text, SLANG_RE),
    formal: count(text, FORMAL_RE),
    warmth: count(text, WARMTH_RE),
    curiosity: count(text, CURIOSITY_RE),
    storyCues: count(text, STORY_CUE_RE),
    sequencing: count(text, SEQUENCE_RE),
    pastTense: count(text, PAST_TENSE_RE),
    imperative: IMPERATIVE_RE.test(text),
    shortDeclarative: words > 0 && words <= 8 && !hasQuestion && exclamations === 0,
    disagree: DISAGREE_RE.test(text),
  };
}

function verbosityBucket(meanWords: number): number {
  if (meanWords <= 6) return 0.1;
  if (meanWords <= 12) return 0.3;
  if (meanWords <= 20) return 0.5;
  if (meanWords <= 35) return 0.7;
  if (meanWords <= 60) return 0.85;
  return 1;
}

export function paceFromScores(scores: Pick<Record<StyleTrait, number>, "energy" | "verbosity">): StyleProfileTraits["pace"] {
  const brisk = scores.energy * 0.6 + (1 - scores.verbosity) * 0.4;
  if (brisk >= 0.6) return "brisk";
  if (brisk <= 0.35) return "unhurried";
  return "steady";
}

function humorStylesOf(messages: string[], humorScore: number): HumorStyle[] {
  if (humorScore < 0.2) return ["none"];
  const styles: Array<[HumorStyle, number]> = [
    ["wordplay", messages.filter((m) => WORDPLAY_RE.test(m)).length],
    ["self-deprecating", messages.filter((m) => SELF_DEPRECATING_RE.test(m)).length],
    ["observational", messages.filter((m) => OBSERVATIONAL_RE.test(m)).length],
    ["dry", messages.filter((m) => DRY_RE.test(m)).length],
    ["playful", messages.filter((m) => LAUGHTER_RE.test(m) || /!/.test(m)).length],
  ];
  const picked = styles.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([style]) => style).slice(0, MAX_HUMOR_STYLES);
  return picked.length > 0 ? picked : ["playful"];
}

function topicsOf(messages: string[]): string[] {
  const freq = new Map<string, number>();
  // Stem -> most frequent surface form, so the profile says "tomatoes", not "tomato".
  const surface = new Map<string, Map<string, number>>();
  for (const message of messages) {
    for (const token of tokenize(message)) {
      const s = stem(token);
      const forms = surface.get(s) ?? new Map<string, number>();
      forms.set(token, (forms.get(token) ?? 0) + 1);
      surface.set(s, forms);
    }
    for (const keyword of new Set(extractKeywords(message))) {
      if (keyword.length < 4 || /^\d+$/.test(keyword) || TOPIC_NOISE.has(keyword) || /ly$/.test(keyword)) continue;
      // Health, money and grief words never become "favourite topics".
      if (classifySensitivity(keyword) === "sensitive") continue;
      freq.set(keyword, (freq.get(keyword) ?? 0) + 1);
    }
  }
  const surfaceOf = (s: string): string => {
    const forms = [...(surface.get(s)?.entries() ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return forms[0]?.[0] ?? s;
  };
  // Light grouping: a keyword that is a prefix of another (garden / gardener) folds into the shorter one.
  const keys = [...freq.keys()].sort((a, b) => a.length - b.length);
  for (const short of keys) {
    for (const long of keys) {
      if (long !== short && long.startsWith(short) && long.length - short.length <= 3 && freq.has(long) && freq.has(short)) {
        freq.set(short, (freq.get(short) ?? 0) + (freq.get(long) ?? 0));
        freq.delete(long);
      }
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const repeated = ranked.filter(([, n]) => n >= 2).map(([k]) => k);
  // Topics mentioned once are weak evidence: use them only to reach three, and only longer words.
  const singles = ranked.filter(([k, n]) => n === 1 && k.length >= 5).map(([k]) => k);
  const chosen = repeated.length >= 3 ? repeated : [...repeated, ...singles].slice(0, 3);
  return chosen.slice(0, MAX_TOPICS).map(surfaceOf);
}

function phrasesOf(messages: string[]): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const tokens = tokenize(message);
    const seen = new Set<string>();
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= tokens.length; i += 1) {
        const gram = tokens.slice(i, i + n);
        if (gram.every((t) => STOPWORDS.has(t)) || gram.some((t) => /^\d+$/.test(t) || LAUGHTER_RE.test(t) || CONTRACTION_REMNANTS.has(t))) continue;
        if (WEAK_STARTERS.has(gram[0]) || STOPWORDS.has(gram[gram.length - 1])) continue;
        seen.add(gram.join(" "));
      }
    }
    for (const gram of seen) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  const out: string[] = [];
  for (const [gram] of repeated) {
    if (out.some((kept) => kept.includes(gram) || gram.includes(kept))) continue;
    out.push(gram);
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

function notesOf(scores: Record<StyleTrait, number>, pace: StyleProfileTraits["pace"]): string[] {
  const notes: string[] = [];
  if (scores.humor >= 0.6) notes.push("Jokes back readily");
  else if (scores.humor <= 0.15) notes.push("Rarely jokes");
  if (scores.storytelling >= 0.6) notes.push("Tells long stories; likes the whole version");
  if (scores.curiosity >= 0.6) notes.push("Asks a lot of questions");
  if (scores.directness >= 0.6) notes.push("Gets to the point");
  if (scores.warmth >= 0.6) notes.push("Warm and appreciative");
  if (scores.formality >= 0.7) notes.push("Formal register");
  else if (scores.formality <= 0.3) notes.push("Casual register");
  if (scores.verbosity <= 0.3) notes.push("Speaks in short turns");
  if (pace === "brisk") notes.push("Brisk pace");
  else if (pace === "unhurried") notes.push("Unhurried pace");
  return notes.slice(0, MAX_NOTES);
}

/** Confidence in one conversation's observation: 0 below 3 messages, ~1 from 40. */
export function analysisConfidence(messageCount: number): number {
  if (messageCount < MIN_MESSAGES_FOR_ANALYSIS) return 0;
  return round2(Math.min(1, (messageCount - (MIN_MESSAGES_FOR_ANALYSIS - 1)) / (FULL_CONFIDENCE_MESSAGES - (MIN_MESSAGES_FOR_ANALYSIS - 1))));
}

/**
 * Style traits from the user's own lines of one conversation. Rates are per
 * message and saturate at a target rate, so a profile is 0..1 regardless of
 * conversation length.
 */
export function analyzeStyleHeuristic(userMessages: string[]): { traits: StyleProfileTraits; confidence: number } {
  const messages = userMessages.map((m) => m.replace(/\s+/g, " ").trim()).filter(Boolean);
  const n = messages.length;
  if (n === 0) return { traits: emptyTraits(), confidence: 0 };
  const features = messages.map(featuresOf);
  const sum = (pick: (f: MessageFeatures) => number) => features.reduce((acc, f) => acc + pick(f), 0);
  const rate = (pick: (f: MessageFeatures) => number) => sum(pick) / n;
  const share = (pick: (f: MessageFeatures) => boolean) => features.filter(pick).length / n;

  const meanWords = rate((f) => f.words);
  const humorMessages = share((f) => f.laughter > 0 || f.jokeCues > 0 || f.bangQuestions > 0);
  const humor = clamp01(humorMessages / 0.5);
  const energy = clamp01(0.5 * Math.min(1, rate((f) => f.exclamations)) + 0.3 * Math.min(1, rate((f) => f.intensifiers) / 1.5) + 0.2 * share((f) => f.upbeatShort));
  const casual = Math.min(1, (rate((f) => f.contractions) + rate((f) => f.slang)) / 1.5);
  const formal = Math.min(1, rate((f) => f.formal));
  const formality = clamp01(0.5 + 0.35 * formal - 0.35 * casual);
  const verbosity = verbosityBucket(meanWords);
  const warmth = clamp01(rate((f) => f.warmth) / 0.6);
  const curiosity = clamp01(0.8 * (share((f) => f.hasQuestion) / 0.5) + 0.2 * Math.min(1, rate((f) => f.curiosity)));
  const longNarrative = share((f) => f.words >= 30 && f.pastTense >= 2 && (f.sequencing >= 1 || f.storyCues >= 1));
  const storytelling = clamp01(0.6 * (share((f) => f.storyCues > 0) / 0.5) + 0.4 * (longNarrative / 0.4));
  const directness = clamp01(0.5 * (share((f) => f.imperative) / 0.5) + 0.3 * (share((f) => f.shortDeclarative) / 0.7) + 0.2 * (share((f) => f.disagree) / 0.3));

  const scores: Record<StyleTrait, number> = {
    humor: round2(humor),
    energy: round2(energy),
    formality: round2(formality),
    verbosity: round2(verbosity),
    warmth: round2(warmth),
    curiosity: round2(curiosity),
    storytelling: round2(storytelling),
    directness: round2(directness),
  };
  const pace = paceFromScores(scores);
  const traits: StyleProfileTraits = {
    scores,
    humorStyle: humorStylesOf(messages, scores.humor),
    topics: topicsOf(messages),
    phrases: phrasesOf(messages),
    pace,
    notes: notesOf(scores, pace),
  };
  return { traits, confidence: analysisConfidence(n) };
}

function unionCapped<T>(recent: readonly T[], older: readonly T[], cap: number): T[] {
  const out: T[] = [];
  for (const item of [...recent, ...older]) {
    if (!out.includes(item)) out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Exponential moving average of the scores (weight ≤ 0.5, so one conversation
 * never flips a profile); topics / phrases / humor styles are a capped union
 * with the newest first; notes are replaced by the newest. Pace is recomputed
 * from the merged scores. Tone/intent distributions come from the observation
 * when present (the service recomputes them from tone events).
 */
export function mergeStyleProfile(existing: StyleProfileTraits | null, observation: StyleProfileTraits, weight: number): StyleProfileTraits {
  if (!existing) {
    return { ...observation, pace: paceFromScores(observation.scores), notes: observation.notes.slice(0, MAX_NOTES) };
  }
  const w = clamp01(Math.min(MAX_MERGE_WEIGHT, weight));
  const scores = { ...existing.scores };
  for (const trait of STYLE_TRAITS) {
    scores[trait] = round2(clamp01(existing.scores[trait] * (1 - w) + observation.scores[trait] * w));
  }
  const humorStyle = unionCapped(observation.humorStyle, existing.humorStyle, MAX_HUMOR_STYLES).filter((s, _, all) => s !== "none" || all.length === 1);
  return {
    scores,
    humorStyle: humorStyle.length > 0 ? humorStyle : ["none"],
    topics: unionCapped(observation.topics, existing.topics, MAX_TOPICS),
    phrases: unionCapped(observation.phrases, existing.phrases, MAX_PHRASES),
    pace: paceFromScores(scores),
    notes: observation.notes.slice(0, MAX_NOTES),
    tones: observation.tones ?? existing.tones,
    intents: observation.intents ?? existing.intents,
  };
}

/** Defensive reader for the jsonb column: fills gaps, clamps, drops junk. */
export function coerceTraits(value: unknown): StyleProfileTraits {
  const base = emptyTraits();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<Record<keyof StyleProfileTraits, unknown>>;
  const rawScores = (raw.scores && typeof raw.scores === "object" ? raw.scores : {}) as Record<string, unknown>;
  for (const trait of STYLE_TRAITS) {
    const n = rawScores[trait];
    if (typeof n === "number") base.scores[trait] = round2(clamp01(n));
  }
  const strings = (list: unknown, cap: number): string[] =>
    Array.isArray(list) ? list.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 80)).slice(0, cap) : [];
  base.humorStyle = strings(raw.humorStyle, MAX_HUMOR_STYLES).filter((s): s is HumorStyle => (HUMOR_STYLES as readonly string[]).includes(s));
  base.topics = strings(raw.topics, MAX_TOPICS);
  base.phrases = strings(raw.phrases, MAX_PHRASES);
  base.notes = strings(raw.notes, MAX_NOTES);
  base.pace = (PACES as readonly string[]).includes(raw.pace as string) ? (raw.pace as StyleProfileTraits["pace"]) : paceFromScores(base.scores);
  const dist = <K extends string>(list: unknown, allowed: readonly K[]): Partial<Record<K, number>> | undefined => {
    if (!list || typeof list !== "object") return undefined;
    const out: Partial<Record<K, number>> = {};
    for (const [k, v] of Object.entries(list as Record<string, unknown>)) {
      if (allowed.includes(k as K) && typeof v === "number") out[k as K] = round2(clamp01(v));
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  base.tones = dist<Tone>(raw.tones, TONES);
  base.intents = dist<Intent>(raw.intents, INTENTS);
  return base;
}

// ----- descriptions ----------------------------------------------------------

const TONE_PROMPT_SENTENCE: Record<Exclude<Tone, "neutral">, string> = {
  frustration: "They are often frustrated when they arrive; be patient, concrete and brief.",
  upset: "They are often low when they arrive; warmth first, no humor until they lighten up.",
  anxiety: "They often sound worried; steady, unhurried reassurance, one thing at a time.",
  confusion: "They often lose the thread; short sentences, repeat the key point.",
  fatigue: "They often sound tired; keep turns short and offer to wrap up.",
  humor: "They are usually in a joking mood; meet it, within the humor level.",
  joy: "They are usually cheerful; enjoy it with them.",
  warmth: "They are warm and appreciative; be warm back, without gushing.",
};

const INTENT_PROMPT_SENTENCE: Record<Intent, string> = {
  venting: "They often come to vent rather than to be fixed; listen first.",
  seeking_information: "They often come with questions; answer first, briefly, then chat.",
  wanting_company: "They mostly come for company; be present, don't rush to be useful.",
  reminiscing: "They often come to reminisce; let the story run.",
  asking_for_help: "They often come for help with something; one step at a time.",
  seeking_reassurance: "They often come for reassurance; be honest and kind, not hollow.",
  joking: "They often come to have a laugh; keep it light.",
  planning: "They often come to make plans; help them think it through.",
  small_talk: "They often come for a light chat; keep it easy.",
};

/**
 * ≤ ~120 tokens of plain English for the system prompt, or "" until the
 * profile rests on at least MIN_EVIDENCE_FOR_PROMPT messages. Sentences are
 * added in priority order until the character budget is spent.
 */
export function describeStyleForPrompt(profile: Pick<PersonalityProfile, "traits" | "evidenceMessages">): string {
  if (profile.evidenceMessages < MIN_EVIDENCE_FOR_PROMPT) return "";
  const { scores, humorStyle, topics, phrases, tones, intents } = profile.traits;
  const sentences: string[] = [];
  if (scores.humor >= 0.6) {
    const styles = humorStyle.filter((s) => s !== "none").slice(0, 2);
    sentences.push(`They joke back readily${styles.length ? ` (${styles.join(", ")})` : ""}; match it when humor is on.`);
  } else if (scores.humor <= 0.15) {
    sentences.push("They rarely joke; keep humor light and infrequent.");
  }
  if (scores.storytelling >= 0.6) {
    sentences.push(scores.verbosity >= 0.6 ? "They tell long, unhurried stories; don't rush them." : "They like telling stories; let them run.");
  } else if (scores.verbosity <= 0.3) {
    sentences.push("They speak in short turns; keep your replies short too.");
  }
  if (scores.curiosity >= 0.6) sentences.push("They ask a lot of questions; answer briefly, then return one.");
  if (scores.directness >= 0.6) sentences.push("They are direct; get to the point.");
  const tone = dominantTone(tones);
  if (tone) sentences.push(TONE_PROMPT_SENTENCE[tone.tone]);
  const intent = dominantIntent(intents);
  if (intent) sentences.push(INTENT_PROMPT_SENTENCE[intent.intent]);
  if (scores.warmth >= 0.6 && tone?.tone !== "warmth") sentences.push("They are warm and appreciative; be warm back, without gushing.");
  if (scores.formality >= 0.7) sentences.push("They keep a formal register; mirror it lightly.");
  else if (scores.formality <= 0.3) sentences.push("They are casual; plain, relaxed language suits them.");
  if (scores.energy >= 0.7) sentences.push("They bring a lot of energy; keep up without getting loud.");
  if (topics.length > 0) sentences.push(`Favorite topics: ${topics.slice(0, 5).join(", ")}.`);
  if (phrases.length > 0) sentences.push(`Expressions they use: ${phrases.slice(0, 3).map((p) => `"${p}"`).join(", ")}.`);

  const lead = "How they like to talk (inferred from their words, not their voice): ";
  let out = lead;
  for (const sentence of sentences) {
    if (out.length + sentence.length + 1 > PROMPT_BLOCK_MAX_CHARS) break;
    out += (out === lead ? "" : " ") + sentence;
  }
  return out === lead ? "" : out;
}

function humorRow(scores: Record<StyleTrait, number>, humorStyle: HumorStyle[]): string {
  const styles = humorStyle.filter((s) => s !== "none").slice(0, 2);
  const styleText = styles.length ? `, mostly ${styles.join(" and ")}` : "";
  if (scores.humor >= 0.6) return `You joke often${styleText}`;
  if (scores.humor >= 0.3) return `You joke now and then${styleText}`;
  return "You rarely joke";
}

/** Rows for the memory page card. Plain second person; every row is an inference from words. */
export function describeStyleForUser(profile: Pick<PersonalityProfile, "traits">): Array<{ label: string; value: string }> {
  const { scores, humorStyle, pace, topics, phrases, tones, intents } = profile.traits;
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: "Humor", value: humorRow(scores, humorStyle) });
  rows.push({
    label: "Pace",
    value: pace === "unhurried" ? "Unhurried — you take your time and tell the long version" : pace === "brisk" ? "Brisk — short turns, plenty of energy" : "Steady — a comfortable middle pace",
  });
  if (scores.storytelling >= 0.6) rows.push({ label: "Stories", value: "You like telling stories, and they are worth hearing to the end" });
  if (scores.curiosity >= 0.6) rows.push({ label: "Questions", value: "You ask a lot of questions" });
  else if (scores.curiosity <= 0.15) rows.push({ label: "Questions", value: "You mostly tell rather than ask" });
  if (scores.directness >= 0.6) rows.push({ label: "Directness", value: "You get straight to the point" });
  if (scores.warmth >= 0.6) rows.push({ label: "Warmth", value: "You are warm and appreciative" });
  rows.push({ label: "Register", value: scores.formality >= 0.7 ? "Fairly formal" : scores.formality <= 0.3 ? "Relaxed and casual" : "Somewhere in between" });
  if (topics.length > 0) rows.push({ label: "Favorite topics", value: topics.slice(0, MAX_TOPICS).join(", ") });
  if (phrases.length > 0) rows.push({ label: "Expressions you use", value: phrases.slice(0, 4).map((p) => `“${p}”`).join(", ") });

  const toneEntries = (Object.entries(tones ?? {}) as Array<[Tone, number]>)
    .filter(([tone, share]) => tone !== "neutral" && share >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (tones && Object.keys(tones).length > 0) {
    rows.push({
      label: "How you usually sound",
      value:
        toneEntries.length === 0
          ? "Fairly even — nothing stood out"
          : toneEntries.map(([tone, share], i) => `${i === 0 ? "Often" : "sometimes"} ${TONE_ADJECTIVE[tone]}${share >= 0.5 && i === 0 ? " (most of the time)" : ""}`).join(", "),
    });
  }
  const intentEntries = (Object.entries(intents ?? {}) as Array<[Intent, number]>)
    .filter(([, share]) => share >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (intentEntries.length > 0) {
    const phrasesFor: Record<Intent, string> = {
      venting: "to get things off your chest",
      seeking_information: "to ask questions",
      wanting_company: "for company",
      reminiscing: "to reminisce",
      asking_for_help: "for help with something",
      seeking_reassurance: "for reassurance",
      joking: "to have a laugh",
      planning: "to make plans",
      small_talk: "for a chat",
    };
    const text = intentEntries.map(([intent]) => phrasesFor[intent]).join(" and ");
    rows.push({ label: "What you usually come for", value: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  return rows;
}
