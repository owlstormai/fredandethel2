/**
 * Reset the e2e test database to a clean, seeded state. Uses TRUNCATE (not
 * DROP SCHEMA) so an already running `next start` keeps its connections.
 * Refuses to run against anything but a *_test database.
 */
import { config } from "dotenv";
import path from "node:path";
import { getPool, closePool } from "../src/lib/database/client";
import { runMigrations } from "../src/lib/database/migrate";
import { seedAll } from "./seed";

async function main() {
  config({ path: path.resolve(process.cwd(), ".env.test") });
  if (!/companion_test|_test\b/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to reset a non-test database (DATABASE_URL must point at companion_test).");
  }
  await runMigrations();
  await getPool().query(`
    TRUNCATE TABLE usage_events, tone_events, personality_profiles, memory_events, memory_tombstones, memories,
      conversation_messages, conversations, consent_records, preferences, profiles, users RESTART IDENTITY CASCADE
  `);
  await seedAll();
  await closePool();
  console.log("e2e database reset and seeded");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
