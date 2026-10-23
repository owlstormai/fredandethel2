import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => ({ cookies: async () => (await import("./helpers")).cookieJar }));
const recordUsage = vi.fn<(input: Record<string, unknown>) => Promise<{ estimatedCostUsd: number }>>(async () => ({ estimatedCostUsd: 0.01 }));
vi.mock("@/lib/usage/tracker", () => ({
  recordUsage: (input: Record<string, unknown>) => recordUsage(input),
  checkCaps: vi.fn(async () => ({ allowed: true })),
  getUsageSummary: vi.fn(),
}));
const summarizeConversation = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
vi.mock("@/lib/ai/summarize", () => ({ summarizeConversation: (...args: unknown[]) => summarizeConversation(...args) }));

import { GET as listRoute, POST as createRoute } from "@/app/api/conversations/route";
import { GET as getRoute } from "@/app/api/conversations/[id]/route";
import { POST as eventsRoute } from "@/app/api/conversations/[id]/events/route";
import { POST as endRoute } from "@/app/api/conversations/[id]/end/route";
import { createSession } from "@/lib/auth/session";
import { ensureDemoUser } from "@/lib/auth/demo";
import { finishConversation, startConversation } from "@/lib/conversations/service";
import { createConversation, getConversation, listMessages } from "@/lib/database/conversations";
import { listMemories } from "@/lib/database/memories";
import { buildMemoryContext, recordConsent, rememberMemory, forgetMemory } from "@/lib/memory/service";
import { DEFAULT_TRANSCRIPTION_MODEL } from "@/lib/ai/models";
import type { ConversationResponse, ConversationWithMessages, ConversationsListResponse, EndConversationResponse } from "@/lib/api/contracts";
import type { User } from "@/lib/types";
import { cookieJar, createUser, ensureSchema, jsonRequest, params, readJson, teardown, truncateAll } from "./helpers";

let user: User;

beforeAll(ensureSchema);
beforeEach(async () => {
  await truncateAll();
  cookieJar.reset();
  recordUsage.mockClear();
  summarizeConversation.mockReset();
  summarizeConversation.mockResolvedValue(null);
  user = (await createUser({ preferredName: "Margaret" })).user;
  await createSession(user);
});
afterAll(teardown);

describe("conversation routes", () => {
  it("creates, lists and reads conversations; live is refused when not configured", async () => {
    const created = await createRoute(jsonRequest("/api/conversations", "POST", { mode: "demo", modelKey: "mini" }));
    expect(created.status).toBe(201);
    const { conversation } = await readJson<ConversationResponse>(created);
    expect(conversation).toMatchObject({ mode: "demo", modelKey: "mini", modelId: "demo-simulated", status: "active", userId: user.id });

    const live = await createRoute(jsonRequest("/api/conversations", "POST", { mode: "live", modelKey: "full" }));
    expect(live.status).toBe(409);

    const list = await readJson<ConversationsListResponse>(await listRoute(jsonRequest("/api/conversations?limit=5", "GET")));
    expect(list.conversations.map((c) => c.id)).toEqual([conversation.id]);

    const one = await readJson<ConversationWithMessages>(await getRoute(jsonRequest(`/api/conversations/${conversation.id}`, "GET"), params(conversation.id)));
    expect(one.id).toBe(conversation.id);
    expect(one.messages).toEqual([]);
    expect((await getRoute(jsonRequest("/api/conversations/00000000-0000-0000-0000-000000000000", "GET"), params("00000000-0000-0000-0000-000000000000"))).status).toBe(404);
  });

  it("demo users are always demo and continuing requires an owned conversation", async () => {
    const demo = (await ensureDemoUser("walter"))!;
    const conversation = await startConversation(demo, { mode: "live", modelKey: "full" });
    expect(conversation.mode).toBe("demo");
    const continued = await startConversation(demo, { mode: "demo", modelKey: "mini", continueConversationId: conversation.id });
    expect(continued.continuedFromId).toBe(conversation.id);
    await expect(startConversation(user, { mode: "demo", modelKey: "full", continueConversationId: conversation.id })).rejects.toMatchObject({ status: 404 });
  });

  it("records events: messages (deduplicated by itemId), usage via tracker, speech and connected seconds", async () => {
    const { conversation } = await readJson<ConversationResponse>(await createRoute(jsonRequest("/api/conversations", "POST", { mode: "demo", modelKey: "full" })));
    const response = await eventsRoute(
      jsonRequest(`/api/conversations/${conversation.id}/events`, "POST", {
        events: [
          { type: "message", role: "user", content: "Hello th", itemId: "item_1" },
          { type: "message", role: "user", content: "Hello there", itemId: "item_1" },
          { type: "message", role: "assistant", content: "Hi Margaret", itemId: "item_2", sources: [{ title: "Example", url: "https://example.com/" }] },
          { type: "usage", responseId: "resp_1", inputTextTokens: 10, inputAudioTokens: 20, cachedTextTokens: 0, cachedAudioTokens: 0, outputTextTokens: 5, outputAudioTokens: 30 },
          { type: "speech", speaker: "user", seconds: 4.5 },
          { type: "speech", speaker: "assistant", seconds: 6 },
          { type: "connected", seconds: 30 },
          { type: "client_error", code: "mic_denied", message: "Permission denied" },
        ],
      }),
      params(conversation.id),
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true, received: 8, stored: 8 });

    const messages = await listMessages(user.id, conversation.id);
    expect(messages.map((m) => [m.seq, m.role, m.content])).toEqual([
      [1, "user", "Hello there"],
      [2, "assistant", "Hi Margaret"],
    ]);
    expect(messages[1].sources).toEqual([{ title: "Example", url: "https://example.com/" }]);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({ userId: user.id, conversationId: conversation.id, modelId: "demo-simulated", kind: "realtime_response", inputAudioTokens: 20 });
    const stored = await getConversation(user.id, conversation.id);
    expect(stored).toMatchObject({ userSpeechSeconds: 4.5, assistantSpeechSeconds: 6, connectedSeconds: 30 });
  });

  it("records transcription usage for the user's speech on a live conversation only", async () => {
    const live = await createConversation({ userId: user.id, mode: "live", modelKey: "full", modelId: "gpt-realtime-2.1" });
    const response = await eventsRoute(
      jsonRequest(`/api/conversations/${live.id}/events`, "POST", {
        events: [
          { type: "speech", speaker: "user", seconds: 12 },
          { type: "speech", speaker: "assistant", seconds: 9 },
        ],
      }),
      params(live.id),
    );
    expect(await readJson(response)).toEqual({ ok: true, received: 2, stored: 2 });
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toEqual({ userId: user.id, conversationId: live.id, modelId: DEFAULT_TRANSCRIPTION_MODEL, kind: "transcription", durationSeconds: 12 });

    recordUsage.mockClear();
    recordUsage.mockRejectedValueOnce(new Error("tracker down"));
    const failed = await eventsRoute(jsonRequest(`/api/conversations/${live.id}/events`, "POST", { events: [{ type: "speech", speaker: "user", seconds: 3 }] }), params(live.id));
    expect(await readJson(failed)).toEqual({ ok: true, received: 1, stored: 1 }); // the speech seconds were stored
    expect((await getConversation(user.id, live.id))?.userSpeechSeconds).toBe(15);
  });

  it("usage recording failure does not fail the batch", async () => {
    recordUsage.mockRejectedValueOnce(new Error("tracker down"));
    const conversation = await startConversation(user, { mode: "demo", modelKey: "full" });
    const response = await eventsRoute(
      jsonRequest(`/api/conversations/${conversation.id}/events`, "POST", {
        events: [{ type: "usage", inputTextTokens: 1, inputAudioTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0, outputTextTokens: 0, outputAudioTokens: 0 }],
      }),
      params(conversation.id),
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true, received: 1, stored: 0 });
  });
});

describe("ending a conversation", () => {
  const GARDEN = "I spent the whole morning in my garden pulling weeds and the tomatoes are finally coming in.";
  const LILY = "My granddaughter Lily has a violin recital next week and I'm nervous for her.";
  const CANCER = "I was diagnosed with cancer last week and I'm frightened about what comes next.";

  async function talk(conversationId: string, userLines: string[] = [GARDEN, LILY]) {
    const events = [
      { type: "message", role: "user", content: userLines[0] },
      { type: "message", role: "assistant", content: "That sounds like a good morning." },
      ...userLines.slice(1).map((content) => ({ type: "message", role: "user", content })),
    ];
    await eventsRoute(jsonRequest(`/api/conversations/${conversationId}/events`, "POST", { events }), params(conversationId));
  }

  /** Live conversations cannot be started without an OpenAI key, so tests create the row directly. */
  async function liveConversation() {
    return createConversation({ userId: user.id, mode: "live", modelKey: "full", modelId: "gpt-realtime-2.1" });
  }

  it("without memory consent: ends, the paid summarizer is NOT called, nothing stored or saved", async () => {
    const conversation = await startConversation(user, { mode: "demo", modelKey: "full" });
    await talk(conversation.id);
    const response = await endRoute(jsonRequest(`/api/conversations/${conversation.id}/end`, "POST"), params(conversation.id));
    expect(response.status).toBe(200);
    const body = await readJson<EndConversationResponse>(response);
    expect(body.conversation.status).toBe("ended");
    expect(body.conversation.endedAt).not.toBeNull();
    expect(body.summary).toBeNull();
    expect(body.suggestedMemories).toEqual([]);
    expect(await listMemories(user.id)).toEqual([]);
    expect(summarizeConversation).not.toHaveBeenCalled();

    // Memory off on a LIVE conversation: still no paid call (nothing could be stored).
    const live = await liveConversation();
    await talk(live.id);
    const ended = await finishConversation(user.id, live.id);
    expect(ended.summary).toBeNull();
    expect(summarizeConversation).not.toHaveBeenCalled();
  });

  it("with memory on, demo conversation: heuristic summary stored as a 'summary' memory, third person, tombstone-filtered; summarizer never called", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    const saved = await rememberMemory(user.id, { content: "My granddaughter Lily plays the violin", kind: "relationship", category: "family", sensitivity: "normal", userConfirmed: true });
    if (!saved.ok) throw new Error("setup");
    await forgetMemory(user.id, { memoryId: saved.memory.id }); // tombstone: granddaughter lily play violin

    const conversation = await startConversation(user, { mode: "demo", modelKey: "full" });
    await talk(conversation.id);
    const body = await readJson<EndConversationResponse>(await endRoute(jsonRequest(`/api/conversations/${conversation.id}/end`, "POST"), params(conversation.id)));
    expect(body.summary).not.toBeNull();
    expect(body.summary).toMatchObject({ kind: "summary", status: "summarized", sourceConversationId: conversation.id });
    expect(body.summary!.content).not.toMatch(/\bI\b|\bmy\b/);
    expect(body.summary!.content).toMatch(/Margaret/);
    expect(body.summary!.content).toMatch(/garden/);
    expect(body.summary!.content).not.toMatch(/Lily|violin/); // tombstoned sentence dropped
    expect(body.conversation.summaryMemoryId).toBe(body.summary!.id);

    // Idempotent; and a demo conversation never spends money on summarization.
    const again = await readJson<EndConversationResponse>(await endRoute(jsonRequest(`/api/conversations/${conversation.id}/end`, "POST"), params(conversation.id)));
    expect(again.summary?.id).toBe(body.summary!.id);
    expect(summarizeConversation).not.toHaveBeenCalled();

    const context = await buildMemoryContext(user.id, {});
    expect(context.summaryIds).toEqual([body.summary!.id]);
    expect(context.block).toMatch(/Recent conversation summaries:/);
  });

  it("live + memory on: the summarizer IS called (with allowSensitive reflecting consent); reported candidates stored as reported, inferred as inferred (suggested, never injected), tombstoned dropped", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    const saved = await rememberMemory(user.id, { content: "Granddaughter Lily plays the violin", kind: "relationship", category: "family", sensitivity: "normal", userConfirmed: true });
    if (!saved.ok) throw new Error("setup");
    await forgetMemory(user.id, { memoryId: saved.memory.id });
    summarizeConversation.mockResolvedValue({
      summary: "Margaret talked about her garden and the coming tomato harvest.",
      modelId: "gpt-test",
      candidates: [
        { content: "Margaret grows tomatoes in her garden", kind: "interest", category: "interest", sensitivity: "normal", status: "reported" },
        { content: "Margaret may be anxious about public events", kind: "fact", category: "other", sensitivity: "normal", status: "inferred" },
        { content: "Granddaughter Lily plays the violin", kind: "relationship", category: "family", sensitivity: "normal", status: "reported" },
        { content: "Margaret takes blood pressure medication", kind: "fact", category: "health", sensitivity: "sensitive", status: "reported" },
      ],
    });
    const conversation = await liveConversation();
    await talk(conversation.id);
    const body = await finishConversation(user.id, conversation.id);
    expect(summarizeConversation).toHaveBeenCalledTimes(1);
    expect(summarizeConversation.mock.calls[0][3]).toMatchObject({ preferredName: "Margaret", allowSensitive: false });
    expect(body.summary?.content).toBe("Margaret talked about her garden and the coming tomato harvest.");
    expect(body.summary?.sensitivity).toBe("normal");
    expect(body.suggestedMemories.map((m) => [m.content, m.status])).toEqual([["Margaret may be anxious about public events", "inferred"]]);

    const memories = await listMemories(user.id, { excludeKinds: ["summary"] });
    expect(memories.map((m) => [m.content, m.status]).sort()).toEqual([
      ["Margaret grows tomatoes in her garden", "reported"],
      ["Margaret may be anxious about public events", "inferred"],
    ]);
    const context = await buildMemoryContext(user.id, {});
    expect(context.block).toMatch(/tomatoes/);
    expect(context.block).not.toMatch(/anxious|Lily|blood pressure/);
  });

  it("summarizer failure falls back to the heuristic summary", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    summarizeConversation.mockRejectedValue(new Error("boom"));
    const conversation = await liveConversation();
    await talk(conversation.id);
    const body = await finishConversation(user.id, conversation.id);
    expect(summarizeConversation).toHaveBeenCalledTimes(1);
    expect(body.summary?.status).toBe("summarized");
    expect(body.summary?.content).toMatch(/garden/);
  });

  describe("summaries respect sensitive consent", () => {
    it("heuristic: without sensitive consent a health disclosure never reaches the summary; nothing left means no summary", async () => {
      await recordConsent(user.id, "memory", true, "ui");
      const conversation = await startConversation(user, { mode: "demo", modelKey: "full" });
      await talk(conversation.id, [GARDEN, CANCER]);
      const body = await finishConversation(user.id, conversation.id);
      expect(summarizeConversation).not.toHaveBeenCalled();
      expect(body.summary).not.toBeNull();
      expect(body.summary!.content).toMatch(/garden/);
      expect(body.summary!.content).not.toMatch(/cancer|diagnosed|frightened/i);
      expect(body.summary!.sensitivity).toBe("normal");
      expect(JSON.stringify(await listMemories(user.id))).not.toMatch(/cancer/i);

      const onlySensitive = await startConversation(user, { mode: "demo", modelKey: "full" });
      await talk(onlySensitive.id, [CANCER]);
      const nothing = await finishConversation(user.id, onlySensitive.id);
      expect(nothing.summary).toBeNull();
      expect((await getConversation(user.id, onlySensitive.id))?.summaryMemoryId).toBeNull();
    });

    it("heuristic: with sensitive consent the disclosure is kept and the summary is labelled sensitive", async () => {
      await recordConsent(user.id, "memory", true, "ui");
      await recordConsent(user.id, "sensitive_memory", true, "ui");
      const conversation = await startConversation(user, { mode: "demo", modelKey: "full" });
      await talk(conversation.id, [CANCER]);
      const body = await finishConversation(user.id, conversation.id);
      expect(body.summary?.content).toMatch(/Margaret was diagnosed with cancer/);
      expect(body.summary?.sensitivity).toBe("sensitive");
      expect((await buildMemoryContext(user.id, {})).block).toMatch(/cancer/);
    });

    it("AI: a summary that still carries sensitive detail is stored as sensitive and injected only once sensitive consent is granted", async () => {
      await recordConsent(user.id, "memory", true, "ui");
      summarizeConversation.mockResolvedValue({
        summary: "Margaret said she was diagnosed with cancer last week and is frightened.",
        modelId: "gpt-test",
        candidates: [],
      });
      const conversation = await liveConversation();
      await talk(conversation.id, [CANCER]);
      const body = await finishConversation(user.id, conversation.id);
      expect(summarizeConversation.mock.calls[0][3]).toMatchObject({ allowSensitive: false });
      expect(body.summary?.sensitivity).toBe("sensitive");

      const withoutConsent = await buildMemoryContext(user.id, {});
      expect(withoutConsent.block).not.toMatch(/cancer/i);
      expect(withoutConsent.summaryIds).toEqual([]);

      await recordConsent(user.id, "sensitive_memory", true, "ui");
      const withConsent = await buildMemoryContext(user.id, {});
      expect(withConsent.summaryIds).toEqual([body.summary!.id]);
      expect(withConsent.block).toMatch(/cancer/i);

      // And the summarizer is told to keep sensitive detail once consent exists.
      summarizeConversation.mockClear();
      const second = await liveConversation();
      await talk(second.id, [GARDEN]);
      await finishConversation(user.id, second.id);
      expect(summarizeConversation.mock.calls[0][3]).toMatchObject({ allowSensitive: true });
    });
  });
});
