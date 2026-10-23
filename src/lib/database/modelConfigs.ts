/** model_configs is global configuration (not user data), hence the raw query helper. */
import type { ModelConfig } from "@/lib/types";
import { query } from "./client";
import { mapModelConfig, type ModelConfigRow } from "./mappers";

const COLUMNS = "key, provider, model_id, label, tier, enabled, pricing, pricing_version, updated_at";

export async function upsertModelConfig(config: ModelConfig): Promise<ModelConfig> {
  const rows = await query<ModelConfigRow>(
    `INSERT INTO model_configs (key, provider, model_id, label, tier, enabled, pricing, pricing_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (key) DO UPDATE SET
       provider = EXCLUDED.provider, model_id = EXCLUDED.model_id, label = EXCLUDED.label,
       tier = EXCLUDED.tier, enabled = EXCLUDED.enabled, pricing = EXCLUDED.pricing,
       pricing_version = EXCLUDED.pricing_version, updated_at = now()
     RETURNING ${COLUMNS}`,
    [config.key, config.provider, config.modelId, config.label, config.tier, config.enabled, JSON.stringify(config.pricing), config.pricingVersion],
  );
  return mapModelConfig(rows[0]);
}

export async function listModelConfigs(): Promise<ModelConfig[]> {
  const rows = await query<ModelConfigRow>(`SELECT ${COLUMNS} FROM model_configs ORDER BY key`);
  return rows.map(mapModelConfig);
}
