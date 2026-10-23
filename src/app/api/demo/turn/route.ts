/**
 * POST /api/demo/turn — one turn of the server-side demo brain (simulated, no AI
 * API). Only demo-mode conversations owned by the user; 404 otherwise.
 */
import { demoTurnSchema, type DemoTurnResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { runDemoTurn } from "@/lib/ai/adapters/demoBrain";
import { requireApiUser } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("demoTurn", user.id);
  if (limited) return limited;
  const body = await parseBody(request, demoTurnSchema);
  const result = await runDemoTurn(user.id, body.conversationId, body.text);
  return jsonOk<DemoTurnResponse>(result);
});
