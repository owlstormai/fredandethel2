/** DELETE /api/account — delete the account and all its data (cascade), then sign out. */
import type { OkResponse } from "@/lib/api/contracts";
import { jsonOk, withErrorHandling } from "@/lib/api/respond";
import { deleteAccount } from "@/lib/auth/service";
import { destroySession, requireApiUser } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const DELETE = withErrorHandling(async () => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  await deleteAccount(user.id);
  await destroySession();
  return jsonOk<OkResponse>({ ok: true });
});
