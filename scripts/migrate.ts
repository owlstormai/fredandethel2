import { loadEnv } from "./env";
loadEnv();
import { closePool } from "../src/lib/database/client";
import { runMigrations, resetDatabase } from "../src/lib/database/migrate";

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset) {
    await resetDatabase();
    console.log("database reset");
  }
  const ran = await runMigrations({ log: console.log });
  console.log(ran.length ? `applied ${ran.length} migration(s)` : "database is up to date");
  await closePool();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
