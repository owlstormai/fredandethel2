import { describe, expect, it } from "vitest";
import { rankMemories, scoreMemory } from "@/lib/memory/retrieval";
import type { Memory } from "@/lib/types";

const now = Date.parse("2026-10-22T12:00:00Z");
const mem = (id: string, content: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  userId: "u",
  kind: "fact",
  category: "other",
  content,
  status: "confirmed",
  sensitivity: "normal",
  importance: 3,
  sourceConversationId: null,
  sourceMessageId: null,
  lastReferencedAt: null,
  createdAt: new Date(now - 2 * 24 * 3600 * 1000).toISOString(),
  updatedAt: new Date(now).toISOString(),
  deletedAt: null,
  ...extra,
});

describe("rankMemories", () => {
  const memories = [
    mem("garden", "Tends a vegetable garden; the tomatoes are her pride", { category: "interest" }),
    mem("lily", "Granddaughter Lily plays the violin", { category: "family", importance: 5 }),
    mem("tea", "Prefers tea over coffee", { importance: 1, createdAt: new Date(now - 400 * 24 * 3600 * 1000).toISOString() }),
  ];

  it("returns only memories sharing a keyword when the query has keywords", () => {
    const ranked = rankMemories(memories, "how are the tomatoes in your garden", 10, now);
    expect(ranked.map((r) => r.memory.id)).toEqual(["garden"]);
  });
  it("matches on category pseudo-keywords", () => {
    const ranked = rankMemories(memories, "tell me about family", 10, now);
    expect(ranked.map((r) => r.memory.id)).toEqual(["lily"]);
  });
  it("orders by importance and recency for an empty query", () => {
    const ranked = rankMemories(memories, "", 10, now);
    expect(ranked.map((r) => r.memory.id)).toEqual(["lily", "garden", "tea"]);
  });
  it("respects the limit", () => {
    expect(rankMemories(memories, "", 1, now)).toHaveLength(1);
  });
  it("gives confirmed facts a small bonus over reported ones", () => {
    const confirmed = scoreMemory(mem("a", "Loves jazz"), [], now).score;
    const reported = scoreMemory(mem("b", "Loves jazz", { status: "reported" }), [], now).score;
    expect(confirmed).toBeGreaterThan(reported);
  });
});
