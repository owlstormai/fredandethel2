import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => ({ cookies: async () => (await import("./helpers")).cookieJar }));
vi.mock("@/lib/usage/tracker", () => ({
  recordUsage: vi.fn(async () => ({ estimatedCostUsd: 0 })),
  checkCaps: vi.fn(async () => ({ allowed: true })),
  getUsageSummary: vi.fn(),
}));
vi.mock("@/lib/ai/summarize", () => ({ summarizeConversation: vi.fn(async () => null) }));

import { GET as getConversationRoute } from "@/app/api/conversations/[id]/route";
import { POST as eventsRoute } from "@/app/api/conversations/[id]/events/route";
import { POST as endRoute } from "@/app/api/conversations/[id]/end/route";
import { POST as demoTurnRoute } from "@/app/api/demo/turn/route";
import { GET as listMemoriesRoute } from "@/app/api/memories/route";
import { DELETE as deleteMemoryRoute, PATCH as patchMemoryRoute } from "@/app/api/memories/[id]/route";
import { createSession } from "@/lib/auth/session";
import { startConversation } from "@/lib/conversations/service";
import { getConversation, listMessages } from "@/lib/database/conversations";
import { getMemory } from "@/lib/database/memories";
import { recordConsent, rememberMemory, forgetMemory } from "@/lib/memory/service";
import type { MemoriesResponse } from "@/lib/api/contracts";
import type { Memory, User } from "@/lib/types";
import { cookieJar, createUser, ensureSchema, jsonRequest, params, readJson, teardown, truncateAll } from "./helpers";

let a: User;
let b: User;
let aMemory: Memory;
let aConversationId: string;

beforeAll(ensureSchema);
beforeEach(async () => {
  await truncateAll();
  cookieJar.reset();
  a = (await createUser({ preferredName: "Ann" })).user;
  b = (await createUser({ preferredName: "Ben" })).user;
  await recordConsent(a.id, "memory", true, "ui");
  const saved = await rememberMemory(a.id, { content: "Ann's cat is called Biscuit", kind: "fact", category: "other", sensitivity: "normal", userConfirmed: true });
  if (!saved.ok) throw new Error("setup failed");
  aMemory = saved.memory;
  aConversationId = (await startConversation(a, { mode: "demo", modelKey: "full" })).id;
  await createSession(b); // B is signed in for the route calls below
});
afterAll(teardown);

describe("user B cannot touch user A's data", () => {
  it("memories list is scoped and A's memory is invisible to B", async () => {
    const body = await readJson<MemoriesResponse>(await listMemoriesRoute());
    expect(body.memories).toEqual([]);
    expect(body.tombstones).toBe(0);
  });

  it("PATCH and DELETE on A's memory are 404 for B and change nothing", async () => {
    const patch = await patchMemoryRoute(jsonRequest(`/api/memories/${aMemory.id}`, "PATCH", { content: "hacked" }), params(aMemory.id));
    expect(patch.status).toBe(404);
    const del = await deleteMemoryRoute(jsonRequest(`/api/memories/${aMemory.id}`, "DELETE"), params(aMemory.id));
    expect(del.status).toBe(404);
    const still = await getMemory(a.id, aMemory.id);
    expect(still?.content).toBe("Ann's cat is called Biscuit");
    expect(still?.deletedAt).toBeNull();
  });

  it("service-layer forget by id is a no-op across users", async () => {
    const { deleted } = await forgetMemory(b.id, { memoryId: aMemory.id });
    expect(deleted).toEqual([]);
    expect((await getMemory(a.id, aMemory.id))?.deletedAt).toBeNull();
  });

  it("conversation read, events, end and demo turn are 404 for B", async () => {
    expect((await getConversationRoute(jsonRequest(`/api/conversations/${aConversationId}`, "GET"), params(aConversationId))).status).toBe(404);
    const events = await eventsRoute(
      jsonRequest(`/api/conversations/${aConversationId}/events`, "POST", { events: [{ type: "message", role: "user", content: "injected" }] }),
      params(aConversationId),
    );
    expect(events.status).toBe(404);
    expect((await endRoute(jsonRequest(`/api/conversations/${aConversationId}/end`, "POST"), params(aConversationId))).status).toBe(404);
    expect((await demoTurnRoute(jsonRequest("/api/demo/turn", "POST", { conversationId: aConversationId, text: "hello" }))).status).toBe(404);

    expect(await listMessages(a.id, aConversationId)).toEqual([]);
    expect((await getConversation(a.id, aConversationId))?.status).toBe("active");
    expect(await getConversation(b.id, aConversationId)).toBeNull();
  });
});
