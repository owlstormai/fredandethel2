/**
 * Auth session helpers — SEAM FILE.
 * Owner: server/auth agent. Signatures are a contract used by every page and route.
 * Implementation: signed httpOnly cookie (jose HS256, AUTH_SECRET), 7-day expiry,
 * payload { sub: userId, v: tokenVersion }. Demo users are ordinary users with is_demo=true.
 */
import type { User } from "@/lib/types";

export const SESSION_COOKIE = "companion_session";

/** Current user from the request cookies (server components & route handlers). Null when signed out. */
export async function getCurrentUser(): Promise<User | null> {
  throw new Error("not implemented: getCurrentUser");
}

/** For route handlers: returns the user or throws HttpError(401). */
export async function requireApiUser(): Promise<User> {
  throw new Error("not implemented: requireApiUser");
}

/** For pages: returns the user or redirects to /login (demo-aware). */
export async function requirePageUser(): Promise<User> {
  throw new Error("not implemented: requirePageUser");
}

/** Issue a session cookie for a user (sets it on the response via next/headers cookies()). */
export async function createSession(_user: User): Promise<void> {
  throw new Error("not implemented: createSession");
}

export async function destroySession(): Promise<void> {
  throw new Error("not implemented: destroySession");
}
