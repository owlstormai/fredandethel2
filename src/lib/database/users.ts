/**
 * Users repository. The `users` table is keyed by `id` (not `user_id`), so it is
 * the one repository that uses the raw `query` helper. Every function here
 * ignores soft-deleted users unless explicitly stated.
 */
import { query, queryOne } from "./client";
import { mapUserRecord, type UserRecord, type UserRow } from "./mappers";

const USER_COLUMNS = "id, email, password_hash, is_demo, demo_slug, token_version, created_at, deleted_at";

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return row ? mapUserRecord(row) : null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  return row ? mapUserRecord(row) : null;
}

export async function findDemoUserBySlug(slug: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE demo_slug = $1 AND is_demo AND deleted_at IS NULL`,
    [slug],
  );
  return row ? mapUserRecord(row) : null;
}

export async function createUser(input: { email: string; passwordHash: string }): Promise<UserRecord> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING ${USER_COLUMNS}`,
    [input.email, input.passwordHash],
  );
  return mapUserRecord(row as UserRow);
}

/** Idempotent: returns the existing demo user for the slug or creates one. */
export async function upsertDemoUser(slug: string): Promise<UserRecord> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (is_demo, demo_slug) VALUES (true, $1)
     ON CONFLICT (demo_slug) DO UPDATE SET deleted_at = NULL
     RETURNING ${USER_COLUMNS}`,
    [slug],
  );
  return mapUserRecord(row as UserRow);
}

/** Invalidates every session for the user. Returns the new token version. */
export async function bumpTokenVersion(userId: string): Promise<number> {
  const row = await queryOne<{ token_version: number }>(
    `UPDATE users SET token_version = token_version + 1 WHERE id = $1 AND deleted_at IS NULL RETURNING token_version`,
    [userId],
  );
  return row?.token_version ?? 0;
}

/** Hard delete: cascades to every user-owned table. Used by "delete my account". */
export async function deleteUserHard(userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(`DELETE FROM users WHERE id = $1 RETURNING id`, [userId]);
  return rows.length > 0;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
