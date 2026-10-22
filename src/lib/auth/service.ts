/**
 * Auth use-cases shared by the API routes and the integration tests.
 * Routes stay thin: validate, rate-limit, call these, set the cookie.
 */
import { HttpError } from "@/lib/api/respond";
import { withTransaction } from "@/lib/database/client";
import { mapUserRecord, toPublicUser, type UserRow } from "@/lib/database/mappers";
import { ensurePreferences } from "@/lib/database/preferences";
import { ensureProfile } from "@/lib/database/profiles";
import { bumpTokenVersion, deleteUserHard, findUserByEmail, isUniqueViolation } from "@/lib/database/users";
import { logInfo } from "@/lib/privacy/logging";
import type { User } from "@/lib/types";
import { ensureDemoUser, getDemoProfile, isDemoEnabled } from "./demo";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";

export interface SignedIn {
  user: User;
  tokenVersion: number;
}

export async function signUp(input: { email: string; password: string; preferredName?: string }): Promise<SignedIn> {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(email)) {
    throw new HttpError(409, "email_taken", "An account with that email already exists. Try signing in.");
  }
  const passwordHash = await hashPassword(input.password);
  let record;
  try {
    record = await withTransaction(async (client) => {
      const result = await client.query<UserRow>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         RETURNING id, email, password_hash, is_demo, demo_slug, token_version, created_at, deleted_at`,
        [email, passwordHash],
      );
      const row = result.rows[0];
      await client.query(
        `INSERT INTO profiles (user_id, preferred_name, onboarding_stage) VALUES ($1, $2, $3)`,
        [row.id, input.preferredName?.trim() || null, input.preferredName?.trim() ? "named" : "new"],
      );
      await client.query(`INSERT INTO preferences (user_id) VALUES ($1)`, [row.id]);
      return mapUserRecord(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "email_taken", "An account with that email already exists. Try signing in.");
    }
    throw error;
  }
  logInfo("auth_signup", { userId: record.id });
  return { user: toPublicUser(record), tokenVersion: record.tokenVersion };
}

/** Generic failure message and a dummy hash comparison so timing does not reveal registered emails. */
export async function signIn(input: { email: string; password: string }): Promise<SignedIn> {
  const record = await findUserByEmail(input.email.trim().toLowerCase());
  const hash = record?.passwordHash ?? (await dummyHash());
  const ok = await verifyPassword(input.password, hash);
  if (!record || !record.passwordHash || !ok || record.isDemo) {
    throw new HttpError(401, "invalid_credentials", "That email and password don't match our records.");
  }
  logInfo("auth_login", { userId: record.id });
  return { user: toPublicUser(record), tokenVersion: record.tokenVersion };
}

export async function signInDemo(slug: string): Promise<SignedIn> {
  if (!isDemoEnabled()) {
    throw new HttpError(403, "demo_disabled", "Demo profiles are turned off on this server (COMPANION_ENABLE_DEMO_PROFILES).");
  }
  if (!getDemoProfile(slug)) throw new HttpError(404, "unknown_demo_profile", "No demo profile with that name.");
  const user = await ensureDemoUser(slug);
  if (!user) throw new HttpError(404, "unknown_demo_profile", "No demo profile with that name.");
  const { findUserById } = await import("@/lib/database/users");
  const record = await findUserById(user.id);
  logInfo("auth_demo_login", { slug });
  return { user, tokenVersion: record?.tokenVersion ?? 1 };
}

/** Signs the user out everywhere by bumping token_version. */
export async function revokeAllSessions(userId: string): Promise<number> {
  return bumpTokenVersion(userId);
}

/** Deletes the account and, through ON DELETE CASCADE, every row the user owns. */
export async function deleteAccount(userId: string): Promise<boolean> {
  const deleted = await deleteUserHard(userId);
  if (deleted) logInfo("account_deleted", { userId });
  return deleted;
}

/** Make sure a (possibly legacy) user has the rows the app expects. */
export async function ensureUserRows(userId: string): Promise<void> {
  await ensureProfile(userId);
  await ensurePreferences(userId);
}
