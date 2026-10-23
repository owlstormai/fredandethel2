import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}

describe("proxy auth gate", () => {
  it("redirects signed-out visitors away from protected pages", () => {
    const response = proxy(request("/memory"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
  it("lets cookie holders through to protected pages", () => {
    const response = proxy(request("/talk", "companion_session=abc"));
    expect(response.headers.get("location")).toBeNull();
  });
  it("sends signed-in users from /login and /signup to /talk", () => {
    const response = proxy(request("/login", "companion_session=abc"));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/talk");
    expect(proxy(request("/signup")).headers.get("location")).toBeNull();
  });
  it("keeps the matcher tight", () => {
    expect(config.matcher).toEqual(["/talk/:path*", "/memory/:path*", "/settings/:path*", "/developer/:path*", "/login", "/signup"]);
  });
});
