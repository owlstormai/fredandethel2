import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Memory, User } from "@/lib/types";

vi.mock("@/lib/memory/service", () => ({
  rememberMemory: vi.fn(),
  forgetMemory: vi.fn(),
  recallMemories: vi.fn(),
  recordConsent: vi.fn(),
  setPreferredName: vi.fn(),
  setHumorLevel: vi.fn(),
  hasConsent: vi.fn(),
  getPreferences: vi.fn(),
}));
vi.mock("@/lib/database/conversations", () => ({
  getConversation: vi.fn(),
  appendMessage: vi.fn(),
}));
vi.mock("@/lib/ai/tools/search", () => ({
  searchWeb: vi.fn(),
}));
vi.mock("@/lib/memory/personalityService", () => ({
  recordToneObservation: vi.fn(),
}));

import { dispatchTool, TOOL_OUTPUTS } from "@/lib/ai/tools/dispatcher";
import { searchWeb } from "@/lib/ai/tools/search";
import { appendMessage, getConversation } from "@/lib/database/conversations";
import { recordToneObservation } from "@/lib/memory/personalityService";
import {
  forgetMemory,
  recallMemories,
  recordConsent,
  rememberMemory,
  setHumorLevel,
  setPreferredName,
} from "@/lib/memory/service";
import { resetRateLimits } from "@/lib/privacy/rateLimit";

const user: User = { id: "11111111-1111-4111-8111-111111111111", email: "u@example.com", isDemo: false, demoSlug: null, createdAt: "2026-01-01T00:00:00Z" };
const conversationId = "22222222-2222-4222-8222-222222222222";
const conversation = { id: conversationId, userId: user.id, mode: "live", status: "active" } as unknown as Conversation;
const memory = (over: Partial<Memory> = {}): Memory => ({
  id: "33333333-3333-4333-8333-333333333333",
  userId: user.id,
  kind: "relationship",
  category: "family",
  content: "Her daughter Anne lives in Ohio.",
  status: "confirmed",
  sensitivity: "normal",
  importance: 3,
  sourceConversationId: conversationId,
  sourceMessageId: null,
  lastReferencedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  ...over,
});

const call = (name: string, args: Record<string, unknown>) => dispatchTool(user, { conversationId, callId: "call_1", name, arguments: args });

describe("dispatchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    vi.mocked(getConversation).mockResolvedValue(conversation);
  });

  it("404s when the conversation does not belong to the user", async () => {
    vi.mocked(getConversation).mockResolvedValue(null);
    await expect(call("remember", {})).rejects.toMatchObject({ status: 404, code: "conversation_not_found" });
    expect(getConversation).toHaveBeenCalledWith(user.id, conversationId);
  });

  it("returns 'Unknown tool.' for unknown names (HTTP 200 semantics)", async () => {
    await expect(call("launch_missiles", {})).resolves.toEqual({ output: TOOL_OUTPUTS.unknown });
  });

  it("explains invalid arguments to the model instead of failing", async () => {
    const result = await call("set_humor_level", { level: "loud" });
    expect(result.output).toMatch(/^Invalid arguments for set_humor_level: level:/);
    expect(result.uiAction).toBeUndefined();
    expect(setHumorLevel).not.toHaveBeenCalled();
  });

  it("remember -> consent_required returns the consent_prompt uiAction", async () => {
    vi.mocked(rememberMemory).mockResolvedValue({ ok: false, reason: "consent_required" });
    const result = await call("remember", {
      content: "Her daughter Anne lives in Ohio.",
      kind: "relationship",
      category: "family",
      sensitivity: "normal",
      user_confirmed: true,
      user_words: "yes please",
    });
    expect(result).toEqual({ output: TOOL_OUTPUTS.consentRequired, uiAction: { type: "consent_prompt", scope: "memory" } });
    expect(rememberMemory).toHaveBeenCalledWith(user.id, {
      content: "Her daughter Anne lives in Ohio.",
      kind: "relationship",
      category: "family",
      sensitivity: "normal",
      userConfirmed: true,
      userWords: "yes please",
      sourceConversationId: conversationId,
    });
  });

  it("remember -> sensitive_consent_required / tombstoned / duplicate / ok", async () => {
    const args = { content: "He takes blood pressure pills.", kind: "fact", category: "health", sensitivity: "sensitive", user_confirmed: true };
    vi.mocked(rememberMemory).mockResolvedValueOnce({ ok: false, reason: "sensitive_consent_required" });
    expect(await call("remember", args)).toEqual({
      output: TOOL_OUTPUTS.sensitiveConsentRequired,
      uiAction: { type: "consent_prompt", scope: "sensitive_memory" },
    });

    vi.mocked(rememberMemory).mockResolvedValueOnce({ ok: false, reason: "tombstoned" });
    expect(await call("remember", args)).toEqual({ output: TOOL_OUTPUTS.tombstoned });

    vi.mocked(rememberMemory).mockResolvedValueOnce({ ok: false, reason: "duplicate", existing: memory() });
    expect(await call("remember", args)).toEqual({ output: TOOL_OUTPUTS.duplicate });

    const saved = memory();
    vi.mocked(rememberMemory).mockResolvedValueOnce({ ok: true, memory: saved, status: "confirmed" });
    expect(await call("remember", args)).toEqual({
      output: TOOL_OUTPUTS.saved,
      uiAction: { type: "memory_saved", memoryId: saved.id, content: saved.content },
    });

    vi.mocked(rememberMemory).mockResolvedValueOnce({ ok: true, memory: memory({ status: "reported" }), status: "reported" });
    expect((await call("remember", { ...args, user_confirmed: false })).output).toBe(TOOL_OUTPUTS.savedUnconfirmed);
  });

  it("forget returns memory_deleted for the first deleted memory", async () => {
    vi.mocked(forgetMemory).mockResolvedValue({ deleted: [memory({ id: "a" }), memory({ id: "b" })] });
    const result = await call("forget", { text: "my knee" });
    expect(forgetMemory).toHaveBeenCalledWith(user.id, { text: "my knee" });
    expect(result.uiAction).toEqual({ type: "memory_deleted", memoryId: "a" });
    expect(result.output).toContain("Forgotten 2");

    vi.mocked(forgetMemory).mockResolvedValue({ deleted: [] });
    expect(await call("forget", { text: "nothing" })).toEqual({ output: TOOL_OUTPUTS.nothingToForget });
  });

  it("recall_memories returns a compact JSON list or a plain 'nothing' message", async () => {
    vi.mocked(recallMemories).mockResolvedValue([memory(), memory({ content: "Loves gardening.", status: "reported" })]);
    const result = await call("recall_memories", { query: "family" });
    expect(recallMemories).toHaveBeenCalledWith(user.id, "family", 8);
    expect(JSON.parse(result.output)).toEqual([
      { content: "Her daughter Anne lives in Ohio.", status: "confirmed" },
      { content: "Loves gardening.", status: "reported" },
    ]);
    vi.mocked(recallMemories).mockResolvedValue([]);
    expect(await call("recall_memories", { query: "x" })).toEqual({ output: TOOL_OUTPUTS.nothingRecalled });
  });

  it("record_consent stores voice evidence and returns output only", async () => {
    const result = await call("record_consent", { scope: "memory", granted: true, user_words: "Yes, go ahead and remember." });
    expect(recordConsent).toHaveBeenCalledWith(user.id, "memory", true, "voice", "Yes, go ahead and remember.");
    expect(result).toEqual({ output: "Consent recorded (memory: yes)." });
  });

  it("request_memory_consent shows the consent card", async () => {
    expect(await call("request_memory_consent", {})).toEqual({
      output: TOOL_OUTPUTS.consentPromptShown,
      uiAction: { type: "consent_prompt", scope: "memory" },
    });
  });

  it("set_preferred_name / set_humor_level / end_conversation map to their uiActions", async () => {
    expect(await call("set_preferred_name", { name: "Peg" })).toEqual({ output: "Name set to Peg.", uiAction: { type: "name_set", name: "Peg" } });
    expect(setPreferredName).toHaveBeenCalledWith(user.id, "Peg");
    expect(await call("set_humor_level", { level: "off" })).toEqual({ output: "Humor level set to off.", uiAction: { type: "humor_changed", level: "off" } });
    expect(setHumorLevel).toHaveBeenCalledWith(user.id, "off");
    expect(await call("end_conversation", {})).toEqual({ output: TOOL_OUTPUTS.ending, uiAction: { type: "end_conversation" } });
  });

  it("search_web persists a tool message with sources and returns answer + sources", async () => {
    vi.mocked(searchWeb).mockResolvedValue({
      answer: "It will be sunny and about sixty degrees.",
      sources: [{ title: "Weather Service", url: "https://weather.example/today" }],
      costUsd: 0.0101,
      searchCalls: 1,
      refused: false,
    });
    const result = await call("search_web", { query: "weather in Columbus today", reason: "asked" });
    expect(searchWeb).toHaveBeenCalledWith(user.id, conversationId, "weather in Columbus today", { reason: "asked" });
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        conversationId,
        role: "tool",
        toolName: "search_web",
        content: "It will be sunny and about sixty degrees.",
        sources: [{ title: "Weather Service", url: "https://weather.example/today" }],
      }),
    );
    expect(result.sources).toHaveLength(1);
    expect(JSON.parse(result.output)).toEqual({
      answer: "It will be sunny and about sixty degrees.",
      sources: [{ title: "Weather Service", url: "https://weather.example/today" }],
    });
  });

  it("search_web refusal is relayed without writing a transcript row", async () => {
    vi.mocked(searchWeb).mockResolvedValue({ answer: "Web search is turned off for this user.", sources: [], costUsd: 0, searchCalls: 0, refused: true, reason: "consent" });
    const result = await call("search_web", { query: "news" });
    expect(result).toEqual({ output: "Web search is turned off for this user." });
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("observe_tone stores the observation through the consent-gated service and answers 'Noted.' with no uiAction", async () => {
    vi.mocked(recordToneObservation).mockResolvedValue({
      id: "t1", userId: user.id, conversationId, messageId: null, tone: "joy", intensity: 0.7, intent: "reminiscing", cue: "laughed", source: "model", createdAt: "2026-01-01T00:00:00Z",
    });
    const result = await call("observe_tone", { tone: "joy", intensity: 0.7, intent: "reminiscing", cue: "laughed while telling the story", serious: false });
    expect(result).toEqual({ output: TOOL_OUTPUTS.toneNoted });
    expect(recordToneObservation).toHaveBeenCalledWith(user.id, {
      conversationId,
      tone: "joy",
      intensity: 0.7,
      intent: "reminiscing",
      cue: "laughed while telling the story",
      source: "model",
    });
  });

  it("observe_tone still answers behaviourally when memory is off (service stores nothing and returns null)", async () => {
    vi.mocked(recordToneObservation).mockResolvedValue(null);
    const upset = await call("observe_tone", { tone: "upset", intensity: 0.8, serious: false });
    expect(upset).toEqual({ output: TOOL_OUTPUTS.toneSerious });
    expect(recordToneObservation).toHaveBeenCalledTimes(1);
    // Explicit `serious` escalates regardless of tone; mild distress does not.
    expect(await call("observe_tone", { tone: "neutral", intensity: 0.2, serious: true })).toEqual({ output: TOOL_OUTPUTS.toneSerious });
    expect(await call("observe_tone", { tone: "frustration", intensity: 0.4, serious: false })).toEqual({ output: TOOL_OUTPUTS.toneNoted });
    expect(await call("observe_tone", { tone: "frustration", intensity: 0.6, serious: false })).toEqual({ output: TOOL_OUTPUTS.toneSerious });
    // It never touches the saved humor preference.
    expect(setHumorLevel).not.toHaveBeenCalled();
    // Bad arguments are explained, not thrown.
    expect((await call("observe_tone", { tone: "grumpy", intensity: 2, serious: false })).output).toMatch(/^Invalid arguments for observe_tone/);
  });

  it("turns service failures into a graceful output for the model", async () => {
    vi.mocked(setPreferredName).mockRejectedValue(new Error("not implemented: setPreferredName"));
    expect(await call("set_preferred_name", { name: "Peg" })).toEqual({ output: TOOL_OUTPUTS.failed });
  });

  it("rate limits at 60 calls per minute per user", async () => {
    for (let i = 0; i < 60; i += 1) await call("end_conversation", {});
    await expect(call("end_conversation", {})).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
});

describe("dispatchTool keeps paid search out of demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
  });

  it("refuses search_web for a demo user without calling the search service", async () => {
    vi.mocked(getConversation).mockResolvedValue({ ...conversation, mode: "demo" } as Conversation);
    const demoUser: User = { ...user, email: null, isDemo: true, demoSlug: "margaret" };
    const result = await dispatchTool(demoUser, { conversationId, callId: "call_1", name: "search_web", arguments: { query: "news today" } });
    expect(result).toEqual({ output: TOOL_OUTPUTS.searchNotLive });
    expect(searchWeb).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("refuses search_web on a demo-mode conversation even for a regular user, but other tools still run", async () => {
    vi.mocked(getConversation).mockResolvedValue({ ...conversation, mode: "demo" } as Conversation);
    expect(await call("search_web", { query: "news today" })).toEqual({ output: TOOL_OUTPUTS.searchNotLive });
    expect(searchWeb).not.toHaveBeenCalled();
    vi.mocked(setHumorLevel).mockResolvedValue(undefined);
    expect(await call("set_humor_level", { level: "off" })).toEqual({ output: "Humor level set to off.", uiAction: { type: "humor_changed", level: "off" } });
  });
});
