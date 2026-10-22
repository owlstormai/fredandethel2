/** GET /api/health — liveness + database check. No auth; reveals nothing user-specific. */
import type { HealthResponse } from "@/lib/api/contracts";
import { withErrorHandling } from "@/lib/api/respond";
import { isLiveConfigured } from "@/lib/ai/models";
import { query } from "@/lib/database/client";
import { logError } from "@/lib/privacy/logging";

export const APP_VERSION = process.env.npm_package_version ?? process.env.COMPANION_VERSION ?? "0.1.0";

export const GET = withErrorHandling(async () => {
  let db: HealthResponse["db"] = "ok";
  try {
    await query("SELECT 1");
  } catch (error) {
    db = "error";
    logError("health_db_check_failed", error);
  }
  const body: HealthResponse = { ok: db === "ok", db, liveConfigured: isLiveConfigured(), version: APP_VERSION };
  return Response.json(body, { status: db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
