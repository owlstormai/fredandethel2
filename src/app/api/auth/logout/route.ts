/** POST /api/auth/logout — clears the session cookie. Always succeeds. */
import type { OkResponse } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { destroySession } from "@/lib/auth/session";

export const POST = withErrorHandling(async () => {
  await destroySession();
  return jsonOk<OkResponse>({ ok: true });
});
