/**
 * Effective model configs: defaults from models.ts merged with DB rows in
 * `model_configs` (seeded by Agent C; DB values win when present). Falls back
 * to defaults if the table is empty or the DB is unreachable, so the models
 * endpoint and session minting keep working.
 */
import { defaultModelConfigs } from "@/lib/ai/models";
import { query } from "@/lib/database/client";
import { logWarn } from "@/lib/privacy/logging";
import type { ModelConfig, ModelKey, ModelPricing } from "@/lib/types";

interface ModelConfigRow {
  key: string;
  provider: string;
  model_id: string;
  label: string;
  tier: string;
  enabled: boolean;
  pricing: Partial<ModelPricing> | null;
  pricing_version: string;
}

function mergePricing(base: ModelPricing, override: Partial<ModelPricing> | null): ModelPricing {
  if (!override) return base;
  const out = { ...base };
  for (const k of Object.keys(base) as Array<keyof ModelPricing>) {
    const v = override[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

export async function getEffectiveModelConfigs(): Promise<{ models: ModelConfig[]; source: "db" | "defaults" }> {
  const defaults = defaultModelConfigs();
  let rows: ModelConfigRow[] = [];
  try {
    rows = await query<ModelConfigRow>(
      `SELECT key, provider, model_id, label, tier, enabled, pricing, pricing_version FROM model_configs`,
    );
  } catch (error) {
    logWarn("model_configs_unavailable", { error: (error as Error).message });
    return { models: defaults, source: "defaults" };
  }
  if (rows.length === 0) return { models: defaults, source: "defaults" };

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const models = defaults.map((d) => {
    const row = byKey.get(d.key);
    if (!row) return d;
    return {
      ...d,
      provider: "openai" as const,
      modelId: row.model_id || d.modelId,
      label: row.label || d.label,
      tier: (row.tier === "mini" ? "mini" : "full") as ModelConfig["tier"],
      enabled: Boolean(row.enabled),
      pricing: mergePricing(d.pricing, row.pricing),
      pricingVersion: row.pricing_version || d.pricingVersion,
    };
  });
  return { models, source: "db" };
}

export async function resolveModelConfig(key: ModelKey): Promise<ModelConfig> {
  const { models } = await getEffectiveModelConfigs();
  const found = models.find((m) => m.key === key);
  return found ?? defaultModelConfigs().find((m) => m.key === key)!;
}
