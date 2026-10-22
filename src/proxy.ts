/**
 * Edge-side auth gate (Next.js 16 `proxy`, formerly middleware).
 *
 * This is deliberately optimistic: it only checks that the session cookie is
 * PRESENT. Signature, expiry and token_version are verified in pages and routes
 * via `requirePageUser` / `requireApiUser`, which is where authorization really
 * happens. The proxy exists so signed-out visitors land on /login instead of a
 * flash of an empty app shell, and signed-in users skip the auth pages.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "companion_session";
const PROTECTED_PREFIXES = ["/talk", "/memory", "/settings", "/developer"];
const AUTH_PAGES = new Set(["/login", "/signup"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = pathname === "/talk" ? "" : `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (AUTH_PAGES.has(pathname) && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/talk";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/talk/:path*", "/memory/:path*", "/settings/:path*", "/developer/:path*", "/login", "/signup"],
};
