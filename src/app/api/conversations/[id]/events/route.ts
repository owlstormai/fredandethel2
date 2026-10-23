/**
 * POST /api/conversations/:id/events — ordered telemetry batch from the browser:
 * transcript messages (deduplicated by itemId), token usage, speech/connected
 * seconds and client errors (logged redacted). 404 unless the conversation is the user's.
 */
import { conversationEventsBatchSchema, type ConversationEventsResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { recordConversationEvents } from "@/lib/conversations/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("events", user.id);
  if (limited) return limited;
  const { id } = await context.params;
  const body = await parseBody(request, conversationEventsBatchSchema);
  const result = await recordConversationEvents(user.id, id, body.events);
  return jsonOk<ConversationEventsResponse>({ ok: true, ...result });
});
