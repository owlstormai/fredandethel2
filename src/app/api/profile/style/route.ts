/**
 * GET    /api/profile/style — the user's inferred conversation-style profile
 *        (built from their words, never audio), plain-language rows for the
 *        memory page, and the last 20 tone observations (no cues).
 * DELETE /api/profile/style — reset: deletes the profile and every tone event.
 */
import type { OkResponse, StyleProfileResponse } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { describeStyleForUser } from "@/lib/memory/personality";
import { getStyleProfile, listRecentTones, resetPersonalityProfile } from "@/lib/memory/personalityService";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const GET = withErrorHandling(async () => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  const [profile, recentTones] = await Promise.all([getStyleProfile(user.id), listRecentTones(user.id, 20)]);
  return jsonOk<StyleProfileResponse>({ profile, description: profile ? describeStyleForUser(profile) : [], recentTones });
});

export const DELETE = withErrorHandling(async () => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  await resetPersonalityProfile(user.id);
  return jsonOk<OkResponse>({ ok: true });
});
