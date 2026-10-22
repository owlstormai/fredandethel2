/**
 * Post-conversation summarization — SEAM FILE. Owner: AI/usage agent.
 * Called by the conversation `end` route. Returns null when no OPENAI_API_KEY
 * (caller falls back to a heuristic summary labeled "summarized").
 */
import type { ConversationMessage, MemoryCategory, MemoryKind, MemorySensitivity } from "@/lib/types";

export interface SummaryCandidate {
  content: string;
  kind: Exclude<MemoryKind, "summary">;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
  /** "reported" if the user plainly stated it; "inferred" if a guess. */
  status: "reported" | "inferred";
}

export interface SummaryResult {
  summary: string;
  candidates: SummaryCandidate[];
  modelId: string;
}

export async function summarizeConversation(
  _userId: string,
  _conversationId: string,
  _messages: ConversationMessage[],
  _options: { tombstoneKeywords: string[]; preferredName: string | null },
): Promise<SummaryResult | null> {
  throw new Error("not implemented: summarizeConversation");
}
