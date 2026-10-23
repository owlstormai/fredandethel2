import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "./client";

/**
 * Minimal forward-only SQL migration runner. Files in ./migrations named
 * NNN_description.sql are applied in lexical order inside one transaction
 * each, recorded in schema_migrations.
 */
export async function runMigrations(options: { log?: (msg: string) => void } = {}): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  const pool = getPool();
  const dir = path.join(process.cwd(), "src", "lib", "database", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
      log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Drops all application tables. Tests only. */
export async function resetDatabase(): Promise<void> {
  if (!/companion_test|_test\b/.test(process.env.DATABASE_URL ?? "") && process.env.ALLOW_DB_RESET !== "true") {
    throw new Error("Refusing to reset a non-test database (set ALLOW_DB_RESET=true to override).");
  }
  await getPool().query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
}
