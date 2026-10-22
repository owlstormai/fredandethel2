import type { Preferences } from "@/lib/types";
import { mapPreferences, type PreferencesRow } from "./mappers";
import { userQuery, userQueryOne } from "./scoped";

const COLUMNS =
  "user_id, humor_level, orb_color, text_scale, motion, captions, pause_sensitivity, model_key, memory_enabled, sensitive_memory_enabled, search_enabled, updated_at";

export type PreferencesPatch = Partial<Omit<Preferences, "userId" | "updatedAt">>;

/** Creates a default preferences row if missing. Existing rows are left alone. */
export async function ensurePreferences(userId: string, seed: PreferencesPatch = {}): Promise<Preferences> {
  const existing = await getPreferences(userId);
  if (existing) return existing;
  const row = await userQueryOne<PreferencesRow>(
    userId,
    `INSERT INTO preferences (user_id, humor_level, orb_color, text_scale, motion, captions, pause_sensitivity, model_key, memory_enabled, sensitive_memory_enabled, search_enabled)
     VALUES ($1, COALESCE($2,'gentle'), COALESCE($3,'cyan'), COALESCE($4,'large'), COALESCE($5,'system'), COALESCE($6,true), COALESCE($7,'patient'), COALESCE($8,'full'), COALESCE($9,false), COALESCE($10,false), COALESCE($11,false))
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING ${COLUMNS}`,
    [
      seed.humorLevel ?? null,
      seed.orbColor ?? null,
      seed.textScale ?? null,
      seed.motion ?? null,
      seed.captions ?? null,
      seed.pauseSensitivity ?? null,
      seed.modelKey ?? null,
      seed.memoryEnabled ?? null,
      seed.sensitiveMemoryEnabled ?? null,
      seed.searchEnabled ?? null,
    ],
  );
  return mapPreferences(row as PreferencesRow);
}

export async function getPreferences(userId: string): Promise<Preferences | null> {
  const row = await userQueryOne<PreferencesRow>(userId, `SELECT ${COLUMNS} FROM preferences WHERE user_id = $1`);
  return row ? mapPreferences(row) : null;
}

export async function updatePreferences(userId: string, patch: PreferencesPatch): Promise<Preferences | null> {
  const rows = await userQuery<PreferencesRow>(
    userId,
    `UPDATE preferences SET
       humor_level              = COALESCE($2, humor_level),
       orb_color                = COALESCE($3, orb_color),
       text_scale               = COALESCE($4, text_scale),
       motion                   = COALESCE($5, motion),
       captions                 = COALESCE($6, captions),
       pause_sensitivity        = COALESCE($7, pause_sensitivity),
       model_key                = COALESCE($8, model_key),
       memory_enabled           = COALESCE($9, memory_enabled),
       sensitive_memory_enabled = COALESCE($10, sensitive_memory_enabled),
       search_enabled           = COALESCE($11, search_enabled)
     WHERE user_id = $1
     RETURNING ${COLUMNS}`,
    [
      patch.humorLevel ?? null,
      patch.orbColor ?? null,
      patch.textScale ?? null,
      patch.motion ?? null,
      patch.captions ?? null,
      patch.pauseSensitivity ?? null,
      patch.modelKey ?? null,
      patch.memoryEnabled ?? null,
      patch.sensitiveMemoryEnabled ?? null,
      patch.searchEnabled ?? null,
    ],
  );
  return rows[0] ? mapPreferences(rows[0]) : null;
}
