import { describe, expect, it } from "vitest";
import { heuristicSummary, redactSentencesAboutMemory, redactTombstonedSentences, toThirdPerson } from "@/lib/memory/summaries";
import type { ConversationMessage } from "@/lib/types";

const summary =
  "Margaret talked about her garden and the tomatoes doing well. She mentioned her granddaughter Lily plays the violin and has a recital soon. She prefers tea over coffee.";

describe("redactSentencesAboutMemory", () => {
  it("drops sentences sharing >= 2 keywords with the deleted memory", () => {
    const result = redactSentencesAboutMemory(summary, "My granddaughter Lily plays the violin");
    expect(result.removed).toBe(1);
    expect(result.text).not.toMatch(/Lily|violin/);
    expect(result.text).toMatch(/garden/);
    expect(result.text).toMatch(/tea/);
  });
  it("leaves text untouched when nothing matches", () => {
    const result = redactSentencesAboutMemory(summary, "Walter collects jazz records");
    expect(result.removed).toBe(0);
    expect(result.text).toBe(summary);
  });
  it("removes everything when every sentence is about the memory", () => {
    const result = redactSentencesAboutMemory("Lily plays violin. Lily's violin recital is Sunday.", "Lily plays the violin");
    expect(result.removed).toBe(2);
    expect(result.text).toBe("");
  });
});

describe("redactTombstonedSentences", () => {
  it("filters sentences that match a tombstone", () => {
    const tombstones = [{ normalized: "my granddaughter lily plays the violin", keywords: ["granddaughter", "lily", "play", "violin"] }];
    const out = redactTombstonedSentences(summary, tombstones);
    expect(out).not.toMatch(/violin/);
    expect(out).toMatch(/tomatoes/);
  });
});

describe("heuristicSummary", () => {
  const msg = (role: ConversationMessage["role"], content: string, seq: number): ConversationMessage => ({
    id: `m${seq}`,
    conversationId: "c",
    userId: "u",
    seq,
    role,
    content,
    itemId: null,
    toolName: null,
    toolPayload: null,
    sources: null,
    createdAt: new Date().toISOString(),
  });

  it("builds up to three third-person sentences from the user's longest statements", () => {
    const out = heuristicSummary(
      [
        msg("assistant", "Hello there, what's on your mind?", 1),
        msg("user", "I spent the whole morning in my garden pulling weeds and the tomatoes are finally coming in.", 2),
        msg("user", "ok", 3),
        msg("user", "My granddaughter Lily has a violin recital next week and I'm nervous for her.", 4),
        msg("user", "I think I'll make soup tonight.", 5),
        msg("user", "We used to drive to the lake every summer when the kids were small.", 6),
      ],
      "Margaret",
    );
    expect(out).not.toBeNull();
    const sentences = out!.split(/(?<=\.)\s+/);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(out).not.toMatch(/\bI\b|\bmy\b|\bI'm\b/);
    expect(out).toMatch(/Margaret/);
    expect(out).toMatch(/garden/);
  });
  it("returns null when the user said nothing substantial", () => {
    expect(heuristicSummary([msg("user", "hi", 1), msg("assistant", "Hello!", 2)], null)).toBeNull();
  });
  it("uses 'The user' when no name is known", () => {
    expect(toThirdPerson("I love my garden and I'm proud of it", null)).toBe("The user love their garden and The user is proud of it");
  });
});
