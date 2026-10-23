/**
 * Demo brain — a SERVER-side, deterministic, rule-based companion used in demo
 * mode. No AI API is called; every reply is `simulated: true`. It exists so the
 * whole memory/consent/onboarding loop can be exercised (and tested) against
 * the same memory store the live model uses.
 *
 * Personality per AGENTS.md: warm, curious, a little funny (humor level from
 * preferences), never pandering, honest about what it does and does not
 * remember. Serious topics drop humor for the rest of the conversation.
 * Template choice is a hash of the input so tests are stable.
 *
 * Three-channel listening in demo mode is TEXT ONLY and says so: every user
 * turn is run through `classifyTone` (lexical cues such as "ugh", "haha",
 * "worried", question marks — never audio). Distress drops humor and answers
 * with warmth; confusion shortens the reply; fatigue offers to wrap up. The
 * user's inferred conversation-style profile (words only, memory-gated) nudges
 * quip frequency and the "long version" templates. Deterministic throughout.
 */
import type { DemoTurnResponse } from "@/lib/api/contracts";
import { HttpError } from "@/lib/api/respond";
import { COMPANION_VOICES } from "@/lib/ai/models";
import { appendMessage, getConversation, mergeConversationMetadata } from "@/lib/database/conversations";
import { getPersonalityProfile } from "@/lib/database/personality";
import { insertToneEvent } from "@/lib/database/tone";
import { extractKeywords, hashText, normalizeText } from "@/lib/memory/normalize";
import { inferMemoryShape } from "@/lib/memory/sensitivity";
import * as memoryService from "@/lib/memory/service";
import { classifyTone, DISTRESS_TONES, isNotableTone, NOTABLE_INTENSITY, type ToneObservation } from "@/lib/memory/tone";
import { logWarn } from "@/lib/privacy/logging";
import type { HumorLevel, Memory, MemoryCategory, Preferences, Profile, StyleProfileTraits } from "@/lib/types";

export const GREETING_INPUT = "__greeting__";

// ---------------------------------------------------------------------------
// Pure classifiers (exported for unit tests)
// ---------------------------------------------------------------------------

const LEAD_IN = String.raw`^(?:(?:hey|ok|okay|please|so|and|oh|well|um|uh|hmm|right)[,\s]+)*`;
const POLITE = String.raw`(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?`;

const EMERGENCY_RE = new RegExp(
  String.raw`\b(chest pains?|can'?t breathe|cannot breathe|trouble breathing|not breathing|can'?t get up|heart attack|stroke|bleeding (?:badly|heavily|a lot|won'?t stop)|unconscious|overdose|choking)\b`,
  "i",
);
const CRISIS_RE = /\b(kill myself|suicid\w*|end (?:it all|my life)|don'?t want to (?:live|be here|go on|wake up)|hurt myself|no reason to (?:live|go on))\b/i;

export type SeriousKind = "grief" | "health" | "mood" | "money";
const SERIOUS: Array<{ kind: SeriousKind; re: RegExp }> = [
  { kind: "grief", re: /\b(died|dying|passed (?:away|on)|funeral|memorial|grie(?:f|ving)|lost my (?:wife|husband|son|daughter|sister|brother|mother|father|mom|dad|friend|partner|dog|cat)|miss (?:him|her|them) (?:so much|terribly|every day))\b/i },
  { kind: "health", re: /\b(hospital|hospice|diagnos(?:is|ed)|cancer|surgery|chemo\w*|dementia|alzheimer'?s?|can'?t sleep|cannot sleep|haven'?t slept|fell (?:down|over|again|yesterday|today|last|this|off|in the|on the)|i fell|in pain|pain (?:in|is|has|keeps|won'?t|gets)|hurts?|dizzy|not feeling well|feel(?:ing)? (?:sick|ill|awful|terrible))\b/i },
  { kind: "mood", re: /\b(lonely|loneliness|so alone|all alone|scared|frightened|afraid|depress(?:ed|ion|ing)|anxious|anxiety|hopeless|cry(?:ing)?|cried|worried sick|nobody (?:calls|visits|comes)|no one (?:calls|visits|comes))\b/i },
  { kind: "money", re: /\b(money (?:trouble|troubles|problems|worries|is tight)|can'?t afford|bills (?:are )?piling|behind on (?:the )?(?:rent|bills|mortgage)|in debt|scam(?:med|mer)?|evict(?:ed|ion))\b/i },
];

export function detectEmergency(text: string): "emergency" | "crisis" | null {
  if (CRISIS_RE.test(text)) return "crisis";
  if (EMERGENCY_RE.test(text)) return "emergency";
  return null;
}

export function detectSerious(text: string): SeriousKind | null {
  if (/\bfell in love\b|\bfell asleep\b/i.test(text) && !/\b(hospital|pain|hurt)\b/i.test(text)) return null;
  for (const { kind, re } of SERIOUS) if (re.test(text)) return kind;
  return null;
}

export interface Falsehood {
  re: RegExp;
  reply: string;
}
export const FALSEHOODS: readonly Falsehood[] = [
  { re: /great wall.*\b(space|orbit|moon)\b|\b(space|orbit|moon)\b.*great wall/i, reply: "I'll gently push back on that one — the Great Wall is very long but only a few meters wide, and astronauts have said they can't pick it out from orbit with the naked eye." },
  { re: /\b(10|ten)\s?(percent|%) of (our|the|your|their|my) brains?\b/i, reply: "I have to disagree there — brain scans show we use just about all of it, only not every part at the same instant. The ten-percent idea is a myth that refuses to retire." },
  { re: /lightning (never|doesn'?t|does not) strikes? (the same place |the same spot )?twice/i, reply: "Actually, it does — the Empire State Building takes around twenty strikes a year. Lightning likes a tall target and keeps coming back for it." },
  { re: /goldfish.*\b(three|3)[-\s]?seconds?\b|goldfish.*\b(memory|memories|remember)\b/i, reply: "I'll stick up for the goldfish — researchers have trained them to remember things for months. Their reputation is worse than their memory." },
  { re: /moon landings? (was|were|is|are) (a )?(fake|faked|staged|hoax)|never (went|landed|got) (on|to) the moon|faked the moon landing/i, reply: "I don't think so — six crews landed, brought back hundreds of kilos of moon rock, and left mirrors that observatories still bounce lasers off today." },
  { re: /bulls? (hate|charge at|see|get angry at|are angered by) (the colou?r )?red|red makes bulls/i, reply: "A small correction: bulls are red-green colorblind. It's the cape's movement that sets them off, not the color." },
  { re: /einstein (failed|flunked|was bad at) (math|maths|mathematics|school)/i, reply: "That one's a legend, I'm afraid — Einstein was excellent at mathematics as a boy and was doing calculus by fifteen." },
  { re: /sugar makes (kids|children|them) hyper/i, reply: "I'd quibble with that — controlled studies keep finding no effect. It's usually the party, not the cake." },
  { re: /swallow (about |around |like )?(eight|8) spiders/i, reply: "Happily, no — that statistic was invented to show how easily made-up facts spread. Spiders steer well clear of a sleeping person's breath." },
  { re: /cracking (your |my |his |her )?knuckles (causes|gives you|leads to|will give you) arthritis/i, reply: "I'll disagree there — one doctor cracked the knuckles of a single hand for sixty years to check, and found no arthritis on either side." },
  { re: /napoleon was (really |very |quite |so )?short/i, reply: "Mild disagreement — he was about five foot six or seven, average for a Frenchman of his day. The nickname was affectionate, not literal." },
  { re: /bats are blind/i, reply: "Not quite — bats can see, and some see rather well. They just also happen to have echolocation, which is showing off." },
];

export function detectFalsehood(text: string): Falsehood | null {
  return FALSEHOODS.find((f) => f.re.test(text)) ?? null;
}

const RECALL_RE = /\b(what|which|anything|something) (do|did|can|could|have|has) you (remember|know|recall|keep|kept|save|saved|store|stored|got|have)\b|\bwhat (do you|you) know about me\b|\bdo you remember (anything|me|things|what|who)\b|\bwhat('s| is) in (your|my) memory\b|\bremind me what you (remember|know|have|kept)\b|\bwhat have you (saved|stored|kept|remembered|learned)\b|\blist (my|your|the) memories\b/i;
export function isRecallRequest(text: string): boolean {
  return RECALL_RE.test(text);
}

const REMEMBER_RE = new RegExp(
  LEAD_IN + POLITE + String.raw`(?:remember|don'?t forget|do not forget|make a note|note down|note|keep in mind|write down|save)(?:\s+(?:that|this|please|for me|it down))*\s*[:,\-—]?\s*(.+)$`,
  "i",
);
export function parseRememberRequest(text: string): string | null {
  if (isRecallRequest(text) || /^\s*do you remember\b/i.test(text)) return null;
  const match = text.trim().match(REMEMBER_RE);
  if (!match) return null;
  const content = match[1].trim().replace(/[.!?]+$/, "");
  if (!content || /^(when|how|what|if|whether|me\b|us\b|about when)/i.test(content)) return null;
  if (extractKeywords(content).length === 0 && content.split(/\s+/).length < 2) return null;
  return content;
}

const NEVER_MIND_RE = /^\s*(?:(?:oh|ok|okay)[,\s]+)?(?:forget (?:it|that)|never ?mind)\s*[.!]*\s*$/i;
const FORGET_RE = new RegExp(
  LEAD_IN + POLITE + String.raw`(?:forget|delete|erase|remove|scrap|stop remembering|don'?t remember|do not remember|don'?t keep|do not keep)(?:\s+(?:that|about|the memory about|the memory that|the memory of|the memory|what i (?:said|told you) about|the fact that|the bit about|the part about|anything about|everything about|the thing about))*\s*[:,\-—]?\s*(.+)$`,
  "i",
);
export function parseForgetRequest(text: string): { content: string } | "never_mind" | null {
  if (NEVER_MIND_RE.test(text)) return "never_mind";
  if (/\bdon'?t forget\b|\bdo not forget\b/i.test(text)) return null;
  const match = text.trim().match(FORGET_RE);
  if (!match) return null;
  const content = match[1].trim().replace(/[.!?]+$/, "");
  if (!content || extractKeywords(content).length === 0) return null;
  return { content };
}

const HUMOR_OFF_RE = /\b(stop|no|quit|enough|cut)( with| of)?( the| your)?( more)? (jok(?:es|ing)|kidding|humou?r|being funny|wisecracks|puns)\b|\bno (more )?jokes\b|\bbe serious\b|\bstop being funny\b|\bturn (?:the )?(?:jokes|humou?r) off\b/i;
const HUMOR_DOWN_RE = /\b(less|fewer|not so many|not so much|not as many|tone down|dial back|ease up on|go easy on) (?:the |with the |on the )?(jok(?:es|ing)|kidding|humou?r|funny stuff|puns)\b|\bless joking\b|\bfewer jokes\b/i;
const HUMOR_UP_RE = /\b(more|extra|some more|a few more) (jok(?:es|ing)|humou?r|puns|funny)\b|\bbe (funnier|more funny|more playful|sillier)\b|\blighten (?:it |things )?up\b|\bmake me laugh\b|\bturn (?:the )?(?:jokes|humou?r) (?:back )?on\b/i;

export function parseHumorCommand(text: string, current: HumorLevel): HumorLevel | null {
  if (HUMOR_OFF_RE.test(text)) return "off";
  if (HUMOR_DOWN_RE.test(text)) return current === "playful" ? "gentle" : "off";
  if (HUMOR_UP_RE.test(text)) return current === "off" ? "gentle" : "playful";
  return null;
}

const NAME_REJECT = new Set([
  "yes", "no", "hello", "hi", "hey", "okay", "ok", "sure", "thanks", "thank", "what", "nothing", "fine", "good", "here",
  "ready", "well", "um", "not", "none", "nobody", "please", "anything", "whatever", "just", "still", "also", "going",
  "tired", "sorry", "happy", "sad", "lonely", "hungry", "busy", "back", "done", "home", "glad", "afraid", "scared", "the",
]);
const NAME_WORD = String.raw`([A-Za-z][A-Za-z'\-]{1,30})`;
const NAME_EXPLICIT_RE = new RegExp(String.raw`\b(?:call me|my name is|my name's|the name is|i go by|you can call me|just call me|everyone calls me|people call me|i'?m called|name's)\s+` + NAME_WORD + String.raw`(?:\s+(?!and\b|but\b|or\b|if\b|so\b|please\b)([A-Z][A-Za-z'\-]{1,30}))?`, "i");
const NAME_SOFT_RE = new RegExp(String.raw`^(?:(?:oh|well|um|uh|hmm)[,\s]+)*(?:it'?s|i'?m|i am|this is|that'?s)\s+` + NAME_WORD + String.raw`(?:\s+([A-Z][A-Za-z'\-]{1,30}))?(?=[\s.,!]|$)`, "i");
const NAME_BARE_RE = new RegExp(String.raw`^(?:(?:oh|well|um|uh|hmm)[,\s]+)*` + NAME_WORD + String.raw`(?:\s+([A-Z][A-Za-z'\-]{1,30}))?[.!]?$`, "i");

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Extracts a preferred name. Explicit forms ("call me Peg") work any time;
 * soft forms ("it's Peg", bare "Peg") only when we have just asked for a name.
 */
export function parseNameStatement(text: string, awaitingName: boolean): string | null {
  const candidates: RegExp[] = awaitingName ? [NAME_EXPLICIT_RE, NAME_SOFT_RE, NAME_BARE_RE] : [NAME_EXPLICIT_RE];
  const wordCount = text.trim().split(/\s+/).length;
  for (const re of candidates) {
    const match = text.trim().match(re);
    if (!match) continue;
    const first = match[1];
    if (!first || NAME_REJECT.has(first.toLowerCase()) || first.length < 2) continue;
    if (!/^[A-Za-z][A-Za-z'\-]*$/.test(first)) continue;
    // Soft forms ("I'm Peg and ...") need a capitalised name unless the whole reply is short.
    if (re === NAME_SOFT_RE && wordCount > 3 && first.charAt(0) !== first.charAt(0).toUpperCase()) continue;
    // A second word is a surname only when it is actually capitalised (the regexes are case-insensitive).
    const secondRaw = match[2];
    const second =
      secondRaw && /^[A-Z]/.test(secondRaw) && !NAME_REJECT.has(secondRaw.toLowerCase()) && !/^(and|but|or|if|so|then|please)$/i.test(secondRaw)
        ? ` ${titleCase(secondRaw)}`
        : "";
    return `${titleCase(first)}${second}`;
  }
  return null;
}

const NO_RE = /\b(no|nope|nah|not now|not yet|not really|rather not|don'?t|do not|never|no thanks|no thank you|maybe later|later|skip|pass|leave it|i don'?t think so|prefer not|not today)\b/i;
const YES_RE = /\b(yes|yeah|yep|yup|sure|okay|ok|alright|all right|of course|please do|go ahead|absolutely|certainly|definitely|i('?d| would) like that|that('?s| is) fine|that would be (nice|good|fine|lovely|great)|sounds good|why not|do that|i think so|let'?s do (that|it)|you may|you can|fine by me|happy to|i'?d love that)\b/i;

export function isNo(text: string): boolean {
  return NO_RE.test(text) && !/^\s*(yes|yeah|yep|sure|okay|ok|of course|absolutely)\b/i.test(text);
}
export function isYes(text: string): boolean {
  return YES_RE.test(text) && !isNo(text);
}

const SKIP_RE = /^\s*(?:(?:oh|well|um|hmm)[,\s]+)*(nothing|not much|nothing much|skip|pass|i don'?t know|dunno|not sure|no|nope|nothing really|can'?t think of anything)\b/i;
const FAREWELL_RE = /\b(bye|goodbye|good night|goodnight|talk (to you )?(later|tomorrow|soon)|that'?s all for (now|today)|see you (later|tomorrow|soon)|i('?m| am) (done|finished) for (now|today)|let'?s stop (here|now)|end (the|this) (conversation|chat|call))\b/i;
const THANKS_RE = /^\s*(?:(?:oh|well|ok|okay)[,\s]+)*(thank you|thanks|much obliged|ta)\b[^?]*$/i;
const HELLO_RE = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|howdy)\b[^?]*$/i;
const HOW_ARE_YOU_RE = /\bhow (are|r) (you|ya)( doing| today)?\b|\bhow('?s| is) it going\b|\bhow have you been\b/i;

// ---------------------------------------------------------------------------
// Memory shape inference for "remember that ..." — shared with the summary
// pipeline, so it lives in the memory layer (re-exported for the unit tests).
// ---------------------------------------------------------------------------

export { inferMemoryShape, type MemoryShape } from "@/lib/memory/sensitivity";

// ---------------------------------------------------------------------------
// Phrasing helpers
// ---------------------------------------------------------------------------

export function pick<T>(items: readonly T[], hash: number, salt = 0): T {
  return items[(hash + salt) % items.length];
}

const SECOND_PERSON: Array<[RegExp, string]> = [
  [/\bI'm\b/g, "you're"], [/\bI am\b/g, "you are"], [/\bI've\b/g, "you've"], [/\bI'd\b/g, "you'd"], [/\bI'll\b/g, "you'll"],
  [/\bI was\b/g, "you were"], [/\bam I\b/g, "are you"], [/\bI\b/g, "you"], [/\bmy\b/gi, "your"], [/\bmine\b/gi, "yours"],
  [/\bmyself\b/gi, "yourself"], [/\bme\b/gi, "you"],
];

export function toSecondPerson(text: string): string {
  let out = text;
  for (const [re, rep] of SECOND_PERSON) out = out.replace(re, rep);
  return out;
}

const FILLER_RE = /^(?:(?:well|so|oh|um|uh|hmm|you know|i mean|i think|i guess|honestly|anyway|actually|yes|yeah|no)[,\s]+)+/i;

/** A short second-person echo of the user's first clause, or null when too short to echo. */
export function echoPhrase(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim().replace(FILLER_RE, "");
  const clause = cleaned.split(/[,.;:!?]|\s(?:but|because|although|though|and then|which)\s/i)[0]?.trim() ?? "";
  const words = clause.split(" ").filter(Boolean);
  if (words.length < 3) return null;
  const phrase = toSecondPerson(words.slice(0, 12).join(" "));
  const first = phrase.split(" ")[0];
  const lowerFirst = /^(you|you're|you've|you'd|you'll|your|yours|the|a|an|it|it's|there|this|that|we|we're|they|my|our|our)$/i.test(first);
  return lowerFirst ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : phrase;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const REFLECT_WITH_PHRASE = [
  "So {P}. Tell me more — what was the best part of that?",
  "{PC} — I'd like the longer version, if you're in the mood. Where does it start?",
  "Hm, {P}. What happened next?",
  "It sounds like {P}. Is that a usual thing for you, or a one-off?",
  "{PC}. I'm curious what made that stand out today.",
  "{PC} — that caught my attention. How did it come about?",
];
const REFLECT_PLAIN = [
  "I'm listening. Where does the story go from there?",
  "Go on — what was going through your mind?",
  "That's worth dwelling on. What's the part you keep coming back to?",
  "Tell me more about that. I've got nowhere else to be.",
  "I'd like to hear the rest of it, at whatever pace suits you.",
];
const REFLECT_WITH_NAME = [
  "Tell me more about that, {N}. What was going through your mind?",
  "{N}, I'd like to hear where that goes.",
];
/** For a user whose (inferred) profile says they like the long version: invite it. */
const REFLECT_WITH_PHRASE_LONG = [
  "{PC} — I'd like the longer version, if you're in the mood. Where does it start?",
  "{PC}. Take your time with it — I'd rather hear the whole thing than the short version.",
  "{PC}. Don't skip the details on my account; start wherever it starts.",
];
const REFLECT_PLAIN_LONG = [
  "I'd like to hear the rest of it, at whatever pace suits you.",
  "Tell me the long version. I've got nowhere else to be.",
  "Go on — from the beginning, if you like. I'm listening.",
];
/** Profile thresholds (scores are 0..1, inferred from words). */
export const STYLE_HUMOR_THRESHOLD = 0.6;
export const STYLE_VERBOSITY_THRESHOLD = 0.6;

/** Channel-2 replies (tone inferred from the words, never audio). One gentle question each. */
const TONE_REPLIES: Record<"frustration" | "upset" | "anxiety", string[]> = {
  frustration: [
    "That does sound frustrating. Let's slow right down — no rush at all. What's the part that's giving you the most trouble?",
    "I'd be fed up too. Take a breath; we'll take it one step at a time. Which bit is being stubborn?",
  ],
  upset: [
    "I'm sorry — that sounds hard. I'm here, and there's no need to hurry. Would you like to tell me more about it?",
    "That's a heavy thing to carry. I'm listening, for as long as you like. What's on your mind most?",
  ],
  anxiety: [
    "That sounds worrying, and it makes sense that it's on your mind. Take your time. What's weighing on you most right now?",
    "It's alright to be nervous about it. We can go slowly. What's the part you keep coming back to?",
  ],
};
const FATIGUE_REPLIES = [
  "You sound tired. We can stop here and pick it up another time, or carry on gently — whichever you'd prefer.",
  "It sounds like it's been a long one. Shall we wrap up for now, or would a quiet few minutes more suit you?",
];
const CONFUSION_REPLIES = [
  "Sorry — let me put that more simply. Tell me which part lost you, and I'll take it one step at a time.",
  "My fault for rushing. Which bit should I say again, more plainly?",
];

const TOPIC_QUIPS: Array<{ keys: string[]; quips: string[] }> = [
  { keys: ["garden", "tomato", "weed", "flower", "plant", "seed", "rose"], quips: ["I'd help with the weeding, but I have a strict no-dirt policy, on account of having no hands.", "A garden is the one place where 'things are growing out of control' counts as good news."] },
  { keys: ["crossword", "puzzle", "clue"], quips: ["Seven letters, 'what I am to you' — I'm hoping the answer is 'company'.", "I'm good at crosswords right up until the clue is about anything that happened after my last update."] },
  { keys: ["jazz", "record", "music", "song", "basie", "ella", "trumpet", "piano", "sing", "choir"], quips: ["Jazz is the only music where playing the wrong note on purpose is called 'style'.", "I'd put on a record for you if I had hands, a turntable, or a sense of rhythm."] },
  { keys: ["coffee", "tea", "kettle", "cup"], quips: ["I'd offer to put the kettle on, but my kettle is purely theoretical.", "Coffee: proof that some of the best things in life are hot brown water with ambition."] },
  { keys: ["weather", "rain", "snow", "sunny", "cold", "hot", "storm", "wind"], quips: ["Weather is the one topic where everyone is an expert and nobody is right.", "I don't feel the cold myself, but I'm told complaining about it is half the fun."] },
  { keys: ["brown", "guardian", "cav", "cleveland", "game", "football", "baseball", "team", "score", "playoff"], quips: ["Being a Cleveland fan builds character. Mostly the patient kind.", "Sports: grown adults shouting at a television that cannot hear them. I understand completely."] },
  { keys: ["wood", "woodwork", "birdhouse", "garage", "build", "saw", "hammer", "sand", "shop"], quips: ["Measure twice, cut once — advice I'd follow if I could hold a tape measure.", "A birdhouse is the only real estate project that still comes in under budget."] },
  { keys: ["dog", "cat", "pet", "puppy", "kitten"], quips: ["Pets are the only roommates who are thrilled every single time you come home.", "A cat's affection is like a grant — real, but you have to keep reapplying."] },
  { keys: ["cook", "bake", "recipe", "dinner", "pie", "bread", "soup", "casserole"], quips: ["I love a good recipe. I can't taste anything, but I admire the ambition.", "Baking is chemistry you're allowed to eat. Chemistry class never offered that."] },
  { keys: ["book", "read", "library", "novel", "mystery"], quips: ["A good book is the only place where being lost is the whole point.", "I read quickly — it's remembering where I put the bookmark that's beyond me."] },
  { keys: ["grandchild", "granddaughter", "grandson", "violin", "recital", "grandkid"], quips: ["Grandchildren: all of the fun, none of the paperwork.", "A violin recital takes courage — from the player, and from everyone smiling bravely in row three."] },
];
const GENERIC_QUIPS = [
  "I'd make a joke here, but I'm pacing myself.",
  "I've got all day — that's one of the perks of not needing sleep.",
  "Not to brag, but I'm an excellent listener. It's practically my only skill.",
  "Between us, I'm very good company. I've checked my reviews.",
];

/** Pick from the quips not yet used in this conversation; "" when they are all spent. */
function pickUnused(list: readonly string[], hash: number, salt: number, used: readonly string[]): string {
  const fresh = list.filter((q) => !used.includes(q));
  return fresh.length ? pick(fresh, hash, salt) : "";
}

/** A quip for the turn, or "" — frequency depends on humor level; never when serious; never repeated. */
export function maybeQuip(text: string, humor: HumorLevel, hash: number, used: readonly string[] = []): string {
  if (humor === "off") return "";
  const keywords = extractKeywords(text);
  const topic = TOPIC_QUIPS.find((t) => t.keys.some((k) => keywords.some((kw) => kw.startsWith(k) || k.startsWith(kw))));
  if (humor === "gentle") {
    if (!topic || hash % 3 !== 0) return "";
    return pickUnused(topic.quips, hash, 1, used);
  }
  // playful
  if (hash % 3 === 2) return "";
  return topic ? pickUnused(topic.quips, hash, 1, used) : pickUnused(GENERIC_QUIPS, hash, 2, used);
}

// ---------------------------------------------------------------------------
// Turn engine
// ---------------------------------------------------------------------------

export interface DemoState {
  awaiting: "name" | "interest" | "memory_consent" | "sensitive_consent" | null;
  pendingInterest?: string | null;
  pendingRemember?: { content: string; userWords: string; userConfirmed: boolean } | null;
  serious?: boolean;
  unclear?: number;
  turns?: number;
  /** Quips already used in this conversation — never repeat one. */
  usedQuips?: string[];
}

type ToolCall = DemoTurnResponse["toolCalls"][number];

interface Turn {
  userId: string;
  conversationId: string;
  text: string;
  hash: number;
  profile: Profile;
  prefs: Preferences;
  memoryOn: boolean;
  state: DemoState;
  companion: string;
  name: string | null;
  humor: HumorLevel;
  /** Inferred conversation-style profile (words only); null without memory consent or evidence. */
  style: StyleProfileTraits | null;
  /** Lexical tone/intent of this turn (demo: text only); null for the greeting. */
  tone: ToneObservation | null;
  toolCalls: ToolCall[];
  uiActions: Array<Record<string, unknown>>;
}

/** Gentle humor steps up to playful's quip rate for a user whose profile says they joke back readily. */
function effectiveHumor(turn: Turn): HumorLevel {
  if (turn.humor === "gentle" && (turn.style?.scores.humor ?? 0) >= STYLE_HUMOR_THRESHOLD) return "playful";
  return turn.humor;
}

function prefersLongVersion(turn: Turn): boolean {
  return (turn.style?.scores.verbosity ?? 0) >= STYLE_VERBOSITY_THRESHOLD;
}

async function tool<T>(turn: Turn, name: string, args: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  let output: T;
  try {
    output = await run();
  } catch (error) {
    turn.toolCalls.push({ name, arguments: args, output: JSON.stringify({ ok: false, error: (error as Error).message }) });
    throw error;
  }
  turn.toolCalls.push({ name, arguments: args, output: JSON.stringify(output ?? { ok: true }) });
  return output;
}

function readState(metadata: Record<string, unknown>): DemoState {
  const raw = (metadata.demo ?? {}) as Partial<DemoState>;
  return {
    awaiting: raw.awaiting ?? null,
    pendingInterest: raw.pendingInterest ?? null,
    pendingRemember: raw.pendingRemember ?? null,
    serious: raw.serious ?? false,
    unclear: raw.unclear ?? 0,
    turns: raw.turns ?? 0,
    usedQuips: Array.isArray(raw.usedQuips) ? raw.usedQuips.filter((q): q is string => typeof q === "string").slice(-30) : [],
  };
}

function withName(turn: Turn, text: string, prefix = ", "): string {
  return turn.name ? `${text}${prefix}${turn.name}` : text;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

async function setName(turn: Turn, name: string): Promise<void> {
  await tool(turn, "set_preferred_name", { name }, async () => {
    await memoryService.setPreferredName(turn.userId, name);
    return { ok: true, name };
  });
  turn.name = name;
  turn.uiActions.push({ type: "name_set", name });
}

async function consent(turn: Turn, scope: "memory" | "sensitive_memory", granted: boolean, evidence: string): Promise<void> {
  await tool(turn, "record_consent", { scope, granted, source: "voice", evidence }, async () => {
    await memoryService.recordConsent(turn.userId, scope, granted, "voice", evidence);
    return { ok: true, scope, granted };
  });
  if (scope === "memory") turn.memoryOn = granted;
}

async function remember(turn: Turn, content: string, userWords: string, userConfirmed: boolean): Promise<memoryService.RememberResult> {
  const shape = inferMemoryShape(content);
  const args = { content, ...shape, userConfirmed, sourceConversationId: turn.conversationId };
  const result = await tool(turn, "remember", args, () =>
    memoryService.rememberMemory(turn.userId, { ...shape, content, userConfirmed, userWords, sourceConversationId: turn.conversationId }),
  );
  if (result.ok) turn.uiActions.push({ type: "memory_saved", memoryId: result.memory.id, content: result.memory.content });
  return result;
}

async function recallFor(turn: Turn, query: string, limit: number): Promise<Memory[]> {
  if (!turn.memoryOn) return [];
  return tool(turn, "recall_memories", { query, limit }, () => memoryService.recallMemories(turn.userId, query, limit));
}

/** "My granddaughter Lily plays the violin" -> "your granddaughter Lily plays the violin" (for speaking back). */
function spoken(content: string): string {
  return lowerFirst(toSecondPerson(content.replace(/[.!?]+$/, "")));
}

// Memory contents are stored as statements ABOUT the user ("Tends a garden; the
// tomatoes are her pride", "Margaret is 78…", or the user's own words "I take my
// coffee black"). To say them back naturally we convert to second person; when
// the heuristics cannot produce a sentence that starts with "you", the brain
// quotes the note instead of mangling it.
const THIRD_PERSON: Array<[RegExp, string]> = [
  [/\b(she|he|they)'s\b/gi, "you're"],
  [/\b(she|he) is\b/gi, "you are"],
  [/\bthey are\b/gi, "you are"],
  [/\b(she|he) was\b/gi, "you were"],
  [/\bthey were\b/gi, "you were"],
  [/\b(she|he|they) ha(s|ve)\b/gi, "you have"],
  [/\b(she|he|they) do(es)?\b/gi, "you do"],
  [/\b(her|his|their)\b/g, "your"],
  [/\b(Her|His|Their)\b/g, "Your"],
  [/\bhers\b/gi, "yours"],
  [/\b(herself|himself|themselves)\b/gi, "yourself"],
  [/\b(she|he|they)\b/gi, "you"],
  [/\b(him|them)\b/gi, "you"],
];

const LEADING_VERBS = new Set([
  "tends", "loves", "likes", "enjoys", "prefers", "takes", "collects", "does", "has", "is", "plays", "goes", "watches",
  "teaches", "lives", "works", "walks", "reads", "listens", "keeps", "grows", "makes", "drinks", "eats", "visits",
  "volunteers", "sings", "paints", "knits", "bakes", "cooks", "gardens", "drives", "follows", "supports", "attends",
  "owns", "raises", "misses", "remembers", "celebrates", "dislikes", "avoids", "needs", "wants", "uses", "wears",
  "sleeps", "gets", "feels", "speaks", "swims", "fishes", "travels", "calls", "writes", "studies", "spends", "wakes",
  "struggles", "worries", "hopes", "plans", "runs", "sees", "talks", "stays", "helps", "cares", "looks", "comes",
]);

const LEADING_NOUNS = new Set([
  "granddaughter", "grandson", "grandchild", "grandchildren", "grandkids", "daughter", "son", "wife", "husband",
  "partner", "sister", "brother", "mother", "father", "mom", "dad", "neighbor", "neighbour", "friend", "friends",
  "dog", "cat", "garden", "church", "doctor", "nurse", "caregiver", "aide", "birthday", "anniversary", "family",
]);

function deconjugate(verb: string): string {
  const v = verb.toLowerCase();
  if (v === "is") return "are";
  if (v === "has") return "have";
  if (v === "does") return "do";
  if (v === "goes") return "go";
  if (/ies$/.test(v)) return v.replace(/ies$/, "y");
  if (/(ches|shes|sses|xes|zes)$/.test(v)) return v.replace(/es$/, "");
  return v.replace(/s$/, "");
}

/**
 * Convert a stored memory into a second-person phrase ("you tend a vegetable
 * garden; the tomatoes are your pride"). Returns `null` when the result would
 * not read as a sentence addressed to the user.
 */
export function memoryToSecondPerson(content: string, name: string | null, category?: MemoryCategory): string | null {
  let out = content.trim().replace(/[.!?]+$/, "");
  if (!out) return null;
  // Memories about other people ("my neighbour's dog … he is a beagle") contain
  // subject pronouns that do NOT refer to the user; only possessives are safe there.
  const aboutOthers = category === "family" || category === "friends" || category === "story";
  if (name) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`^${n}\\s+is\\b`, "i"), "you're")
      .replace(new RegExp(`^${n}\\s+has\\b`, "i"), "you have")
      .replace(new RegExp(`^${n}\\s+was\\b`, "i"), "you were")
      .replace(new RegExp(`\\b${n}'s\\b`, "gi"), "your")
      .replace(new RegExp(`\\b${n}\\b`, "g"), "you");
  }
  out = toSecondPerson(out);
  for (const [re, rep] of THIRD_PERSON) {
    if (aboutOthers && !/\(her\|his\|their\)|\(Her\|His\|Their\)|hers|herself/.test(re.source)) continue;
    out = out.replace(re, rep);
  }
  const words = out.split(/\s+/);
  const token = words[0] ?? "";
  const first = token.toLowerCase().replace(/[^a-z']/g, "");
  const punct = token.slice(first.length); // e.g. ";" in "Widower;"
  const rest = words.slice(1).join(" ");
  const join = (head: string) => `${head}${punct}${rest ? " " + rest : ""}`;
  if (first === "widower" || first === "widow") {
    out = join(`you're a ${first}`);
  } else if (LEADING_VERBS.has(first)) {
    out = join(`you ${deconjugate(first)}`);
  } else if (LEADING_NOUNS.has(first)) {
    out = join(`your ${first}`);
  }
  out = out.replace(/\byou (is|was)\b/g, (_m, v: string) => (v === "is" ? "you are" : "you were"));
  out = out.replace(/^you is\b/, "you're");
  if (!/^you(\b|'re|'ve|'d|'ll)|^your\b/i.test(out)) return null;
  return lowerFirst(out);
}

/** A natural callback to a memory, or a quoted note when conversion is unsafe. */
function memoryCallback(memory: Memory, name: string | null, mode: "mentioned" | "told"): string {
  const phrase = memoryToSecondPerson(memory.content, name, memory.category);
  if (phrase) return mode === "mentioned" ? `you mentioned ${phrase}` : `you told me ${phrase}`;
  const note = memory.content.trim().replace(/[.!?]+$/, "");
  return mode === "mentioned" ? `you shared this with me: "${note}"` : `I kept a note that says: "${note}"`;
}

// ----- onboarding -----------------------------------------------------------

async function greet(turn: Turn): Promise<{ reply: string; next: DemoState }> {
  const next: DemoState = { ...turn.state, turns: (turn.state.turns ?? 0) + 1 };
  if (turn.profile.onboardingStage === "new" || !turn.name) {
    next.awaiting = "name";
    return {
      reply: `Hello there — I'm ${turn.companion}. I'm glad you're here. We can talk about anything you like, and there's no rush at all. First things first: what would you like me to call you?`,
      next,
    };
  }
  if (turn.profile.onboardingStage === "named") {
    next.awaiting = "interest";
    return {
      reply: `Hello, ${turn.name} — I'm ${turn.companion}. It's good to meet you. I'd like to know a little about what you enjoy. What's something that fills a good afternoon for you — a hobby, a show, a pastime of any kind?`,
      next,
    };
  }
  if (turn.profile.onboardingStage === "interests" && !turn.memoryOn) {
    next.awaiting = "memory_consent";
    return {
      reply: `Hello, ${turn.name}, it's ${turn.companion}. One question before we dive in. Would you like me to remember things you tell me between our chats? You can say no, and you can always change your mind.`,
      next,
    };
  }
  const hash = hashText(turn.conversationId);
  const openers = [`Hello again, ${turn.name}. It's ${turn.companion} — good to hear from you.`, `${turn.name}! It's ${turn.companion}. I was hoping you'd stop by.`, `Well, hello, ${turn.name}. ${turn.companion} here.`];
  let reply = pick(openers, hash);
  if (turn.memoryOn) {
    const memories = await recallFor(turn, "", 6);
    if (memories.length > 0) {
      const memory = pick(memories, hash, 3);
      reply += ` I remember ${memoryCallback(memory, turn.name, "mentioned")} — how's that going these days?`;
    } else {
      reply += " What's on your mind today?";
    }
  } else {
    reply += " What's on your mind today?";
  }
  const quip = maybeQuip(reply, turn.humor === "playful" ? "playful" : "off", hash, turn.state.usedQuips);
  if (quip) {
    reply += ` ${quip}`;
    next.usedQuips = [...(turn.state.usedQuips ?? []), quip];
  }
  return { reply, next };
}

async function onboardingName(turn: Turn): Promise<{ reply: string; next: DemoState } | null> {
  const name = parseNameStatement(turn.text, true);
  if (!name) return null;
  await setName(turn, name);
  return {
    reply: `${name} — lovely. It's good to meet you. I'd like to know a little about what you enjoy. What's something that fills a good afternoon for you — a hobby, a show, a pastime of any kind?`,
    next: { ...turn.state, awaiting: "interest" },
  };
}

async function onboardingInterest(turn: Turn): Promise<{ reply: string; next: DemoState }> {
  const skipped = SKIP_RE.test(turn.text);
  await memoryService.updateProfile(turn.userId, { onboardingStage: "interests" });
  const echo = skipped ? null : echoPhrase(turn.text);
  const lead = skipped
    ? "That's alright — it'll come up naturally."
    : echo
      ? `${capitalize(echo)} — that sounds like a good way to spend time.`
      : "That sounds like a good way to spend time.";
  return {
    reply: `${lead} Here's a question before we go on. Would you like me to remember things like that between our chats? You can say no, and you can always change your mind.`,
    next: { ...turn.state, awaiting: "memory_consent", pendingInterest: skipped ? null : turn.text },
  };
}

async function onboardingConsent(turn: Turn): Promise<{ reply: string; next: DemoState } | null> {
  const pending = turn.state.pendingRemember ?? null;
  const rememberNow = parseRememberRequest(turn.text);
  if (isYes(turn.text) || rememberNow) {
    await consent(turn, "memory", true, turn.text);
    let reply = "Thank you — I'll remember the things you share. You can ask me what I've kept, or tell me to forget something, any time.";
    let needsSensitive: DemoState["pendingRemember"] = null;
    for (const item of [pending, rememberNow && rememberNow !== pending?.content ? { content: rememberNow, userWords: turn.text, userConfirmed: true } : null]) {
      if (!item) continue;
      const result = await remember(turn, item.content, item.userWords, item.userConfirmed);
      if (result.ok) reply += ` I've saved that ${spoken(item.content)}.`;
      else if (result.reason === "sensitive_consent_required") needsSensitive = item;
    }
    if (needsSensitive) {
      turn.uiActions.push({ type: "consent_prompt", scope: "sensitive_memory" });
      reply += ` One more thing: what you asked me to keep touches on health, money or grief, which I keep separate. Shall I remember personal things like that too? Yes or no is fine.`;
      return { reply, next: { ...turn.state, awaiting: "sensitive_consent", pendingInterest: null, pendingRemember: needsSensitive, unclear: 0 } };
    }
    if (!pending && !rememberNow && turn.state.pendingInterest) {
      const content = toThirdPersonInterest(turn.state.pendingInterest);
      if (content) {
        const result = await remember(turn, content, turn.state.pendingInterest, false);
        if (result.ok) reply += ` I've made a note that you mentioned ${lowerFirst(content)}.`;
      }
    }
    reply += " So — what's been on your mind lately?";
    return { reply, next: { ...turn.state, awaiting: null, pendingInterest: null, pendingRemember: null, unclear: 0 } };
  }
  if (isNo(turn.text)) {
    await consent(turn, "memory", false, turn.text);
    return {
      reply: "That's completely fine. I won't keep anything between our chats — each time we talk starts fresh. If you ever change your mind, just tell me. So, what shall we talk about?",
      next: { ...turn.state, awaiting: null, pendingInterest: null, pendingRemember: null, unclear: 0 },
    };
  }
  const unclear = (turn.state.unclear ?? 0) + 1;
  if (unclear >= 2) {
    return {
      reply: "No pressure either way — we can come back to it whenever you like. For now I'll keep each chat fresh. What's on your mind?",
      next: { ...turn.state, awaiting: null, unclear: 0 },
    };
  }
  return {
    reply: "No pressure either way. Shall I remember things between our chats — a simple yes or no is plenty — or would you rather I keep each one fresh?",
    next: { ...turn.state, unclear },
  };
}

async function sensitiveConsent(turn: Turn): Promise<{ reply: string; next: DemoState } | null> {
  const pending = turn.state.pendingRemember;
  if (isYes(turn.text)) {
    await consent(turn, "sensitive_memory", true, turn.text);
    let reply = "Alright — I'll keep personal matters like that too, and you can always tell me to forget them.";
    if (pending) {
      const result = await remember(turn, pending.content, pending.userWords, pending.userConfirmed);
      if (result.ok) reply += ` I've saved that ${spoken(pending.content)}.`;
    }
    return { reply: `${reply} How are you doing with all of it?`, next: { ...turn.state, awaiting: null, pendingRemember: null } };
  }
  if (isNo(turn.text)) {
    await consent(turn, "sensitive_memory", false, turn.text);
    return {
      reply: "Understood — I'll leave personal matters like that out of my notes. I'm still glad to talk about them whenever you want to.",
      next: { ...turn.state, awaiting: null, pendingRemember: null },
    };
  }
  return null;
}

/** "I love my garden" -> "Enjoys their garden" style note; null when nothing worth noting. */
export function toThirdPersonInterest(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim().replace(FILLER_RE, "").replace(/[.!?]+$/, "");
  if (extractKeywords(cleaned).length === 0) return null;
  let out = cleaned
    .replace(/^(i really |i do |i )?(love|enjoy|like|adore) (to )?/i, "Enjoys ")
    .replace(/^(i'?m|i am) (into|fond of|keen on) /i, "Is fond of ")
    .replace(/^my /i, "Their ");
  out = out.replace(/\bmy\b/gi, "their").replace(/\bI\b/g, "they").replace(/\bI'm\b/g, "they're").replace(/\bme\b/gi, "them");
  if (!/^(Enjoys|Is fond of|Their)/.test(out)) out = `Mentioned ${lowerFirst(out)}`;
  return out.length > 300 ? `${out.slice(0, 297)}...` : out;
}

// ----- serious / emergency ---------------------------------------------------

const SERIOUS_REPLIES: Record<SeriousKind, { warmth: string; suggestion: string; question: string }> = {
  grief: {
    warmth: "I'm so sorry. That's a heavy thing to carry, and there's no right way to do it.",
    suggestion: "If there's a friend or someone in the family who'd sit with you today, this might be the day to call them.",
    question: "Would you like to tell me about them? I'm glad to listen for as long as you want.",
  },
  health: {
    warmth: "That sounds hard, and I'm glad you told me.",
    suggestion: "I'm not a doctor, so for anything that worries you, your doctor or a nurse line is the right call — and I'm happy to keep you company meanwhile.",
    question: "How are you feeling right now, this minute?",
  },
  mood: {
    warmth: "Thank you for saying that out loud. I'm here, and I'm listening.",
    suggestion: "Is there someone — a friend, a neighbor, family — you could reach out to today? A real voice helps more than I can.",
    question: "What's been the hardest part lately?",
  },
  money: {
    warmth: "Money worries have a way of sitting on top of everything else.",
    suggestion: "It might help to talk it through with someone you trust, or your local Area Agency on Aging — they often know about help people don't realize they qualify for.",
    question: "What's the most pressing piece of it?",
  },
};

function seriousReply(turn: Turn, kind: SeriousKind): string {
  const t = SERIOUS_REPLIES[kind];
  const warmth = turn.name && turn.hash % 2 === 0 ? t.warmth.replace(/^(I'm so sorry)\./, `$1, ${turn.name}.`) : t.warmth;
  return `${warmth} ${t.suggestion} ${t.question}`;
}

function emergencyReply(kind: "emergency" | "crisis"): string {
  if (kind === "crisis") {
    return "I'm really glad you told me. If you're thinking about hurting yourself, please call or text 988 right now — the Suicide and Crisis Lifeline in the US — or your local crisis line. You deserve a real person beside you in this. I'm here too, and I'm not going anywhere.";
  }
  return "If that's happening right now, please call 911 — or your local emergency number — before anything else. Put the phone on speaker if that's easier. I'll be right here when you're ready.";
}

// ----- main -----------------------------------------------------------------

export async function runDemoTurn(userId: string, conversationId: string, rawText: string): Promise<DemoTurnResponse> {
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) throw new HttpError(404, "conversation_not_found", "That conversation could not be found.");
  if (conversation.mode !== "demo") throw new HttpError(400, "not_demo_conversation", "The demo brain only runs demo-mode conversations.");
  if (conversation.status !== "active") throw new HttpError(409, "conversation_ended", "This conversation has ended. Start a new one.");

  const text = rawText.replace(/\s+/g, " ").trim();
  const [profile, prefs, memoryOn] = await Promise.all([
    memoryService.getProfile(userId),
    memoryService.getPreferences(userId),
    memoryService.isMemoryEnabled(userId),
  ]);
  // The style profile is memory-covered data: only read it when memory is on.
  const style = memoryOn ? ((await getPersonalityProfile(userId))?.traits ?? null) : null;
  const state = readState(conversation.metadata);
  const turn: Turn = {
    userId,
    conversationId,
    text,
    hash: hashText(text),
    profile,
    prefs,
    memoryOn,
    state,
    companion: COMPANION_VOICES[profile.companionVoice].label,
    name: profile.preferredName,
    humor: state.serious ? "off" : prefs.humorLevel,
    style,
    tone: null,
    toolCalls: [],
    uiActions: [],
  };

  const isGreeting = text === GREETING_INPUT || text === "";
  if (!isGreeting) {
    const message = await appendMessage({ userId, conversationId, role: "user", content: text });
    // Channels 2 and 3 from the words alone (demo mode has no audio to listen to).
    turn.tone = classifyTone(text);
    if (memoryOn) {
      try {
        await insertToneEvent(userId, {
          conversationId,
          messageId: message.id,
          tone: turn.tone.tone,
          intensity: turn.tone.intensity,
          intent: turn.tone.intent,
          cue: turn.tone.cue,
          source: "heuristic",
        });
      } catch (error) {
        logWarn("tone_event_not_stored", { error: (error as Error).message });
      }
    }
  }

  const { reply, next } = isGreeting ? await greet(turn) : await respond(turn);

  // A notable tone shows up in the transcript the way the live model's observe_tone call would.
  if (turn.tone && isNotableTone(turn.tone)) {
    turn.toolCalls.push({
      name: "observe_tone",
      arguments: { tone: turn.tone.tone, intensity: turn.tone.intensity, intent: turn.tone.intent, serious: DISTRESS_TONES.has(turn.tone.tone) },
      output: JSON.stringify({ ok: true, stored: memoryOn, source: "heuristic" }),
    });
  }

  for (const call of turn.toolCalls) {
    await appendMessage({ userId, conversationId, role: "tool", content: call.output, toolName: call.name, toolPayload: { arguments: call.arguments, output: call.output } });
  }
  await appendMessage({ userId, conversationId, role: "assistant", content: reply });
  await mergeConversationMetadata(userId, conversationId, { demo: { ...next, turns: (state.turns ?? 0) + 1 }, simulated: true });

  return { reply, toolCalls: turn.toolCalls, uiActions: turn.uiActions, simulated: true };
}

async function respond(turn: Turn): Promise<{ reply: string; next: DemoState }> {
  const { text, state } = turn;
  const base: DemoState = { ...state };

  // 1. Safety first: emergencies and crisis language override everything.
  const emergency = detectEmergency(text);
  if (emergency) {
    turn.humor = "off";
    return { reply: emergencyReply(emergency), next: { ...base, serious: true, awaiting: null } };
  }
  const serious = detectSerious(text);
  if (serious) {
    turn.humor = "off";
    return { reply: seriousReply(turn, serious), next: { ...base, serious: true, awaiting: null } };
  }
  // 1b. Channel 2 (tone, from the words): clear distress takes the serious path —
  //     humor off for the rest of the conversation, warmth first. Commands still run.
  const tone = turn.tone;
  const distressed = tone !== null && DISTRESS_TONES.has(tone.tone) && tone.intensity >= NOTABLE_INTENSITY;
  if (distressed) {
    turn.humor = "off";
    base.serious = true;
  }

  // 2. Onboarding (new profile) — a name question is pending even if the user typed first.
  if (state.awaiting === "name" || (turn.profile.onboardingStage === "new" && !turn.name)) {
    const handled = await onboardingName(turn);
    if (handled) return handled;
    if (state.awaiting !== "name") {
      return { reply: `Before we go further — I'm ${turn.companion}, by the way. What would you like me to call you?`, next: { ...base, awaiting: "name" } };
    }
    // Fall through: treat as a normal turn but keep asking next time.
  }
  if (state.awaiting === "interest") {
    const command = parseRememberRequest(text) || isRecallRequest(text) || parseHumorCommand(text, turn.prefs.humorLevel);
    if (!command) return onboardingInterest(turn);
  }
  if (state.awaiting === "memory_consent") {
    const handled = await onboardingConsent(turn);
    if (handled) return handled;
  }
  if (state.awaiting === "sensitive_consent") {
    const handled = await sensitiveConsent(turn);
    if (handled) return handled;
    base.awaiting = null;
    base.pendingRemember = null;
  }
  const carry = state.awaiting === "name" || state.awaiting === "interest" ? state.awaiting : null;
  const next: DemoState = { ...base, awaiting: carry, unclear: 0 };
  if (turn.profile.onboardingStage === "memory_decided") {
    await memoryService.updateProfile(turn.userId, { onboardingStage: "complete" });
  }

  // 3. Explicit commands.
  const humorLevel = parseHumorCommand(text, turn.prefs.humorLevel);
  if (humorLevel) {
    await tool(turn, "set_humor_level", { level: humorLevel }, async () => {
      await memoryService.setHumorLevel(turn.userId, humorLevel);
      return { ok: true, level: humorLevel };
    });
    turn.uiActions.push({ type: "humor_changed", level: humorLevel });
    const replies: Record<HumorLevel, string> = {
      off: "Understood — no more jokes from me. Just good conversation.",
      gentle: "Alright, I'll keep it light — the occasional smile, nothing more.",
      playful: "You've got it — I'll let a few more jokes through.",
    };
    return { reply: replies[humorLevel], next };
  }

  if (isRecallRequest(text)) {
    if (!turn.memoryOn) {
      return {
        reply: "I don't have anything saved about you — memory is turned off, so each chat starts fresh. If you'd like me to start remembering, just say so.",
        next,
      };
    }
    const memories = await recallFor(turn, "", 8);
    if (memories.length === 0) return { reply: "Honestly, nothing yet — I haven't saved anything about you. Tell me something worth keeping and I will.", next };
    const confirmed = memories.filter((m) => m.status === "confirmed").map((m) => spoken(m.content));
    const mentioned = memories.filter((m) => m.status !== "confirmed").map((m) => spoken(m.content));
    let reply = "Here's what I have.";
    if (confirmed.length) reply += ` You asked me to remember that ${joinList(confirmed)}.`;
    if (mentioned.length) reply += ` You've also mentioned that ${joinList(mentioned)} — I haven't treated those as certain.`;
    reply += " Say the word if any of it should go.";
    return { reply, next };
  }

  const forget = parseForgetRequest(text);
  if (forget === "never_mind") return { reply: "Alright — consider it dropped. What else is on your mind?", next };
  if (forget) {
    const result = await tool(turn, "forget", { text: forget.content }, () => memoryService.forgetMemory(turn.userId, { text: forget.content }));
    for (const memory of result.deleted) turn.uiActions.push({ type: "memory_deleted", memoryId: memory.id });
    if (result.deleted.length === 0) {
      return { reply: "I looked, and I don't have anything saved that matches that — so there's nothing to forget. Anything else?", next };
    }
    return {
      reply: result.deleted.length === 1 ? "Done — I've forgotten that, and I won't bring it up again." : `Done — I've forgotten those ${result.deleted.length} things, and I won't bring them up again.`,
      next,
    };
  }

  const rememberContent = parseRememberRequest(text);
  if (rememberContent) {
    if (!turn.memoryOn) {
      turn.uiActions.push({ type: "consent_prompt", scope: "memory" });
      return {
        reply: "I'd be glad to remember that — but I don't have your permission to keep things between our chats yet. Would you like me to remember things like this? You can say yes or no.",
        next: { ...next, awaiting: "memory_consent", pendingRemember: { content: rememberContent, userWords: text, userConfirmed: true } },
      };
    }
    const result = await remember(turn, rememberContent, text, true);
    if (result.ok) {
      const ack = pick(["Got it", "Noted", "Saved", "I'll remember that"], turn.hash);
      // Honest about the override: an explicit "remember" supersedes an earlier "forget".
      const superseded = result.retiredTombstones ? " You'd asked me to forget something like this before; since you've asked again, I've kept this version." : "";
      return { reply: `${ack} — ${spoken(result.memory.content)}.${superseded} ${pick(["Anything else I should know about that?", "Tell me more about it, if you like.", "What else is going on?"], turn.hash, 1)}`, next };
    }
    if (result.reason === "sensitive_consent_required") {
      turn.uiActions.push({ type: "consent_prompt", scope: "sensitive_memory" });
      return {
        reply: "That's a personal matter, and I keep health, money and grief separate from everything else. I'd need your okay to store it — shall I remember personal things like this too? Yes or no is fine.",
        next: { ...next, awaiting: "sensitive_consent", pendingRemember: { content: rememberContent, userWords: text, userConfirmed: true } },
      };
    }
    if (result.reason === "duplicate") return { reply: "I already have that one saved — no need to tell me twice, though I don't mind hearing it. What else?", next };
    if (result.reason === "tombstoned") {
      return { reply: "You asked me earlier to forget something very like that, so I've left it out rather than guess. If you'd like me to keep it after all, you can add it on your memory page.", next };
    }
    turn.uiActions.push({ type: "consent_prompt", scope: "memory" });
    return { reply: "I can't save that just now — memory is switched off. Would you like me to turn it on?", next: { ...next, awaiting: "memory_consent", pendingRemember: { content: rememberContent, userWords: text, userConfirmed: true } } };
  }

  const explicitName = parseNameStatement(text, false);
  if (explicitName && explicitName !== turn.name) {
    await setName(turn, explicitName);
    return { reply: `${explicitName} it is. ${pick(["Thanks for telling me.", "I like it.", "Noted — properly, this time."], turn.hash)} What's on your mind?`, next };
  }

  if (FAREWELL_RE.test(text)) {
    turn.uiActions.push({ type: "end_conversation" });
    return { reply: withName(turn, "It was good talking with you") + ". I'll be here whenever you want to pick it up again. Take care.", next };
  }

  // 3b. Tone-driven replies (inferred from words). Distress: acknowledge, slow down,
  //     one gentle question. Fatigue: offer to wrap up. Confusion: shorter and plainer.
  if (distressed && tone && (tone.tone === "frustration" || tone.tone === "upset" || tone.tone === "anxiety")) {
    return { reply: pick(TONE_REPLIES[tone.tone], turn.hash), next };
  }
  if (tone?.tone === "fatigue" && tone.intensity >= NOTABLE_INTENSITY) {
    return { reply: pick(FATIGUE_REPLIES, turn.hash), next };
  }
  if (tone?.tone === "confusion" && tone.intensity >= NOTABLE_INTENSITY) {
    return { reply: pick(CONFUSION_REPLIES, turn.hash), next };
  }

  // 4. Gentle disagreement with common falsehoods.
  const falsehood = detectFalsehood(text);
  if (falsehood) {
    return { reply: `${falsehood.reply} ${pick(["Anyway — what brought that up?", "What made you think of it?", "Where did you come across that one?"], turn.hash)}`, next };
  }

  // 5. Small talk.
  if (THANKS_RE.test(text)) return { reply: `${pick(["You're very welcome.", "Any time.", "My pleasure."], turn.hash)} What else is on your mind?`, next };
  if (HOW_ARE_YOU_RE.test(text)) {
    const quip = maybeQuip("how are you", effectiveHumor(turn), turn.hash, turn.state.usedQuips);
    if (quip) next.usedQuips = [...(turn.state.usedQuips ?? []), quip];
    return { reply: `I'm well, thank you${quip ? ` — ${lowerFirst(quip)}` : ""}. More to the point, how are you doing today?`, next };
  }
  if (HELLO_RE.test(text)) return { reply: `${withName(turn, "Hello")}! Good to hear from you. What's on your mind today?`, next };

  // 6. Reflective reply, with a memory callback when a saved memory is relevant.
  const reflected = await reflect(turn);
  if (reflected.quip) next.usedQuips = [...(turn.state.usedQuips ?? []), reflected.quip];
  return { reply: reflected.reply, next };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]}, and ${items[1]}`;
  return `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}`;
}

async function reflect(turn: Turn): Promise<{ reply: string; quip: string }> {
  const { text, hash } = turn;
  const parts: string[] = [];

  if (turn.memoryOn && extractKeywords(text).length > 0 && hash % 2 === 0) {
    const related = await recallFor(turn, text, 1);
    if (related[0] && normalizeText(related[0].content) !== normalizeText(text)) {
      parts.push(`That reminds me — ${memoryCallback(related[0], turn.name, "told")}.`);
    }
  }

  const longVersion = prefersLongVersion(turn);
  const phrase = echoPhrase(text);
  if (phrase) {
    const useName = turn.name && hash % 4 === 0;
    const template = useName ? pick(REFLECT_WITH_NAME, hash) : pick(longVersion ? REFLECT_WITH_PHRASE_LONG : REFLECT_WITH_PHRASE, hash);
    parts.push(template.replace("{P}", phrase).replace("{PC}", capitalize(phrase)).replace("{N}", turn.name ?? ""));
  } else {
    parts.push(pick(longVersion ? REFLECT_PLAIN_LONG : REFLECT_PLAIN, hash));
  }

  const quip = maybeQuip(text, effectiveHumor(turn), hash, turn.state.usedQuips);
  if (quip) parts.splice(parts.length - 1, 0, quip);
  return { reply: parts.join(" "), quip };
}
