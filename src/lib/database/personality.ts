/**
 * personality_profiles — one row per user, the inferred conversation-style
 * profile (see src/lib/memory/personality.ts). User-scoped like every other
 * repository; deleted with the account (FK cascade) or by an explicit reset.
 */
import { coerceTraits } from "@/lib/memory/personality";
import type { PersonalityProfile, StyleProfileTraits } from "@/lib/types";
import { toIsoRequired } from "./mappers";
import { userQuery, userQueryOne } from "./scoped";

const COLUMNS = "user_id, traits, summary, evidence_conversations, evidence_messages, source, created_at, updated_at";

interface PersonalityRow {
  user_id: string;
  traits: unknown;
  summary: string | null;
  evidence_conversations: number;
  evidence_messages: number;
  source: PersonalityProfile["source"];
  created_at: Date;
  updated_at: Date;
}

function mapProfile(row: PersonalityRow): PersonalityProfile {
  return {
    userId: row.user_id,
    traits: coerceTraits(row.traits),
    summary: row.summary,
    evidenceConversations: Number(row.evidence_conversations),
    evidenceMessages: Number(row.evidence_messages),
    source: row.source,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

export async function getPersonalityProfile(userId: string): Promise<PersonalityProfile | null> {
  const row = await userQueryOne<PersonalityRow>(userId, `SELECT ${COLUMNS} FROM personality_profiles WHERE user_id = $1`);
  return row ? mapProfile(row) : null;
}

export interface PersonalityPatch {
  traits: StyleProfileTraits;
  /** Explicit null clears the summary; undefined keeps the stored one. */
  summary?: string | null;
  evidenceConversations: number;
  evidenceMessages: number;
  source: PersonalityProfile["source"];
}

export async function upsertPersonalityProfile(userId: string, patch: PersonalityPatch): Promise<PersonalityProfile> {
  const row = await userQueryOne<PersonalityRow>(
    userId,
    `INSERT INTO personality_profiles (user_id, traits, summary, evidence_conversations, evidence_messages, source)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       traits                 = EXCLUDED.traits,
       summary                = CASE WHEN $7::boolean THEN EXCLUDED.summary ELSE personality_profiles.summary END,
       evidence_conversations = EXCLUDED.evidence_conversations,
       evidence_messages      = EXCLUDED.evidence_messages,
       source                 = EXCLUDED.source
     RETURNING ${COLUMNS}`,
    [JSON.stringify(patch.traits), patch.summary ?? null, patch.evidenceConversations, patch.evidenceMessages, patch.source, patch.summary !== undefined],
  );
  return mapProfile(row as PersonalityRow);
}

export async function deletePersonalityProfile(userId: string): Promise<boolean> {
  const rows = await userQuery<{ user_id: string }>(userId, `DELETE FROM personality_profiles WHERE user_id = $1 RETURNING user_id`);
  return rows.length > 0;
}
