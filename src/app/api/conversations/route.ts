/**
 * POST /api/conversations — start a conversation (demo users are always demo).
 * GET  /api/conversations?limit=20 — the user's recent conversations.
 */
import { createConversationSchema, type ConversationResponse, type ConversationsListResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { startConversation } from "@/lib/conversations/service";
import { listConversations } from "@/lib/database/conversations";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const body = await parseBody(request, createConversationSchema);
  const conversation = await startConversation(user, body);
  return jsonOk<ConversationResponse>({ conversation }, { status: 201 });
});

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 100) : 20;
  return jsonOk<ConversationsListResponse>({ conversations: await listConversations(user.id, limit) });
});
