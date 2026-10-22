/**
 * GET /api/models — effective model configs (defaults merged with DB
 * model_configs) and the signed-in user's default model key.
 */
import { getEffectiveModelConfigs } from "@/lib/ai/modelConfigs";
import type { ModelsResponse } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { getPreferences } from "@/lib/memory/service";
import { logWarn } from "@/lib/privacy/logging";
import type { ModelKey } from "@/lib/types";

export const GET = withErrorHandling(async () => {
  const user = await requireApiUser();
  const { models } = await getEffectiveModelConfigs();
  let defaultKey: ModelKey = "full";
  try {
    defaultKey = (await getPreferences(user.id)).modelKey;
  } catch (error) {
    logWarn("models_preferences_unavailable", { error: (error as Error).message });
  }
  return jsonOk<ModelsResponse>({ models, defaultKey });
});
