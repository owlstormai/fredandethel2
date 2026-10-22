import { describe, expect, it } from "vitest";
import {
  detectEmergency,
  detectFalsehood,
  detectSerious,
  echoPhrase,
  FALSEHOODS,
  inferMemoryShape,
  isNo,
  isRecallRequest,
  isYes,
  maybeQuip,
  parseForgetRequest,
  parseHumorCommand,
  parseNameStatement,
  parseRememberRequest,
  pick,
  toThirdPersonInterest,
} from "@/lib/ai/adapters/demoBrain";
import { hashText } from "@/lib/memory/normalize";

describe("safety classifiers", () => {
  it("detects emergencies and crisis language", () => {
    expect(detectEmergency("I've got chest pain and my arm is numb")).toBe("emergency");
    expect(detectEmergency("I fell and can't get up")).toBe("emergency");
    expect(detectEmergency("I think my husband is having a stroke")).toBe("emergency");
    expect(detectEmergency("some days I just want to end it all")).toBe("crisis");
    expect(detectEmergency("I planted tomatoes")).toBeNull();
  });
  it("detects serious topics by kind", () => {
    expect(detectSerious("my husband died last month")).toBe("grief");
    expect(detectSerious("I was in the hospital on Tuesday")).toBe("health");
    expect(detectSerious("I can't sleep lately")).toBe("health");
    expect(detectSerious("I've been feeling so lonely since the move")).toBe("mood");
    expect(detectSerious("we've got money trouble this month")).toBe("money");
    expect(detectSerious("I fell in love with a new crossword book")).toBeNull();
    expect(detectSerious("I did some painting in the garage")).toBeNull();
  });
});

describe("disagreement list", () => {
  it("has a reason for every falsehood", () => {
    expect(FALSEHOODS.length).toBeGreaterThanOrEqual(5);
    for (const f of FALSEHOODS) expect(f.reply.length).toBeGreaterThan(20);
  });
  it("matches the common ones and ignores ordinary statements", () => {
    expect(detectFalsehood("I heard you can see the Great Wall from space")?.reply).toMatch(/Great Wall/);
    expect(detectFalsehood("we only use 10% of our brains")?.reply).toMatch(/brain/);
    expect(detectFalsehood("lightning never strikes twice")?.reply).toMatch(/Empire State/);
    expect(detectFalsehood("goldfish have a 3 second memory")?.reply).toMatch(/goldfish/);
    expect(detectFalsehood("the moon landing was faked")?.reply).toMatch(/moon rock/);
    expect(detectFalsehood("I watched the moon rise over the lake")).toBeNull();
  });
});

describe("memory commands", () => {
  it("parses remember requests", () => {
    expect(parseRememberRequest("Remember that my granddaughter Lily plays the violin.")).toBe("my granddaughter Lily plays the violin");
    expect(parseRememberRequest("please don't forget I take my pills at eight")).toBe("I take my pills at eight");
    expect(parseRememberRequest("Oh, could you remember that I prefer tea?")).toBe("I prefer tea");
    expect(parseRememberRequest("what do you remember about me?")).toBeNull();
    expect(parseRememberRequest("do you remember when we talked?")).toBeNull();
    expect(parseRememberRequest("I remember the war")).toBeNull();
  });
  it("parses forget requests and never-mind", () => {
    expect(parseForgetRequest("forget about Lily's violin")).toEqual({ content: "Lily's violin" });
    expect(parseForgetRequest("Please delete what I said about my pension")).toEqual({ content: "my pension" });
    expect(parseForgetRequest("forget it")).toBe("never_mind");
    expect(parseForgetRequest("don't forget the tomatoes")).toBeNull();
    expect(parseForgetRequest("I forget things sometimes")).toBeNull();
  });
  it("recognises recall questions", () => {
    expect(isRecallRequest("What do you remember about me?")).toBe(true);
    expect(isRecallRequest("what have you saved?")).toBe(true);
    expect(isRecallRequest("Do you remember anything?")).toBe(true);
    expect(isRecallRequest("remember that I like tea")).toBe(false);
  });
  it("infers category, kind and sensitivity", () => {
    expect(inferMemoryShape("my granddaughter Lily plays the violin")).toEqual({ kind: "relationship", category: "family", sensitivity: "normal" });
    expect(inferMemoryShape("I love crossword puzzles")).toEqual({ kind: "interest", category: "interest", sensitivity: "normal" });
    expect(inferMemoryShape("my doctor changed my blood pressure pills")).toMatchObject({ category: "health", sensitivity: "sensitive" });
    expect(inferMemoryShape("I prefer tea over coffee")).toMatchObject({ kind: "preference", category: "preference" });
    expect(inferMemoryShape("the car is blue")).toEqual({ kind: "fact", category: "other", sensitivity: "normal" });
  });
  it("turns a mentioned interest into a third-person note", () => {
    expect(toThirdPersonInterest("I love working in my garden")).toBe("Enjoys working in their garden");
    expect(toThirdPersonInterest("well, nothing really")).toBeNull();
  });
});

describe("humor commands", () => {
  it("steps down, off and up", () => {
    expect(parseHumorCommand("less joking please", "playful")).toBe("gentle");
    expect(parseHumorCommand("less joking please", "gentle")).toBe("off");
    expect(parseHumorCommand("stop joking", "gentle")).toBe("off");
    expect(parseHumorCommand("no more jokes", "playful")).toBe("off");
    expect(parseHumorCommand("more jokes!", "off")).toBe("gentle");
    expect(parseHumorCommand("more jokes!", "gentle")).toBe("playful");
    expect(parseHumorCommand("tell me about jokers in cards", "gentle")).toBeNull();
  });
  it("never quips when humor is off, quips sometimes when gentle, more when playful", () => {
    const texts = ["I spent the morning in the garden", "we put on an old jazz record", "the tomatoes are coming in", "I did the crossword in pen", "my dog chased a squirrel", "I baked a pie"];
    const gentle = texts.filter((t) => maybeQuip(t, "gentle", hashText(t)) !== "").length;
    const playful = texts.filter((t) => maybeQuip(t, "playful", hashText(t)) !== "").length;
    expect(texts.every((t) => maybeQuip(t, "off", hashText(t)) === "")).toBe(true);
    expect(playful).toBeGreaterThanOrEqual(gentle);
    expect(playful).toBeGreaterThan(0);
    // Deterministic for a given text.
    expect(maybeQuip(texts[0], "playful", hashText(texts[0]))).toBe(maybeQuip(texts[0], "playful", hashText(texts[0])));
  });
});

describe("names and yes/no", () => {
  it("extracts explicit names any time", () => {
    expect(parseNameStatement("You can call me Peg", false)).toBe("Peg");
    expect(parseNameStatement("my name is walter smith", false)).toBe("Walter");
    expect(parseNameStatement("My name is Walter Smith", false)).toBe("Walter Smith");
    expect(parseNameStatement("I'm tired today", false)).toBeNull();
  });
  it("accepts soft and bare forms only when a name was asked for", () => {
    expect(parseNameStatement("It's Margaret", true)).toBe("Margaret");
    expect(parseNameStatement("Margaret.", true)).toBe("Margaret");
    expect(parseNameStatement("I'm Margaret and I'm seventy-eight", true)).toBe("Margaret");
    expect(parseNameStatement("Margaret", false)).toBeNull();
    expect(parseNameStatement("yes", true)).toBeNull();
    expect(parseNameStatement("I'm not sure", true)).toBeNull();
  });
  it("classifies yes and no", () => {
    expect(isYes("Yes please")).toBe(true);
    expect(isYes("sure, go ahead")).toBe(true);
    expect(isYes("no thanks")).toBe(false);
    expect(isNo("not now")).toBe(true);
    expect(isNo("I'd rather not")).toBe(true);
    expect(isNo("yes, don't worry about it")).toBe(false);
    expect(isYes("tell me about the weather")).toBe(false);
  });
});

describe("echo and templates", () => {
  it("echoes the first clause in second person", () => {
    expect(echoPhrase("Well, I spent the morning in my garden, pulling weeds.")).toBe("you spent the morning in your garden");
    expect(echoPhrase("ok")).toBeNull();
  });
  it("picks templates deterministically from a hash", () => {
    const items = ["a", "b", "c"];
    expect(pick(items, hashText("same text"))).toBe(pick(items, hashText("same text")));
    expect(pick(items, 4)).toBe("b");
  });
});
