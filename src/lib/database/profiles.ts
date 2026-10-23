import type { Profile } from "@/lib/types";
import { mapProfile, type ProfileRow } from "./mappers";
import { userQuery, userQueryOne } from "./scoped";

const COLUMNS = "user_id, preferred_name, companion_voice, onboarding_stage, timezone, created_at, updated_at";

export interface ProfileSeed {
  preferredName?: string | null;
  companionVoice?: Profile["companionVoice"];
  onboardingStage?: Profile["onboardingStage"];
  timezone?: string | null;
}

/** Creates the profile row if missing (keeps an existing one untouched). */
export async function ensureProfile(userId: string, seed: ProfileSeed = {}): Promise<Profile> {
  const row = await userQueryOne<ProfileRow>(
    userId,
    `INSERT INTO profiles (user_id, preferred_name, companion_voice, onboarding_stage, timezone)
     VALUES ($1, $2, COALESCE($3, 'ethel'), COALESCE($4, 'new'), $5)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING ${COLUMNS}`,
    [seed.preferredName ?? null, seed.companionVoice ?? null, seed.onboardingStage ?? null, seed.timezone ?? null],
  );
  return mapProfile(row as ProfileRow);
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const row = await userQueryOne<ProfileRow>(userId, `SELECT ${COLUMNS} FROM profiles WHERE user_id = $1`);
  return row ? mapProfile(row) : null;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, "preferredName" | "companionVoice" | "timezone" | "onboardingStage">>,
): Promise<Profile | null> {
  const rows = await userQuery<ProfileRow>(
    userId,
    `UPDATE profiles SET
       preferred_name   = CASE WHEN $2::boolean THEN $3 ELSE preferred_name END,
       companion_voice  = COALESCE($4, companion_voice),
       timezone         = CASE WHEN $5::boolean THEN $6 ELSE timezone END,
       onboarding_stage = COALESCE($7, onboarding_stage)
     WHERE user_id = $1
     RETURNING ${COLUMNS}`,
    [
      patch.preferredName !== undefined,
      patch.preferredName ?? null,
      patch.companionVoice ?? null,
      patch.timezone !== undefined,
      patch.timezone ?? null,
      patch.onboardingStage ?? null,
    ],
  );
  return rows[0] ? mapProfile(rows[0]) : null;
}
