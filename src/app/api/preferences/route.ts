/**
 * PATCH /api/preferences — any preference switch. Returns { preferences }.
 * Memory/sensitive/search toggles are consent decisions, so they are also written
 * to consent_records (source "ui") via recordConsent, which mirrors them back here.
 */
import { preferencesPatchSchema, type PreferencesResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { ensurePreferences, updatePreferences } from "@/lib/database/preferences";
import { getPreferences, recordConsent } from "@/lib/memory/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const PATCH = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const patch = await parseBody(request, preferencesPatchSchema);
  const current = await ensurePreferences(user.id);

  const { memoryEnabled, sensitiveMemoryEnabled, searchEnabled, ...plain } = patch;
  if (Object.keys(plain).length > 0) await updatePreferences(user.id, plain);
  if (memoryEnabled !== undefined && memoryEnabled !== current.memoryEnabled) await recordConsent(user.id, "memory", memoryEnabled, "ui");
  if (sensitiveMemoryEnabled !== undefined && sensitiveMemoryEnabled !== current.sensitiveMemoryEnabled) {
    await recordConsent(user.id, "sensitive_memory", sensitiveMemoryEnabled, "ui");
  }
  if (searchEnabled !== undefined && searchEnabled !== current.searchEnabled) await recordConsent(user.id, "web_search", searchEnabled, "ui");

  return jsonOk<PreferencesResponse>({ preferences: await getPreferences(user.id) });
});
