import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/health/route";
import type { HealthResponse } from "@/lib/api/contracts";
import { ensureSchema, teardown } from "./helpers";

beforeAll(ensureSchema);
afterAll(teardown);

describe("GET /api/health", () => {
  it("reports database and live-mode status", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    const body = (await response.json()) as HealthResponse;
    expect(body).toMatchObject({ ok: true, db: "ok", liveConfigured: false });
    expect(typeof body.version).toBe("string");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
