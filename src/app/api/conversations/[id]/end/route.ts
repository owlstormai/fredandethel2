/**
 * POST /api/conversations/:id/end — mark ended and summarize. The summary is
 * stored as a memory only when memory is enabled; inferred candidates are
 * returned as suggestions and never injected. Idempotent.
 */
import type { EndConversationResponse } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { finishConversation } from "@/lib/conversations/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const { id } = await context.params;
  const result = await finishConversation(user.id, id);
  return jsonOk<EndConversationResponse>(result);
});
