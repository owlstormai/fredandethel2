/** PATCH /api/profile — preferred name, companion voice, timezone. Returns { profile }. */
import { profilePatchSchema, type ProfileResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { updateProfile } from "@/lib/memory/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const PATCH = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const patch = await parseBody(request, profilePatchSchema);
  const profile = await updateProfile(user.id, patch);
  return jsonOk<ProfileResponse>({ profile });
});
