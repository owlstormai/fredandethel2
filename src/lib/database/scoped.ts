/**
 * User-scoped query helpers.
 *
 * Every table that holds user data carries `user_id`. These helpers refuse to
 * run SQL that does not bind the user id as `$1`, which makes "forgot to filter
 * by user" a thrown error instead of a silent data leak. Repositories should
 * use `userQuery`/`userQueryOne` for everything except the `users` table itself
 * (which is keyed by `id`) and `model_configs` (global, not user data).
 */
import type { PoolClient, QueryResultRow } from "pg";
import { query } from "./client";

const WHERE_SCOPED = /\buser_id\s*=\s*\$1(?!\d)/;
// INSERT INTO t (user_id, ...) VALUES ($1, ...)
const INSERT_SCOPED = /insert\s+into\s+\w+\s*\(\s*user_id\s*[,)][\s\S]*?values\s*\(\s*\$1(?!\d)/i;

export function assertUserScoped(sql: string): void {
  if (WHERE_SCOPED.test(sql) || INSERT_SCOPED.test(sql)) return;
  throw new Error("Refusing to run a user-data query that is not scoped by user_id = $1: " + sql.slice(0, 80));
}

/** Run a user-scoped query. `userId` is always bound as `$1`; `params` start at `$2`. */
export async function userQuery<T extends QueryResultRow = QueryResultRow>(
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertUserScoped(sql);
  return query<T>(sql, [userId, ...params]);
}

export async function userQueryOne<T extends QueryResultRow = QueryResultRow>(
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await userQuery<T>(userId, sql, params);
  return rows[0] ?? null;
}

/** Same as `userQuery`, inside a transaction. */
export async function userQueryWith<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertUserScoped(sql);
  const result = await client.query<T>(sql, [userId, ...params]);
  return result.rows;
}
