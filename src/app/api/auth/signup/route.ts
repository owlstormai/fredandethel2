/** POST /api/auth/signup — create an account, its profile/preferences rows, and sign in. 409 on duplicate email. */
import { signupSchema, type AuthResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { signUp } from "@/lib/auth/service";
import { createSession } from "@/lib/auth/session";
import { clientIp, enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (request: Request) => {
  const limited = enforceRateLimit("auth", clientIp(request));
  if (limited) return limited;
  const body = await parseBody(request, signupSchema);
  const { user, tokenVersion } = await signUp(body);
  await createSession(user, tokenVersion);
  return jsonOk<AuthResponse>({ user }, { status: 201 });
});
