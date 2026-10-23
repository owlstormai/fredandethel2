/**
 * GET  /api/auth/demo — list the (fictional) demo profiles. 403 when demo profiles are disabled.
 * POST /api/auth/demo — sign in as a demo profile without a password (demo mode only).
 */
import { demoLoginSchema, type AuthResponse, type DemoProfilesResponse } from "@/lib/api/contracts";
import { HttpError, jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { isDemoEnabled, listDemoProfiles } from "@/lib/auth/demo";
import { signInDemo } from "@/lib/auth/service";
import { createSession } from "@/lib/auth/session";
import { clientIp, enforceRateLimit } from "@/lib/privacy/rateLimit";

export const GET = withErrorHandling(async () => {
  if (!isDemoEnabled()) {
    throw new HttpError(403, "demo_disabled", "Demo profiles are turned off on this server (COMPANION_ENABLE_DEMO_PROFILES).");
  }
  return jsonOk<DemoProfilesResponse>({ profiles: listDemoProfiles() });
});

export const POST = withErrorHandling(async (request: Request) => {
  const limited = enforceRateLimit("demoLogin", clientIp(request));
  if (limited) return limited;
  const body = await parseBody(request, demoLoginSchema);
  const { user, tokenVersion } = await signInDemo(body.slug);
  await createSession(user, tokenVersion);
  return jsonOk<AuthResponse>({ user });
});
