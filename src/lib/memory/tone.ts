/**
 * Three-channel listening, channels 2 and 3, from TEXT — pure, no I/O.
 *
 *   channel 1  WHAT was said   (context: transcript, topics, facts — the memory store)
 *   channel 2  HOW it was said (tone)
 *   channel 3  WHY it was said (intent)
 *
 * HONESTY: this module never hears audio. In demo mode, and whenever the app
 * itself classifies a transcript line, "tone" is inferred from lexical cues —
 * laughter markers ("haha"), words like "ugh", "worried", "tired", question
 * marks, greetings — not from pitch, pace or volume. In live mode the Realtime
 * model does hear the voice and reports what it noticed through the
 * `observe_tone` tool; those rows are labelled source "model", these "heuristic".
 * Deterministic: the same text always yields the same observation.
 */
import type { Intent, Tone, ToneEvent } from "@/lib/types";

export const TONES = ["humor", "warmth", "frustration", "upset", "anxiety", "confusion", "fatigue", "joy", "neutral"] as const satisfies readonly Tone[];
export const INTENTS = [
  "venting",
  "seeking_information",
  "wanting_company",
  "reminiscing",
  "asking_for_help",
  "seeking_reassurance",
  "joking",
  "planning",
  "small_talk",
] as const satisfies readonly Intent[];

/** Tones that call for warmth first and no humor. */
export const DISTRESS_TONES: ReadonlySet<Tone> = new Set(["frustration", "upset", "anxiety"]);

/** An observation is "notable" (worth a tool call / transcript entry) above this intensity. */
export const NOTABLE_INTENSITY = 0.5;

export const TONE_LABEL: Record<Tone, string> = {
  humor: "Joking",
  warmth: "Warm",
  frustration: "Frustrated",
  upset: "Upset or sad",
  anxiety: "Worried",
  confusion: "Confused",
  fatigue: "Tired",
  joy: "Cheerful",
  neutral: "Even",
};

/** Adjective form for prose ("You sounded cheerful…"). */
export const TONE_ADJECTIVE: Record<Tone, string> = {
  humor: "in a joking mood",
  warmth: "warm",
  frustration: "frustrated",
  upset: "upset",
  anxiety: "worried",
  confusion: "a little lost",
  fatigue: "tired",
  joy: "cheerful",
  neutral: "even",
};

export const INTENT_LABEL: Record<Intent, string> = {
  venting: "Getting something off your chest",
  seeking_information: "Asking a question",
  wanting_company: "Wanting company",
  reminiscing: "Reminiscing",
  asking_for_help: "Asking for help",
  seeking_reassurance: "Looking for reassurance",
  joking: "Having a laugh",
  planning: "Making plans",
  small_talk: "Small talk",
};

/** "…and came <phrase>" */
export const INTENT_PHRASE: Record<Intent, string> = {
  venting: "to get something off your chest",
  seeking_information: "with questions",
  wanting_company: "for company",
  reminiscing: "to reminisce",
  asking_for_help: "for help with something",
  seeking_reassurance: "for a bit of reassurance",
  joking: "to have a laugh",
  planning: "to make plans",
  small_talk: "for a chat",
};

export interface ToneObservation {
  tone: Tone;
  /** 0..1 — how clearly the cues point at the tone. */
  intensity: number;
  intent: Intent;
  /** The matched cue words (≤200 chars), or null for a neutral turn. */
  cue: string | null;
}

interface ToneRule {
  tone: Exclude<Tone, "neutral">;
  base: number;
  cues: RegExp[];
}

// Order = tie-break priority (first wins on equal score). Distress first so a
// joking remark about being exhausted still reads as fatigue, not humor.
const TONE_RULES: ToneRule[] = [
  {
    tone: "upset",
    base: 0.6,
    cues: [
      /\b(?:i(?:'m| am) )?(?:so |very |really )?sad\b/i,
      /\bi miss\b|\bmiss(?:ing)? (?:him|her|them|my)\b/i,
      /\blonely\b|\bon my own too much\b/i,
      /\bcr(?:y|ied|ying)\b|\btears\b|\bteary\b/i,
      /\bpassed (?:away|on)\b|\b(?:he|she|mom|mum|dad|wife|husband|mother|father|sister|brother|friend) passed\b|\bdied\b|\bfuneral\b|\bheartbroken\b|\bgrie(?:f|ving)\b/i,
      /\bfeeling (?:down|low|blue)\b|\bdown lately\b|\bno one (?:calls|visits)\b/i,
    ],
  },
  {
    tone: "anxiety",
    base: 0.6,
    cues: [
      /\bworr(?:y|ied|ies|ying)\b/i,
      /\bscared\b|\bafraid\b|\bfrightened\b|\bterrified\b/i,
      /\bnervous\b|\banxious\b|\banxiety\b|\bon edge\b|\bpanick(?:y|ing)\b/i,
      /\bwhat if\b.*\?/i,
      /\bcan'?t sleep\b|\bkeeps? me up\b/i,
    ],
  },
  {
    tone: "frustration",
    base: 0.6,
    cues: [
      /\bugh+\b|\bargh+\b|\bgrr+\b/i,
      /\bfrustrat(?:ing|ed|ion)\b/i,
      /\bsick (?:and tired )?of\b|\btired of\b|\bfed up\b|\bhad it with\b/i,
      /\bwhy won'?t\b|\bwon'?t work\b|\bnothing works\b|\bdoesn'?t work\b|\bnever works\b|\bstopped working\b/i,
      /\bstupid (?:thing|machine|phone|remote|computer)\b|\bpiece of junk\b|\buseless\b/i,
      /\bannoying\b|\bdrives me (?:crazy|mad|nuts)\b|\bfor crying out loud\b|\bdarn\b|\bdamn\b/i,
    ],
  },
  {
    tone: "confusion",
    base: 0.6,
    cues: [
      /\bi don'?t (?:understand|follow|get it)\b/i,
      /\bwhat do you mean\b|\bwhat does that mean\b/i,
      /\bconfus(?:ed|ing)\b|\bbaffled\b|\bmuddled\b/i,
      /\byou('?ve| have)? lost me\b|\bcome again\b|\bsay that again\b|\brun that by me again\b/i,
      /\bwhich (?:one|part) (?:do you|did you) mean\b|\bhuh\?/i,
    ],
  },
  {
    tone: "fatigue",
    base: 0.6,
    cues: [
      /\b(?:so |very |really |pretty |a bit )?tired\b(?! of)/i,
      /\bexhausted\b|\bworn out\b|\bwiped out\b|\bweary\b|\bdrained\b/i,
      /\bno energy\b|\bsleepy\b|\bneed (?:a|my) (?:nap|rest|lie down)\b|\blong day\b/i,
    ],
  },
  {
    tone: "humor",
    base: 0.6,
    cues: [
      /\b(?:ha){2,}h?\b|\bhah\b|\bhehe+\b|\bheh\b|\blol\b|\blmao\b/i,
      // "less joking" / "no more teasing" are requests about humor, not jokes.
      /(?<!\b(?:less|no|stop|more|fewer|enough|quit) )\b(?:just |only )?(?:kidding|joking|teasing)\b|\bjust a joke\b|\bthat'?s a joke\b/i,
      /\bpun(?:s| intended)?\b|\bplay on words\b/i,
      /\bfunny\b|\bhilarious\b|\bcrack(?:s|ed)? me up\b|\bget it\?/i,
      /😂|🤣|😄|😆/u,
    ],
  },
  {
    tone: "joy",
    base: 0.6,
    cues: [
      /\bwonderful\b|\blovely\b|\bmarvell?ous\b|\bfantastic\b|\bterrific\b|\bsplendid\b/i,
      /\bgreat day\b|\bbest day\b|\bgood day\b|\bwhat a (?:day|treat|morning)\b/i,
      /\bdelighted\b|\bthrilled\b|\bover the moon\b|\bso happy\b|\bso pleased\b|\bchuffed\b/i,
    ],
  },
  {
    tone: "warmth",
    base: 0.45,
    cues: [
      /\bthank(?:s| you)\b|\bmuch obliged\b|\bappreciate\b/i,
      /\byou'?re (?:very |so )?(?:kind|sweet|good to me|a dear)\b|\bthat'?s kind\b|\bbless you\b/i,
      /\b(?:my )?dear\b|\bsweet of you\b|\bglad (?:you'?re here|to talk)\b|\bnice (?:talking|chatting)\b/i,
    ],
  },
];

const EXCLAMATION_RE = /!/g;
const SHOUT_RE = /\b[A-Z]{4,}\b/;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ----- intent cues ----------------------------------------------------------

const HELP_RE = /\bhelp me\b|\bhow do i\b|\bhow can i\b|\bcan you help\b|\bcould you help\b|\bcan'?t (?:figure|work) out\b|\bshow me how\b|\bwalk me through\b/i;
const REASSURANCE_RE = /\bdo you think i\b|\bis (?:it|that) (?:okay|ok|all ?right|normal|silly|wrong)\b|\bam i (?:being|wrong|silly|too)\b|\bwas i (?:wrong|right)\b|\bshould i have\b|\bdid i do the right\b|\bdoes that make sense\b|\bis that bad\b/i;
const INFO_RE = /\b(?:can|could|would) you (?:tell|look|find|check)\b|\bwhat(?:'s| is| are| was|'re) (?:the|a|an|it|today|tomorrow)\b|\bwhen (?:is|does|did|will)\b|\bwhere (?:is|are|can|do)\b|\bwho (?:is|was|won)\b|\bhow (?:much|many|far|long|old|late|cold|hot|warm)\b|\bdo you know\b|\blook (?:it |that )?up\b|\bweather\b|\bforecast\b|\bnews\b|\bscore\b|\bwhat time\b/i;
const VENT_RE = /\bjust need(?:ed)? to (?:say|get|vent|tell)\b|\bget (?:it|this|that) off my chest\b|\bi'?m so (?:frustrated|tired|angry|sick|upset|fed up|done|annoyed|mad)\b|\bi can'?t believe\b|\bnobody (?:listens|cares|calls)\b|\bi'?m done with\b|\bdon'?t need advice\b|\bjust listen\b/i;
const REMINISCE_RE = /\bremember when\b|\bback then\b|\byears ago\b|\bwhen i was\b|\bin those days\b|\bused to\b|\bback in (?:the |my )?(?:day|\d{2}s|'?\d{2}|nineteen)\b|\bgrowing up\b|\bmy late\b|\bthe old days\b|\bwhen we were\b|\bi remember\b/i;
const PLAN_RE = /\bi'?m planning\b|\bplan(?:ning)? to\b|\bgoing to\b|\bgonna\b|\btomorrow i\b|\bnext (?:week|month|sunday|monday|tuesday|wednesday|thursday|friday|saturday) i\b|\bi'?ll be\b|\bwe'?re going\b|\bthinking of (?:going|doing|having|visiting)\b|\bon my list\b/i;
const GREETING_RE = /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|howdy|morning|evening)\b|\bhow are you\b|\bhow'?s it going\b|\bhow have you been\b/i;
const WEATHER_CHAT_RE = /\b(?:nice|lovely|beautiful|awful|dreadful|cold|hot|grey|gray|rainy|sunny|miserable) (?:day|morning|afternoon|evening|weather|out)\b|\bit'?s (?:raining|snowing|sunny|cold|hot|freezing|pouring)\b/i;
const NONCOMMITTAL_RE = /^(?:not much|nothing much|fine|ok(?:ay)?|alright|same old|so so|yes|yeah|no|nope|sure|right)[.!]?$/i;
const COMPANY_RE = /\bjust (?:wanted|want) to (?:talk|chat|say hello|hear a voice)\b|\bnobody to talk to\b|\bno one to talk to\b|\bkeep me company\b|\bjust chatting\b|\bquiet (?:around )?here\b|\btalk to someone\b|\bgood to hear (?:a|your) voice\b/i;
const PAST_TENSE_RE = /\b(?:was|were|had|went|came|took|made|got|said|told|saw|did|spent|used|played|worked|lived|loved|drove|walked|sat|stood|met|left|found|thought|knew|gave|ran|built|bought|visited|married|moved|taught|grew)\b|\b\w{3,}ed\b/gi;

function pickIntent(text: string, tone: Tone, words: number): Intent {
  const hasQuestion = text.includes("?");
  if (HELP_RE.test(text)) return "asking_for_help";
  if (REASSURANCE_RE.test(text)) return "seeking_reassurance";
  if (tone === "humor") return "joking";
  if (VENT_RE.test(text) || (DISTRESS_TONES.has(tone) && !hasQuestion)) return "venting";
  if (REMINISCE_RE.test(text)) return "reminiscing";
  if (hasQuestion && INFO_RE.test(text)) return "seeking_information";
  if (PLAN_RE.test(text)) return "planning";
  if (COMPANY_RE.test(text)) return "wanting_company";
  if (GREETING_RE.test(text) || WEATHER_CHAT_RE.test(text) || NONCOMMITTAL_RE.test(text.trim())) return "small_talk";
  if (hasQuestion) return "seeking_information";
  // A longer stretch of past tense is a story being told.
  if (words >= 12 && (text.match(PAST_TENSE_RE) ?? []).length >= 2) return "reminiscing";
  return "wanting_company";
}

/**
 * Lexical tone + intent of one user turn. The strongest matching tone rule wins
 * (ties go to the earlier, more serious rule); each extra matched cue adds
 * 0.15, each exclamation mark 0.05 (max 0.15), shouting 0.1. Neutral when no
 * rule matches.
 */
export function classifyTone(input: string): ToneObservation {
  const text = input.replace(/\s+/g, " ").trim();
  const words = wordCount(text);
  let best: { rule: ToneRule; hits: string[] } | null = null;
  for (const rule of TONE_RULES) {
    const hits: string[] = [];
    for (const cue of rule.cues) {
      const match = text.match(cue);
      if (match) hits.push(match[0].trim());
    }
    if (hits.length === 0) continue;
    if (!best || hits.length > best.hits.length) best = { rule, hits };
  }
  if (!best) {
    return { tone: "neutral", intensity: 0, intent: pickIntent(text, "neutral", words), cue: null };
  }
  const exclamations = Math.min(3, (text.match(EXCLAMATION_RE) ?? []).length);
  const intensity = round2(clamp01(best.rule.base + 0.15 * (best.hits.length - 1) + 0.05 * exclamations + (SHOUT_RE.test(text) ? 0.1 : 0)));
  const cue = [...new Set(best.hits.map((h) => h.toLowerCase()))].join("; ").slice(0, 200);
  return { tone: best.rule.tone, intensity, intent: pickIntent(text, best.rule.tone, words), cue };
}

export function isNotableTone(observation: Pick<ToneObservation, "tone" | "intensity">): boolean {
  return observation.tone !== "neutral" && observation.intensity >= NOTABLE_INTENSITY;
}

// ----- aggregation ----------------------------------------------------------

export interface ToneDistribution {
  tones: Partial<Record<Tone, number>>;
  intents: Partial<Record<Intent, number>>;
  count: number;
}

/** Normalised frequencies (each map sums to ~1) over the given events. */
export function toneDistribution(events: ReadonlyArray<Pick<ToneEvent, "tone" | "intent">>): ToneDistribution {
  const tones: Partial<Record<Tone, number>> = {};
  const intents: Partial<Record<Intent, number>> = {};
  let intentCount = 0;
  for (const event of events) {
    tones[event.tone] = (tones[event.tone] ?? 0) + 1;
    if (event.intent) {
      intents[event.intent] = (intents[event.intent] ?? 0) + 1;
      intentCount += 1;
    }
  }
  const count = events.length;
  for (const key of Object.keys(tones) as Tone[]) tones[key] = round2((tones[key] as number) / Math.max(1, count));
  for (const key of Object.keys(intents) as Intent[]) intents[key] = round2((intents[key] as number) / Math.max(1, intentCount));
  return { tones, intents, count };
}

function sortedEntries<K extends string>(record: Partial<Record<K, number>> | undefined): Array<[K, number]> {
  return (Object.entries(record ?? {}) as Array<[K, number]>).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Most frequent non-neutral tone with at least `minShare` of all events, or null. */
export function dominantTone(tones: Partial<Record<Tone, number>> | undefined, minShare = 0.25): { tone: Exclude<Tone, "neutral">; share: number } | null {
  const [top] = sortedEntries(tones).filter(([tone]) => tone !== "neutral");
  if (!top || top[1] < minShare) return null;
  return { tone: top[0] as Exclude<Tone, "neutral">, share: top[1] };
}

/** Most frequent intent with at least `minShare`, or null. */
export function dominantIntent(intents: Partial<Record<Intent, number>> | undefined, minShare = 0.3): { intent: Intent; share: number } | null {
  const [top] = sortedEntries(intents);
  if (!top || top[1] < minShare) return null;
  return { intent: top[0], share: top[1] };
}

export interface ConversationFeel {
  dominantTone: Tone;
  intents: Intent[];
  /** One plain sentence for the session summary, e.g. "You sounded cheerful most of the time and came to reminisce." */
  line: string;
}

/** How one conversation felt, from its tone events. Null when there is nothing to go on. */
export function describeFeel(events: ReadonlyArray<Pick<ToneEvent, "tone" | "intent">>): ConversationFeel | null {
  if (events.length === 0) return null;
  const { tones, intents } = toneDistribution(events);
  const top = dominantTone(tones, 0.2);
  const dominant: Tone = top ? top.tone : "neutral";
  const share = top ? top.share : (tones.neutral ?? 0);
  const qualifier = share >= 0.6 ? "most of the time" : share >= 0.35 ? "a good part of the time" : "at times";
  const topIntents = sortedEntries(intents).slice(0, 2).map(([intent]) => intent);
  const came = topIntents.length === 0 ? "" : ` and came ${topIntents.map((i) => INTENT_PHRASE[i]).join(" and ")}`;
  const line = dominant === "neutral" ? `You sounded even${came ? came : ""}.` : `You sounded ${TONE_ADJECTIVE[dominant]} ${qualifier}${came}.`;
  return { dominantTone: dominant, intents: topIntents, line };
}
