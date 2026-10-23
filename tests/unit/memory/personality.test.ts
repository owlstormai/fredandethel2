import { describe, expect, it } from "vitest";
import {
  analysisConfidence,
  analyzeStyleHeuristic,
  coerceTraits,
  describeStyleForPrompt,
  describeStyleForUser,
  emptyTraits,
  MAX_NOTES,
  MAX_PHRASES,
  MAX_TOPICS,
  mergeStyleProfile,
  MIN_EVIDENCE_FOR_PROMPT,
  paceFromScores,
  PROMPT_BLOCK_MAX_CHARS,
} from "@/lib/memory/personality";
import type { StyleProfileTraits } from "@/lib/types";

const JOKEY = [
  "Haha, well my garden is mostly weeds with ambitions, but the tomatoes don't know that yet!",
  "I told my grandson I'm a fossil and he asked which museum I'm in. Kidding — he's a sweet kid, haha.",
  "Baseball tonight! The Guardians will break my heart again, but that's the fun of it, isn't it?",
  "No pun intended, but my knees are the real weeds in this garden. Lol.",
  "I love a good crossword — seven letters for 'stubborn old man'? Me, haha!",
  "Thanks, dear. You're funnier than my brother-in-law, and he thinks he's a comedian!",
  "The tomatoes are coming in, the garden is a jungle, and I'm the only explorer. Ha!",
  "Isn't it funny how the weeds grow faster than anything I actually plant?",
];

const TERSE_FORMAL = [
  "Good afternoon. I would like the weather forecast for tomorrow, please.",
  "Thank you. That will be all for now.",
  "No. That is not correct. The game is on Thursday.",
  "Please tell me the time of the appointment.",
  "I see. Thank you kindly.",
  "Regarding the forecast, is rain expected on Friday?",
];

const STORYTELLER = [
  "I remember back when we lived on Euclid Avenue, my father used to take us down to the lake every Sunday after church, and then we would stop at the bakery on the corner for rolls, and eventually my mother would scold us for eating them before dinner.",
  "When I was a boy, years ago, the whole street came out for the Fourth of July, and the fire department brought the old truck, and then the kids all climbed on it, and finally somebody always fell off and cried.",
  "In those days we didn't have much, but one time my grandfather built a sled from an old door, and we rode it down the hill behind the school until the door finally gave out, and then he built another one the next week.",
  "Back in nineteen fifty-two I started at the tool-and-die shop; the foreman was a hard man, but he taught me to measure twice, and after that I never cut a bad piece, not once in forty years.",
];

describe("analyzeStyleHeuristic", () => {
  it("reads a jokey, casual, warm sample as high humor / low formality with humor styles and topics", () => {
    const { traits, confidence } = analyzeStyleHeuristic(JOKEY);
    expect(traits.scores.humor).toBeGreaterThan(0.8);
    expect(traits.scores.formality).toBeLessThan(0.4);
    expect(traits.scores.warmth).toBeGreaterThan(0.5);
    expect(traits.scores.curiosity).toBeGreaterThanOrEqual(0.5);
    expect(traits.humorStyle).toEqual(expect.arrayContaining(["wordplay", "self-deprecating"]));
    expect(traits.humorStyle).not.toContain("none");
    expect(traits.topics.join(" ")).toMatch(/garden/);
    expect(traits.topics.join(" ")).toMatch(/tomato/);
    expect(traits.topics.length).toBeLessThanOrEqual(MAX_TOPICS);
    expect(traits.notes).toContain("Jokes back readily");
    expect(traits.notes.length).toBeLessThanOrEqual(MAX_NOTES);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThan(0.3);
  });

  it("reads a terse, formal sample as no humor / high formality / short turns", () => {
    const { traits } = analyzeStyleHeuristic(TERSE_FORMAL);
    expect(traits.scores.humor).toBe(0);
    expect(traits.scores.formality).toBeGreaterThan(0.7);
    expect(traits.scores.verbosity).toBeLessThanOrEqual(0.3);
    expect(traits.humorStyle).toEqual(["none"]);
    expect(traits.notes).toContain("Formal register");
    expect(traits.notes).toContain("Rarely jokes");
  });

  it("reads long past-tense narratives as storytelling at an unhurried pace", () => {
    const { traits } = analyzeStyleHeuristic(STORYTELLER);
    expect(traits.scores.storytelling).toBeGreaterThanOrEqual(0.8);
    expect(traits.scores.verbosity).toBeGreaterThanOrEqual(0.7);
    expect(traits.pace).toBe("unhurried");
    expect(traits.notes).toContain("Tells long stories; likes the whole version");
  });

  it("finds repeated 2–3-grams as signature expressions, skipping stopword-only and determiner-led grams", () => {
    const { traits } = analyzeStyleHeuristic([
      "Oh my goodness, the tomatoes again! Oh my goodness.",
      "Bless your heart, that's kind. Bless your heart.",
      "Well I tell you what, oh my goodness, what a day.",
      "Bless your heart, you remembered.",
    ]);
    expect(traits.phrases).toEqual(["bless your heart", "oh my goodness"]);
    expect(traits.phrases.length).toBeLessThanOrEqual(MAX_PHRASES);
    expect(analyzeStyleHeuristic(JOKEY).traits.phrases).not.toContain("hes a");
  });

  it("never lists health, money or grief words as favourite topics", () => {
    const { traits } = analyzeStyleHeuristic([
      "The doctor changed my blood pressure pills again and the pharmacy lost the prescription.",
      "My pension barely covers the bills and the bank keeps calling about the mortgage.",
      "Since the funeral I mostly sit in the garden and watch the tomatoes.",
      "The garden keeps me going, honestly, the tomatoes and the roses.",
    ]);
    expect(traits.topics.join(" ")).toMatch(/garden|tomato/);
    expect(traits.topics.join(" ")).not.toMatch(/doctor|pills|pension|bank|mortgage|funeral|prescription/);
  });

  it("is deterministic and handles empty input", () => {
    expect(analyzeStyleHeuristic(JOKEY)).toEqual(analyzeStyleHeuristic([...JOKEY]));
    expect(analyzeStyleHeuristic([])).toEqual({ traits: emptyTraits(), confidence: 0 });
    expect(analyzeStyleHeuristic(["   "]).confidence).toBe(0);
  });

  it("confidence is 0 below 3 messages and ~1 from 40", () => {
    expect(analysisConfidence(0)).toBe(0);
    expect(analysisConfidence(2)).toBe(0);
    expect(analysisConfidence(3)).toBeGreaterThan(0);
    expect(analysisConfidence(3)).toBeLessThan(0.1);
    expect(analysisConfidence(21)).toBeCloseTo(0.5, 1);
    expect(analysisConfidence(40)).toBe(1);
    expect(analysisConfidence(400)).toBe(1);
  });
});

describe("mergeStyleProfile", () => {
  const jokey = analyzeStyleHeuristic(JOKEY).traits;
  const terse = analyzeStyleHeuristic(TERSE_FORMAL).traits;

  it("takes the first observation as-is when nothing exists yet", () => {
    const merged = mergeStyleProfile(null, jokey, 0.1);
    expect(merged.scores).toEqual(jokey.scores);
    expect(merged.topics).toEqual(jokey.topics);
  });

  it("moves scores by an exponential moving average and never lets one conversation flip the profile", () => {
    const quarter = mergeStyleProfile(jokey, terse, 0.25);
    expect(quarter.scores.humor).toBeCloseTo(jokey.scores.humor * 0.75 + terse.scores.humor * 0.25, 2);
    expect(quarter.scores.formality).toBeCloseTo(jokey.scores.formality * 0.75 + terse.scores.formality * 0.25, 2);
    // Weight is capped at 0.5: even a "weight 1" observation only moves half way.
    const capped = mergeStyleProfile(jokey, terse, 1);
    expect(capped.scores.humor).toBeCloseTo(jokey.scores.humor * 0.5, 2);
    expect(capped.scores.humor).toBeGreaterThanOrEqual(0.5);
    expect(mergeStyleProfile(jokey, terse, 0).scores).toEqual(jokey.scores);
  });

  it("unions topics / phrases / humor styles with the newest first under a cap, and replaces notes", () => {
    const existing: StyleProfileTraits = {
      ...jokey,
      topics: ["baseball", "jazz", "woodwork", "coffee", "dogs", "books", "pie", "weather"],
      phrases: ["you bet", "oh boy"],
      humorStyle: ["dry"],
      notes: ["old note"],
    };
    const observation: StyleProfileTraits = { ...terse, topics: ["garden", "tomatoes"], phrases: ["bless your heart"], humorStyle: ["wordplay", "playful"], notes: ["new note"] };
    const merged = mergeStyleProfile(existing, observation, 0.3);
    expect(merged.topics.slice(0, 2)).toEqual(["garden", "tomatoes"]);
    expect(merged.topics).toHaveLength(MAX_TOPICS);
    expect(merged.topics).not.toContain("weather");
    expect(merged.phrases).toEqual(["bless your heart", "you bet", "oh boy"]);
    expect(merged.humorStyle).toEqual(["wordplay", "playful", "dry"]);
    expect(merged.notes).toEqual(["new note"]);
    expect(merged.pace).toBe(paceFromScores(merged.scores));
  });

  it("drops 'none' from the humor styles once a real style is seen, and keeps tone/intent distributions", () => {
    const withNone: StyleProfileTraits = { ...terse, humorStyle: ["none"], tones: { neutral: 1 }, intents: { small_talk: 1 } };
    const merged = mergeStyleProfile(withNone, { ...jokey, humorStyle: ["dry"] }, 0.2);
    expect(merged.humorStyle).toEqual(["dry"]);
    expect(merged.tones).toEqual({ neutral: 1 });
    expect(mergeStyleProfile(withNone, { ...jokey, tones: { joy: 0.6, neutral: 0.4 } }, 0.2).tones).toEqual({ joy: 0.6, neutral: 0.4 });
  });
});

describe("describeStyleForPrompt", () => {
  const jokey = analyzeStyleHeuristic(JOKEY).traits;

  it("returns nothing until the profile rests on enough messages", () => {
    expect(describeStyleForPrompt({ traits: jokey, evidenceMessages: MIN_EVIDENCE_FOR_PROMPT - 1 })).toBe("");
    expect(describeStyleForPrompt({ traits: jokey, evidenceMessages: MIN_EVIDENCE_FOR_PROMPT })).not.toBe("");
  });

  it("describes a jokey user in plain English, says it is inferred from words, and stays within ~120 tokens", () => {
    const text = describeStyleForPrompt({ traits: jokey, evidenceMessages: 20 });
    expect(text).toMatch(/^How they like to talk \(inferred from their words, not their voice\): /);
    expect(text).toContain("They joke back readily (playful, wordplay); match it when humor is on.");
    expect(text).toContain("They ask a lot of questions; answer briefly, then return one.");
    expect(text).toContain("They are casual; plain, relaxed language suits them.");
    expect(text).toMatch(/Favorite topics: .*garden/);
    expect(text.length).toBeLessThanOrEqual(PROMPT_BLOCK_MAX_CHARS);
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(130);
  });

  it("adds one sentence for a dominant tone and one for a dominant intent", () => {
    const traits: StyleProfileTraits = { ...jokey, tones: { frustration: 0.5, neutral: 0.5 }, intents: { venting: 0.6, small_talk: 0.4 } };
    const text = describeStyleForPrompt({ traits, evidenceMessages: 20 });
    expect(text).toContain("They are often frustrated when they arrive; be patient, concrete and brief.");
    expect(text).toContain("They often come to vent rather than to be fixed; listen first.");
    const even: StyleProfileTraits = { ...jokey, tones: { neutral: 0.9, joy: 0.1 }, intents: { small_talk: 0.2, venting: 0.2 } };
    expect(describeStyleForPrompt({ traits: even, evidenceMessages: 20 })).not.toMatch(/often come|when they arrive/);
  });

  it("describes a terse formal user as rarely joking, short turns, formal register", () => {
    const text = describeStyleForPrompt({ traits: analyzeStyleHeuristic(TERSE_FORMAL).traits, evidenceMessages: 12 });
    expect(text).toContain("They rarely joke; keep humor light and infrequent.");
    expect(text).toContain("They speak in short turns; keep your replies short too.");
    expect(text).toContain("They keep a formal register; mirror it lightly.");
  });
});

describe("describeStyleForUser", () => {
  it("produces plain second-person rows for the memory page", () => {
    const rows = describeStyleForUser({ traits: analyzeStyleHeuristic(JOKEY).traits });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel.Humor).toMatch(/^You joke often, mostly playful and wordplay/);
    expect(byLabel.Register).toBe("Relaxed and casual");
    expect(byLabel.Questions).toBe("You ask a lot of questions");
    expect(byLabel["Favorite topics"]).toMatch(/garden/);
    expect(byLabel["How you usually sound"]).toBeUndefined(); // no tone data yet
  });

  it("adds 'How you usually sound' and 'What you usually come for' from tone/intent frequencies", () => {
    const traits: StyleProfileTraits = {
      ...analyzeStyleHeuristic(TERSE_FORMAL).traits,
      tones: { joy: 0.55, frustration: 0.2, neutral: 0.25 },
      intents: { reminiscing: 0.5, seeking_information: 0.3, small_talk: 0.2 },
    };
    const byLabel = Object.fromEntries(describeStyleForUser({ traits }).map((r) => [r.label, r.value]));
    expect(byLabel.Humor).toBe("You rarely joke");
    expect(byLabel["How you usually sound"]).toBe("Often cheerful (most of the time), sometimes frustrated");
    expect(byLabel["What you usually come for"]).toBe("To reminisce and to ask questions");
    const even = describeStyleForUser({ traits: { ...traits, tones: { neutral: 1 } } });
    expect(even.find((r) => r.label === "How you usually sound")?.value).toBe("Fairly even — nothing stood out");
  });
});

describe("coerceTraits", () => {
  it("fills gaps, clamps scores and drops junk from a stored jsonb value", () => {
    const traits = coerceTraits({ scores: { humor: 7, energy: -1, formality: "x" }, humorStyle: ["dry", "loud"], topics: ["garden", 3, ""], pace: "sideways", tones: { joy: 0.5, bogus: 1 }, intents: "nope" });
    expect(traits.scores.humor).toBe(1);
    expect(traits.scores.energy).toBe(0);
    expect(traits.scores.formality).toBe(0.5);
    expect(traits.humorStyle).toEqual(["dry"]);
    expect(traits.topics).toEqual(["garden"]);
    expect(traits.pace).toBe(paceFromScores(traits.scores));
    expect(traits.tones).toEqual({ joy: 0.5 });
    expect(traits.intents).toBeUndefined();
    expect(coerceTraits(null)).toEqual(emptyTraits());
    expect(coerceTraits("garbage")).toEqual(emptyTraits());
  });
});
