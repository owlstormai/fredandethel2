/**
 * POST /api/tools/dispatch — execute a function call requested by the model.
 * Auth: session cookie. Body: toolDispatchSchema. Always 200 with `output`
 * unless auth (401), ownership (404) or rate limit (429) fails.
 */
import { dispatchTool } from "@/lib/ai/tools/dispatcher";
import { toolDispatchSchema, type ToolDispatchResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const body = await parseBody(request, toolDispatchSchema);
  const result = await dispatchTool(user, body);
  return jsonOk<ToolDispatchResponse>(result);
});
