/** GET /api/me — the signed-in user, profile, preferences, consent map, effective mode and capabilities. */
import type { MeResponse } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { isLiveConfigured } from "@/lib/ai/models";
import { requireApiUser } from "@/lib/auth/session";
import { getLatestConsents } from "@/lib/database/consents";
import { getPreferences, getProfile } from "@/lib/memory/service";

export const GET = withErrorHandling(async () => {
  const user = await requireApiUser();
  const [profile, preferences, consents] = await Promise.all([getProfile(user.id), getPreferences(user.id), getLatestConsents(user.id)]);
  const live = isLiveConfigured();
  const response: MeResponse = {
    user,
    profile,
    preferences,
    consents,
    mode: user.isDemo || !live ? "demo" : "live",
    capabilities: { liveConfigured: live, searchConfigured: live, summariesConfigured: live },
  };
  return jsonOk(response);
});
