/** POST /api/consent — record a consent decision (mirrored into preferences). Returns { consent }. */
import { consentSchema, type ConsentResponse } from "@/lib/api/contracts";
import { HttpError, jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { getLatestConsent } from "@/lib/database/consents";
import { recordConsent } from "@/lib/memory/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const body = await parseBody(request, consentSchema);
  await recordConsent(user.id, body.scope, body.granted, body.source, body.evidence);
  const consent = await getLatestConsent(user.id, body.scope);
  if (!consent) throw new HttpError(500, "internal_error", "Consent was not recorded.");
  return jsonOk<ConsentResponse>({ consent });
});
