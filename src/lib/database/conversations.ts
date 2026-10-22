/**
 * Conversation repository — SEAM FILE. Owner: server/memory agent.
 */
import type { AppMode, Conversation, ConversationMessage, ModelKey, SearchSource } from "@/lib/types";

export async function createConversation(input: {
  userId: string;
  mode: AppMode;
  modelKey: ModelKey;
  modelId: string;
  continuedFromId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<Conversation> {
  void input;
  throw new Error("not implemented: createConversation");
}

export async function getConversation(_userId: string, _conversationId: string): Promise<Conversation | null> {
  throw new Error("not implemented: getConversation");
}

export async function listMessages(_userId: string, _conversationId: string): Promise<ConversationMessage[]> {
  throw new Error("not implemented: listMessages");
}

export async function appendMessage(input: {
  userId: string;
  conversationId: string;
  role: ConversationMessage["role"];
  content: string;
  itemId?: string | null;
  toolName?: string | null;
  toolPayload?: Record<string, unknown> | null;
  sources?: SearchSource[] | null;
}): Promise<ConversationMessage> {
  void input;
  throw new Error("not implemented: appendMessage");
}
