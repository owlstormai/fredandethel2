/** GET /api/conversations/:id — one conversation with its messages (404 unless it belongs to the user). */
import type { ConversationWithMessages } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { requireOwnedConversation } from "@/lib/conversations/service";
import { listMessages } from "@/lib/database/conversations";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const GET = withErrorHandling(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const { id } = await context.params;
  const conversation = await requireOwnedConversation(user.id, id);
  const messages = await listMessages(user.id, id);
  return jsonOk<ConversationWithMessages>({ ...conversation, messages });
});
