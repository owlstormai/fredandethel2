import { describe, expect, it } from "vitest";
import { estimateTokens, extractKeywords, hashText, keywordOverlap, normalizeText, overlapRatio, splitSentences, stem } from "@/lib/memory/normalize";
import { anyTombstoneMatches, tombstoneMatchesText } from "@/lib/memory/tombstones";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeText("  My granddaughter, Lily — plays the VIOLIN!  ")).toBe("my granddaughter lily plays the violin");
  });
  it("drops apostrophes without splitting words", () => {
    expect(normalizeText("Lily's violin")).toBe("lilys violin");
  });
  it("is stable for identical content", () => {
    expect(normalizeText("I love gardening.")).toBe(normalizeText("i love GARDENING"));
  });
});

describe("extractKeywords", () => {
  it("removes stopwords and stems lightly", () => {
    expect(extractKeywords("My granddaughter Lily plays the violin")).toEqual(["granddaughter", "lily", "play", "violin"]);
  });
  it("de-duplicates and keeps first-appearance order", () => {
    expect(extractKeywords("garden garden tomatoes garden")).toEqual(["garden", "tomato"]);
  });
  it("returns nothing for pure filler", () => {
    expect(extractKeywords("oh well, okay then")).toEqual([]);
  });
  it("stems plurals, -ing and -ed consistently", () => {
    expect(stem("puzzles")).toBe("puzzle");
    expect(stem("gardening")).toBe("garden");
    expect(stem("stopped")).toBe("stop");
    expect(stem("glass")).toBe("glass");
  });
});

describe("overlap helpers", () => {
  it("counts shared keywords and ratios relative to the reference", () => {
    const a = ["granddaughter", "lily", "play", "violin"];
    const b = ["lily", "violin", "recital"];
    expect(keywordOverlap(a, b)).toBe(2);
    expect(overlapRatio(a, b)).toBe(0.5);
    expect(overlapRatio([], b)).toBe(0);
  });
});

describe("splitSentences / estimateTokens / hashText", () => {
  it("splits on sentence terminators", () => {
    expect(splitSentences("Margaret loves her garden. Lily plays violin! Does she? Yes.")).toEqual([
      "Margaret loves her garden.",
      "Lily plays violin!",
      "Does she?",
      "Yes.",
    ]);
  });
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
  it("hashes deterministically and ignores case/punctuation", () => {
    expect(hashText("Hello, World!")).toBe(hashText("hello world"));
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});

describe("tombstone matching", () => {
  const tombstone = { normalized: "my granddaughter lily plays the violin", keywords: ["granddaughter", "lily", "play", "violin"] };

  it("matches normalized equality", () => {
    expect(tombstoneMatchesText(tombstone, "My granddaughter Lily plays the violin.")).toBe(true);
  });
  it("matches >= 60% keyword overlap", () => {
    expect(tombstoneMatchesText(tombstone, "Lily has been practicing her violin for the recital")).toBe(false); // lily, violin = 50%
    expect(tombstoneMatchesText(tombstone, "Her granddaughter Lily plays violin beautifully")).toBe(true); // 4/4
    expect(tombstoneMatchesText(tombstone, "Granddaughter Lily and her violin")).toBe(true); // 3/4 = 75%
  });
  it("ignores tombstones with fewer than two keywords unless text is identical", () => {
    const short = { normalized: "tea", keywords: ["tea"] };
    expect(tombstoneMatchesText(short, "I like tea with honey")).toBe(false);
    expect(tombstoneMatchesText(short, "Tea.")).toBe(true);
  });
  it("does not match unrelated text", () => {
    expect(anyTombstoneMatches([tombstone], "Walter restores old jazz records in his garage")).toBe(false);
    expect(anyTombstoneMatches([], "anything at all")).toBe(false);
  });
});
