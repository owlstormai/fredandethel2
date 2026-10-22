/**
 * Conversation repository — SEAM FILE. Owner: server/memory agent.
 * Every query is user-scoped: a conversation id from another user yields null.
 */
import type { AppMode, Conversation, ConversationMessage, ConversationStatus, ModelKey, SearchSource } from "@/lib/types";
import { withTransaction } from "./client";
import { mapConversation, mapMessage, type ConversationRow, type MessageRow } from "./mappers";
import { userQuery, userQueryOne, userQueryWith } from "./scoped";

const CONV_COLUMNS =
  "id, user_id, mode, model_key, model_id, status, started_at, ended_at, connected_seconds, user_speech_seconds, assistant_speech_seconds, continued_from_id, summary_memory_id, metadata";
const MSG_COLUMNS = "id, conversation_id, user_id, seq, role, content, item_id, tool_name, tool_payload, sources, created_at";

export async function createConversation(input: {
  userId: string;
  mode: AppMode;
  modelKey: ModelKey;
  modelId: string;
  continuedFromId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<Conversation> {
  const row = await userQueryOne<ConversationRow>(
    input.userId,
    `INSERT INTO conversations (user_id, mode, model_key, model_id, continued_from_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING ${CONV_COLUMNS}`,
    [input.mode, input.modelKey, input.modelId, input.continuedFromId ?? null, JSON.stringify(input.metadata ?? {})],
  );
  return mapConversation(row as ConversationRow);
}

export async function getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
  const row = await userQueryOne<ConversationRow>(
    userId,
    `SELECT ${CONV_COLUMNS} FROM conversations WHERE user_id = $1 AND id = $2`,
    [conversationId],
  );
  return row ? mapConversation(row) : null;
}

export async function listConversations(userId: string, limit = 20): Promise<Conversation[]> {
  const rows = await userQuery<ConversationRow>(
    userId,
    `SELECT ${CONV_COLUMNS} FROM conversations WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return rows.map(mapConversation);
}

export async function listMessages(userId: string, conversationId: string): Promise<ConversationMessage[]> {
  const rows = await userQuery<MessageRow>(
    userId,
    `SELECT ${MSG_COLUMNS} FROM conversation_messages WHERE user_id = $1 AND conversation_id = $2 ORDER BY seq ASC`,
    [conversationId],
  );
  return rows.map(mapMessage);
}

/** The last `limit` messages in chronological order. */
export async function listRecentMessages(userId: string, conversationId: string, limit = 20): Promise<ConversationMessage[]> {
  const rows = await userQuery<MessageRow>(
    userId,
    `SELECT * FROM (
       SELECT ${MSG_COLUMNS} FROM conversation_messages WHERE user_id = $1 AND conversation_id = $2 ORDER BY seq DESC LIMIT $3
     ) recent ORDER BY seq ASC`,
    [conversationId, Math.max(1, Math.min(limit, 500))],
  );
  return rows.map(mapMessage);
}

/**
 * Appends a message. Serialised per conversation (row lock) so `seq` is gap-free
 * under concurrent batches. When `itemId` is given and already stored, the
 * existing row is updated in place (final transcripts replace partial ones).
 * Throws when the conversation does not belong to the user.
 */
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
  return withTransaction(async (client) => {
    const owner = await userQueryWith<{ id: string }>(
      client,
      input.userId,
      `SELECT id FROM conversations WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [input.conversationId],
    );
    if (owner.length === 0) throw new Error("conversation_not_found");

    if (input.itemId) {
      const existing = await userQueryWith<MessageRow>(
        client,
        input.userId,
        `UPDATE conversation_messages SET content = $4, sources = $5::jsonb
         WHERE user_id = $1 AND conversation_id = $2 AND item_id = $3 RETURNING ${MSG_COLUMNS}`,
        [input.conversationId, input.itemId, input.content, input.sources ? JSON.stringify(input.sources) : null],
      );
      if (existing[0]) return mapMessage(existing[0]);
    }

    const rows = await userQueryWith<MessageRow>(
      client,
      input.userId,
      `INSERT INTO conversation_messages (user_id, conversation_id, seq, role, content, item_id, tool_name, tool_payload, sources)
       SELECT $1, $2, COALESCE(MAX(seq), 0) + 1, $3, $4, $5, $6, $7::jsonb, $8::jsonb
       FROM conversation_messages WHERE user_id = $1 AND conversation_id = $2
       RETURNING ${MSG_COLUMNS}`,
      [
        input.conversationId,
        input.role,
        input.content,
        input.itemId ?? null,
        input.toolName ?? null,
        input.toolPayload ? JSON.stringify(input.toolPayload) : null,
        input.sources ? JSON.stringify(input.sources) : null,
      ],
    );
    return mapMessage(rows[0]);
  });
}

export async function endConversation(userId: string, conversationId: string, status: ConversationStatus = "ended"): Promise<Conversation | null> {
  const rows = await userQuery<ConversationRow>(
    userId,
    `UPDATE conversations SET status = $3, ended_at = COALESCE(ended_at, now())
     WHERE user_id = $1 AND id = $2 RETURNING ${CONV_COLUMNS}`,
    [conversationId, status],
  );
  return rows[0] ? mapConversation(rows[0]) : null;
}

export async function setStatus(userId: string, conversationId: string, status: ConversationStatus): Promise<Conversation | null> {
  const rows = await userQuery<ConversationRow>(
    userId,
    `UPDATE conversations SET status = $3 WHERE user_id = $1 AND id = $2 RETURNING ${CONV_COLUMNS}`,
    [conversationId, status],
  );
  return rows[0] ? mapConversation(rows[0]) : null;
}

/** Adds measured seconds for a speaker, or connected time. */
export async function addSpeechSeconds(
  userId: string,
  conversationId: string,
  who: "user" | "assistant" | "connected",
  seconds: number,
): Promise<Conversation | null> {
  const column =
    who === "user" ? "user_speech_seconds" : who === "assistant" ? "assistant_speech_seconds" : "connected_seconds";
  const rows = await userQuery<ConversationRow>(
    userId,
    `UPDATE conversations SET ${column} = ${column} + $3 WHERE user_id = $1 AND id = $2 RETURNING ${CONV_COLUMNS}`,
    [conversationId, Math.max(0, seconds)],
  );
  return rows[0] ? mapConversation(rows[0]) : null;
}

export async function setSummaryMemoryId(userId: string, conversationId: string, memoryId: string | null): Promise<void> {
  await userQuery(
    userId,
    `UPDATE conversations SET summary_memory_id = $3 WHERE user_id = $1 AND id = $2`,
    [conversationId, memoryId],
  );
}

/** Shallow-merges `patch` into conversations.metadata. */
export async function mergeConversationMetadata(
  userId: string,
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<Conversation | null> {
  const rows = await userQuery<ConversationRow>(
    userId,
    `UPDATE conversations SET metadata = metadata || $3::jsonb WHERE user_id = $1 AND id = $2 RETURNING ${CONV_COLUMNS}`,
    [conversationId, JSON.stringify(patch)],
  );
  return rows[0] ? mapConversation(rows[0]) : null;
}
