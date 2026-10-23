/**
 * Idempotent seed: model_configs from defaultModelConfigs() and the fictional
 * demo profiles (users, profiles, preferences, seed consent, seed memories).
 * Safe to run repeatedly; memories the demo user deleted are not recreated.
 *
 *   npm run db:seed            (dev DB via .env.local)
 *   import { seedAll } from "../scripts/seed"  (tests)
 */
import { loadEnv } from "./env";
loadEnv();
import { defaultModelConfigs } from "../src/lib/ai/models";
import { DEMO_PROFILES, seedDemoProfile } from "../src/lib/auth/demo";
import { closePool } from "../src/lib/database/client";
import { upsertModelConfig } from "../src/lib/database/modelConfigs";

export async function seedAll(log: (message: string) => void = () => undefined): Promise<void> {
  for (const config of defaultModelConfigs()) {
    await upsertModelConfig(config);
    log(`model_configs: ${config.key} -> ${config.modelId}`);
  }
  for (const definition of DEMO_PROFILES) {
    const { user, created } = await seedDemoProfile(definition);
    log(`demo profile ${definition.slug} (${user.id}): ${created.length} new memor${created.length === 1 ? "y" : "ies"}`);
  }
}

const isMain = process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (isMain) {
  seedAll(console.log)
    .then(() => closePool())
    .then(() => console.log("seed complete"))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
