/**
 * GET /api/verification — static summary of docs/API_VERIFICATION.md plus the
 * model IDs currently in use and any deprecation warnings (developer panel).
 */
import { getVerificationSummary, type VerificationSummary } from "@/lib/ai/verification";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";

export type VerificationResponse = VerificationSummary;

export const GET = withErrorHandling(async () => {
  await requireApiUser();
  return jsonOk<VerificationResponse>(getVerificationSummary());
});
