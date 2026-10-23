/**
 * Auth session helpers — SEAM FILE.
 * Owner: server/auth agent. Signatures are a contract used by every page and route.
 * Implementation: signed httpOnly cookie (jose HS256, AUTH_SECRET), 7-day expiry,
 * payload { sub: userId, v: tokenVersion }. Demo users are ordinary users with is_demo=true.
 *
 * The token version is checked on every read: bumping users.token_version signs
 * the user out everywhere. Soft-deleted users are treated as signed out.
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HttpError } from "@/lib/api/respond";
import { findUserById } from "@/lib/database/users";
import { toPublicUser } from "@/lib/database/mappers";
import type { User } from "@/lib/types";

export const SESSION_COOKIE = "companion_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET must be set to a long random string (see .env.example).");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  sub: string;
  v: number;
}

/** Signs a session token. Exported for tests and for the demo sign-in flow. */
export async function signSessionToken(payload: SessionPayload, ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ v: payload.v })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey());
}

/** Verifies a token's signature and expiry. Returns null for anything invalid. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.v !== "number") return null;
    return { sub: payload.sub, v: payload.v };
  } catch {
    return null;
  }
}

/** Resolves a token to a live user, enforcing token_version and deleted_at. */
export async function userFromToken(token: string | undefined | null): Promise<User | null> {
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const record = await findUserById(payload.sub);
  if (!record || record.deletedAt || record.tokenVersion !== payload.v) return null;
  return toPublicUser(record);
}

async function readCookieToken(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    // Called outside a request scope (e.g. a script): treat as signed out.
    return null;
  }
}

/** Current user from the request cookies (server components & route handlers). Null when signed out. */
export async function getCurrentUser(): Promise<User | null> {
  return userFromToken(await readCookieToken());
}

/** For route handlers: returns the user or throws HttpError(401). */
export async function requireApiUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "unauthenticated", "Please sign in to continue.");
  return user;
}

/** For pages: returns the user or redirects to /login (demo-aware). */
export async function requirePageUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Issue a session cookie for a user (sets it on the response via next/headers cookies()). */
export async function createSession(user: User, tokenVersion?: number): Promise<void> {
  let version = tokenVersion;
  if (version === undefined) {
    const record = await findUserById(user.id);
    if (!record) throw new HttpError(401, "unauthenticated", "Account not found.");
    version = record.tokenVersion;
  }
  const token = await signSessionToken({ sub: user.id, v: version });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
