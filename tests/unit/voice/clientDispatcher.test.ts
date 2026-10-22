import { describe, expect, it, vi } from "vitest";
import { ClientToolDispatcher, narrowUiAction } from "@/lib/ai/tools/clientDispatcher";
import { ApiClientError } from "@/lib/api/client";

describe("narrowUiAction", () => {
  it("accepts well-formed actions and rejects everything else", () => {
    expect(narrowUiAction({ type: "consent_prompt", scope: "memory" })).toEqual({ type: "consent_prompt", scope: "memory" });
    expect(narrowUiAction({ type: "consent_prompt", scope: "transcripts" })).toBeUndefined();
    expect(narrowUiAction({ type: "memory_saved", memoryId: "m", content: "c" })).toEqual({ type: "memory_saved", memoryId: "m", content: "c" });
    expect(narrowUiAction({ type: "memory_saved", memoryId: 1 })).toBeUndefined();
    expect(narrowUiAction({ type: "memory_deleted", memoryId: "m" })).toEqual({ type: "memory_deleted", memoryId: "m" });
    expect(narrowUiAction({ type: "humor_changed", level: "playful" })).toEqual({ type: "humor_changed", level: "playful" });
    expect(narrowUiAction({ type: "humor_changed", level: "loud" })).toBeUndefined();
    expect(narrowUiAction({ type: "name_set", name: "Peg" })).toEqual({ type: "name_set", name: "Peg" });
    expect(narrowUiAction({ type: "end_conversation", extra: 1 })).toEqual({ type: "end_conversation" });
    expect(narrowUiAction({ type: "launch_missiles" })).toBeUndefined();
    expect(narrowUiAction(null)).toBeUndefined();
    expect(narrowUiAction("x")).toBeUndefined();
  });
});

describe("ClientToolDispatcher", () => {
  it("posts to /api/tools/dispatch and maps the response", async () => {
    const fetchJson = vi.fn(async () => ({ output: "Saved.", sources: [{ title: "A", url: "https://a.example" }], uiAction: { type: "memory_saved", memoryId: "m1", content: "x" } }));
    const dispatcher = new ClientToolDispatcher(fetchJson as unknown as <T>(p: string, i: unknown) => Promise<T>);
    const result = await dispatcher.dispatch("conv", { callId: "c1", name: "remember", arguments: { content: "x" } });
    expect(fetchJson).toHaveBeenCalledWith("/api/tools/dispatch", { method: "POST", json: { conversationId: "conv", callId: "c1", name: "remember", arguments: { content: "x" } } });
    expect(result).toEqual({ output: "Saved.", sources: [{ title: "A", url: "https://a.example" }], uiAction: { type: "memory_saved", memoryId: "m1", content: "x" } });
  });

  it("never throws: HTTP failures become a JSON error output for the model", async () => {
    const fetchJson = vi.fn(async () => {
      throw new ApiClientError(429, "rate_limited", "Slow down");
    });
    const dispatcher = new ClientToolDispatcher(fetchJson as unknown as <T>(p: string, i: unknown) => Promise<T>);
    const result = await dispatcher.dispatch("conv", { callId: "c1", name: "search_web", arguments: {} });
    expect(JSON.parse(result.output)).toEqual({ error: "rate_limited", message: "Slow down" });
    expect(result.uiAction).toBeUndefined();
  });
});
