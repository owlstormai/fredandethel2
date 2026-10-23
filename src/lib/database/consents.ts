import type { ConsentRecord, ConsentScope, ConsentSource } from "@/lib/types";
import { mapConsent, type ConsentRow } from "./mappers";
import { userQuery, userQueryOne } from "./scoped";

const COLUMNS = "id, user_id, scope, granted, source, evidence, created_at";
export const CONSENT_SCOPES: ConsentScope[] = ["memory", "sensitive_memory", "web_search", "transcripts"];

export async function insertConsent(
  userId: string,
  input: { scope: ConsentScope; granted: boolean; source: ConsentSource; evidence?: string | null },
): Promise<ConsentRecord> {
  const row = await userQueryOne<ConsentRow>(
    userId,
    `INSERT INTO consent_records (user_id, scope, granted, source, evidence)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [input.scope, input.granted, input.source, input.evidence ?? null],
  );
  return mapConsent(row as ConsentRow);
}

/** Latest record for one scope, or null when the user never decided. */
export async function getLatestConsent(userId: string, scope: ConsentScope): Promise<ConsentRecord | null> {
  const row = await userQueryOne<ConsentRow>(
    userId,
    `SELECT ${COLUMNS} FROM consent_records WHERE user_id = $1 AND scope = $2
     ORDER BY created_at DESC LIMIT 1`,
    [scope],
  );
  return row ? mapConsent(row) : null;
}

/** Latest decision per scope; scopes never decided are false. */
export async function getLatestConsents(userId: string): Promise<Record<ConsentScope, boolean>> {
  const rows = await userQuery<ConsentRow>(
    userId,
    `SELECT DISTINCT ON (scope) ${COLUMNS} FROM consent_records
     WHERE user_id = $1 ORDER BY scope, created_at DESC`,
  );
  const out = Object.fromEntries(CONSENT_SCOPES.map((s) => [s, false])) as Record<ConsentScope, boolean>;
  for (const row of rows) out[row.scope] = row.granted;
  return out;
}

export async function listConsents(userId: string): Promise<ConsentRecord[]> {
  const rows = await userQuery<ConsentRow>(
    userId,
    `SELECT ${COLUMNS} FROM consent_records WHERE user_id = $1 ORDER BY created_at ASC`,
  );
  return rows.map(mapConsent);
}
