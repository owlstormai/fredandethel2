/**
 * Bounded keyword retrieval. No vectors: score = keyword overlap with the query
 * (plus category/kind as pseudo-keywords) + importance + recency + a small bonus
 * for confirmed facts. Deterministic and cheap; good enough for a few hundred
 * memories per user, which is the MVP envelope.
 */
import type { Memory } from "@/lib/types";
import { extractKeywords, keywordOverlap } from "./normalize";

export interface ScoredMemory {
  memory: Memory;
  score: number;
  overlap: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function memoryKeywords(memory: Memory): string[] {
  return Array.from(new Set([...extractKeywords(memory.content), memory.category, memory.kind]));
}

export function scoreMemory(memory: Memory, queryKeywords: readonly string[], now: number = Date.now()): ScoredMemory {
  const overlap = queryKeywords.length ? keywordOverlap(memoryKeywords(memory), queryKeywords) : 0;
  const referenced = memory.lastReferencedAt ? Date.parse(memory.lastReferencedAt) : Date.parse(memory.createdAt);
  const ageDays = Math.max(0, (now - referenced) / DAY_MS);
  const recency = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.5 : ageDays <= 180 ? 0.25 : 0;
  const statusBonus = memory.status === "confirmed" ? 0.75 : memory.status === "reported" ? 0.25 : 0;
  const score = overlap * 3 + memory.importance * 0.5 + recency + statusBonus;
  return { memory, score, overlap };
}

/**
 * Ranks memories for a query. When the query has keywords, only memories that
 * share at least one are returned (so "what do you know about my garden" does
 * not surface unrelated facts). An empty query returns the top memories by
 * importance and recency.
 */
export function rankMemories(memories: readonly Memory[], query: string, limit = 10, now: number = Date.now()): ScoredMemory[] {
  const queryKeywords = extractKeywords(query);
  const scored = memories.map((m) => scoreMemory(m, queryKeywords, now));
  const filtered = queryKeywords.length ? scored.filter((s) => s.overlap > 0) : scored;
  return filtered
    .sort((a, b) => b.score - a.score || a.memory.createdAt.localeCompare(b.memory.createdAt))
    .slice(0, Math.max(0, limit));
}
