/** POST /api/auth/login — password sign-in. Generic 401 whether the email exists or not. */
import { loginSchema, type AuthResponse } from "@/lib/api/contracts";
import { jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { signIn } from "@/lib/auth/service";
import { createSession } from "@/lib/auth/session";
import { clientIp, enforceRateLimit } from "@/lib/privacy/rateLimit";

export const POST = withErrorHandling(async (request: Request) => {
  const limited = enforceRateLimit("auth", clientIp(request));
  if (limited) return limited;
  const body = await parseBody(request, loginSchema);
  const { user, tokenVersion } = await signIn(body);
  await createSession(user, tokenVersion);
  return jsonOk<AuthResponse>({ user });
});
