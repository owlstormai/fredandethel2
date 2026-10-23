import { describe, expect, it } from "vitest";
import { classifyTone, describeFeel, dominantIntent, dominantTone, INTENTS, isNotableTone, TONES, toneDistribution } from "@/lib/memory/tone";
import type { Intent, Tone } from "@/lib/types";

describe("classifyTone — tones (lexical cues only, never audio)", () => {
  const samples: Array<[string, Tone, number]> = [
    ["ugh, this remote is so frustrating, nothing works", "frustration", 0.6],
    ["I'm tired of this nonsense", "frustration", 0.6],
    ["Haha, that was a good one. I'm just kidding, of course.", "humor", 0.6],
    ["I miss her so much some days. I still cry at the kitchen table.", "upset", 0.6],
    ["My sister passed away last week and I can't stop thinking about it", "upset", 0.6],
    ["I'm worried about the test results, what if it's bad news?", "anxiety", 0.6],
    ["I don't understand, what do you mean by that?", "confusion", 0.6],
    ["I'm so tired today, exhausted really.", "fatigue", 0.6],
    ["What a lovely day! Wonderful, just wonderful.", "joy", 0.6],
    ["Thank you, dear, that's very kind of you.", "warmth", 0.45],
  ];
  it.each(samples)("%s → %s", (text, tone, minIntensity) => {
    const result = classifyTone(text);
    expect(result.tone).toBe(tone);
    expect(result.intensity).toBeGreaterThanOrEqual(minIntensity);
    expect(result.intensity).toBeLessThanOrEqual(1);
    expect(result.cue).not.toBeNull();
    expect((result.cue ?? "").length).toBeLessThanOrEqual(200);
  });

  it("is neutral for ordinary statements and for humor commands", () => {
    for (const text of ["You can call me Peg", "I spent the whole morning in my garden pulling weeds and the tomatoes are finally coming in.", "less joking please", "no more jokes", "I love working in my garden"]) {
      const result = classifyTone(text);
      expect(result.tone, text).toBe("neutral");
      expect(result.intensity).toBe(0);
      expect(result.cue).toBeNull();
    }
  });

  it("more cues and exclamation marks raise the intensity, capped at 1", () => {
    expect(classifyTone("ugh").intensity).toBeLessThan(classifyTone("ugh, this remote is so frustrating, nothing works").intensity);
    expect(classifyTone("Wonderful!!! Lovely! Fantastic! Delighted!").intensity).toBeLessThanOrEqual(1);
    expect(classifyTone("UGH THIS STUPID PHONE never works").intensity).toBeGreaterThan(classifyTone("ugh this phone never works").intensity);
  });

  it("notability: non-neutral at or above 0.5", () => {
    expect(isNotableTone(classifyTone("ugh, nothing works"))).toBe(true);
    expect(isNotableTone(classifyTone("Not now, thanks"))).toBe(false); // warmth 0.45
    expect(isNotableTone(classifyTone("You can call me Peg"))).toBe(false);
  });

  it("is deterministic", () => {
    const text = "Haha, I'm worried about nothing, really — what do you mean?";
    expect(classifyTone(text)).toEqual(classifyTone(text));
  });
});

describe("classifyTone — intents", () => {
  const samples: Array<[string, Intent]> = [
    ["Can you tell me what the weather is tomorrow?", "seeking_information"],
    ["How do I get the photos off this phone? Help me with it.", "asking_for_help"],
    ["Do you think I was wrong to say that to her? Is it okay?", "seeking_reassurance"],
    ["Remember when we used to dance at the Aragon back then, years ago?", "reminiscing"],
    ["I'm planning to drive out to see my son next week.", "planning"],
    ["Good morning! Nice day out there.", "small_talk"],
    ["I just need to say it: I'm so fed up with the pharmacy.", "venting"],
    ["ugh, this remote is so frustrating, nothing works", "venting"],
    ["Haha, that was a good one. I'm just kidding, of course.", "joking"],
    ["I just wanted to talk to someone, it's quiet here.", "wanting_company"],
    ["You can call me Peg", "wanting_company"],
  ];
  it.each(samples)("%s → %s", (text, intent) => {
    expect(classifyTone(text).intent).toBe(intent);
  });

  it("every tone and intent value is one the tool schema accepts", () => {
    for (const [text] of [["ugh"], ["haha"], ["hello"], ["what time is it?"]]) {
      const r = classifyTone(text);
      expect(TONES).toContain(r.tone);
      expect(INTENTS).toContain(r.intent);
    }
  });
});

describe("aggregation", () => {
  const events = [
    { tone: "joy" as Tone, intent: "reminiscing" as Intent },
    { tone: "joy" as Tone, intent: "reminiscing" as Intent },
    { tone: "neutral" as Tone, intent: "small_talk" as Intent },
    { tone: "frustration" as Tone, intent: null },
  ];

  it("normalises tone and intent frequencies", () => {
    const d = toneDistribution(events);
    expect(d.count).toBe(4);
    expect(d.tones).toEqual({ joy: 0.5, neutral: 0.25, frustration: 0.25 });
    expect(d.intents).toEqual({ reminiscing: 0.67, small_talk: 0.33 });
    expect(toneDistribution([])).toEqual({ tones: {}, intents: {}, count: 0 });
  });

  it("finds a dominant non-neutral tone and a dominant intent above a share", () => {
    expect(dominantTone({ neutral: 0.9, joy: 0.1 })).toBeNull();
    expect(dominantTone({ neutral: 0.5, frustration: 0.5 })).toEqual({ tone: "frustration", share: 0.5 });
    expect(dominantIntent({ venting: 0.6, small_talk: 0.4 })).toEqual({ intent: "venting", share: 0.6 });
    expect(dominantIntent({ venting: 0.2, small_talk: 0.2 })).toBeNull();
    expect(dominantTone(undefined)).toBeNull();
  });

  it("describes how a conversation felt in one plain line", () => {
    expect(describeFeel(events)).toEqual({
      dominantTone: "joy",
      intents: ["reminiscing", "small_talk"],
      line: "You sounded cheerful a good part of the time and came to reminisce and for a chat.",
    });
    expect(describeFeel([{ tone: "neutral", intent: "wanting_company" }])).toEqual({
      dominantTone: "neutral",
      intents: ["wanting_company"],
      line: "You sounded even and came for company.",
    });
    expect(describeFeel([{ tone: "frustration", intent: "venting" }, { tone: "frustration", intent: "venting" }, { tone: "frustration", intent: null }])?.line).toBe(
      "You sounded frustrated most of the time and came to get something off your chest.",
    );
    expect(describeFeel([])).toBeNull();
  });
});
