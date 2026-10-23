/**
 * tone_events — per-turn observations of HOW (tone) and WHY (intent) the user
 * said something. source "model" = the live Realtime model reported it through
 * the observe_tone tool (it hears the voice); source "heuristic" = inferred from
 * the words of the transcript by src/lib/memory/tone.ts. User-scoped; covered
 * by memory consent (the service refuses to insert when memory is off).
 */
import type { Intent, Tone, ToneEvent } from "@/lib/types";
import { toIsoRequired } from "./mappers";
import { userQuery, userQueryOne } from "./scoped";

const COLUMNS = "id, user_id, conversation_id, message_id, tone, intensity, intent, cue, source, created_at";

interface ToneRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  tone: Tone;
  intensity: number | string;
  intent: Intent | null;
  cue: string | null;
  source: ToneEvent["source"];
  created_at: Date;
}

function mapToneEvent(row: ToneRow): ToneEvent {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    tone: row.tone,
    intensity: Math.round(Number(row.intensity) * 100) / 100,
    intent: row.intent,
    cue: row.cue,
    source: row.source,
    createdAt: toIsoRequired(row.created_at),
  };
}

export interface InsertToneEventInput {
  conversationId: string | null;
  messageId?: string | null;
  tone: Tone;
  intensity: number;
  intent: Intent | null;
  cue: string | null;
  source: ToneEvent["source"];
}

export async function insertToneEvent(userId: string, input: InsertToneEventInput): Promise<ToneEvent> {
  const row = await userQueryOne<ToneRow>(
    userId,
    `INSERT INTO tone_events (user_id, conversation_id, message_id, tone, intensity, intent, cue, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      input.conversationId,
      input.messageId ?? null,
      input.tone,
      Math.max(0, Math.min(1, input.intensity)),
      input.intent,
      input.cue ? input.cue.slice(0, 200) : null,
      input.source,
    ],
  );
  return mapToneEvent(row as ToneRow);
}

/** Newest first. */
export async function listRecentToneEvents(userId: string, limit = 200): Promise<ToneEvent[]> {
  const rows = await userQuery<ToneRow>(
    userId,
    `SELECT ${COLUMNS} FROM tone_events WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [Math.min(Math.max(1, limit), 1000)],
  );
  return rows.map(mapToneEvent);
}

/** Oldest first, for one conversation. */
export async function listToneEventsForConversation(userId: string, conversationId: string): Promise<ToneEvent[]> {
  const rows = await userQuery<ToneRow>(
    userId,
    `SELECT ${COLUMNS} FROM tone_events WHERE user_id = $1 AND conversation_id = $2 ORDER BY created_at ASC, id ASC`,
    [conversationId],
  );
  return rows.map(mapToneEvent);
}

export async function countToneEvents(userId: string): Promise<number> {
  const row = await userQueryOne<{ count: string }>(userId, `SELECT count(*)::text AS count FROM tone_events WHERE user_id = $1`);
  return Number(row?.count ?? 0);
}

/** Removes every tone event of the user; returns how many went. */
export async function deleteToneEvents(userId: string): Promise<number> {
  const rows = await userQuery<{ id: string }>(userId, `DELETE FROM tone_events WHERE user_id = $1 RETURNING id`);
  return rows.length;
}
