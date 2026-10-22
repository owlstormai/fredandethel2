import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationEventSchema } from "@/lib/api/contracts";
import { TelemetryBatcher, createTelemetryMapper, type ConversationTelemetryEvent } from "@/components/voice/telemetry";

describe("createTelemetryMapper", () => {
  it("maps final transcripts, usage, speech durations, sources and errors to schema-valid events", () => {
    let clock = 1000;
    const map = createTelemetryMapper(() => clock);
    const out: ConversationTelemetryEvent[] = [];
    const push = (events: ConversationTelemetryEvent[]) => out.push(...events);

    push(map({ type: "transcript", role: "user", itemId: "u1", text: "hel", final: false }));
    push(map({ type: "transcript", role: "user", itemId: "u1", text: "  hello  ", final: true }));
    push(map({ type: "transcript", role: "assistant", itemId: "a0", text: "   ", final: true }));
    push(map({ type: "user_speech_started" }));
    clock = 3500;
    push(map({ type: "user_speech_stopped" }));
    push(map({ type: "user_speech_stopped", durationMs: 1234 }));
    push(map({ type: "assistant_speech_started", responseId: "r1" }));
    clock = 5000;
    push(map({ type: "assistant_speech_stopped", responseId: "r1" }));
    push(map({ type: "tool_result", call: { callId: "c", name: "search_web", arguments: {} }, result: { output: "{}", sources: [{ title: "BBC", url: "https://www.bbc.co.uk/news" }] } }));
    push(map({ type: "transcript", role: "assistant", itemId: "a1", text: "It is sunny.", final: true }));
    push(map({ type: "transcript", role: "assistant", itemId: "a2", text: "Anything else?", final: true }));
    push(
      map({
        type: "response_done",
        responseId: "r1",
        status: "completed",
        usage: { inputTextTokens: 1, inputAudioTokens: 2, cachedTextTokens: 3, cachedAudioTokens: 4, outputTextTokens: 5, outputAudioTokens: 6 },
      }),
    );
    push(map({ type: "response_done", responseId: "r2", status: "cancelled", usage: null }));
    push(map({ type: "error", code: "session_ending_soon", message: "Two minutes.", recoverable: true }));
    push(map({ type: "level", source: "assistant", level: 0.4 }));

    expect(out).toEqual([
      { type: "message", role: "user", content: "hello", itemId: "u1" },
      { type: "speech", speaker: "user", seconds: 2.5 },
      { type: "speech", speaker: "user", seconds: 1.234 },
      { type: "speech", speaker: "assistant", seconds: 1.5 },
      { type: "message", role: "assistant", content: "It is sunny.", itemId: "a1", sources: [{ title: "BBC", url: "https://www.bbc.co.uk/news" }] },
      { type: "message", role: "assistant", content: "Anything else?", itemId: "a2" },
      { type: "usage", responseId: "r1", inputTextTokens: 1, inputAudioTokens: 2, cachedTextTokens: 3, cachedAudioTokens: 4, outputTextTokens: 5, outputAudioTokens: 6 },
      { type: "client_error", code: "session_ending_soon", message: "Two minutes." },
    ]);
    for (const event of out) expect(conversationEventSchema.safeParse(event).success).toBe(true);
  });
});

describe("TelemetryBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make(post = vi.fn(async () => {}), beacon = vi.fn(() => true)) {
    let clock = 0;
    const batcher = new TelemetryBatcher({ conversationId: "conv-1", post, beacon, now: () => clock, flushIntervalMs: 5000, connectedIntervalMs: 30_000 });
    return { batcher, post, beacon, tick: (ms: number) => (clock += ms) };
  }

  it("flushes every 5 seconds, emits connected deltas every 30 seconds and a final one on stop", async () => {
    const { batcher, post, tick } = make();
    batcher.start();
    batcher.push({ type: "message", role: "user", content: "hi" });
    expect(post).not.toHaveBeenCalled();
    tick(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(["conv-1", [{ type: "message", role: "user", content: "hi" }]]);
    // nothing queued: no empty posts
    tick(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
    // connected delta after 30s total
    tick(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const connected = post.mock.calls.flatMap((c) => (c as unknown as [string, ConversationTelemetryEvent[]])[1]).filter((e) => e.type === "connected");
    expect(connected).toEqual([{ type: "connected", seconds: 30 }]);
    tick(12_000);
    await batcher.stop();
    const all = post.mock.calls.flatMap((c) => (c as unknown as [string, ConversationTelemetryEvent[]])[1]);
    expect(all.filter((e) => e.type === "connected")).toEqual([{ type: "connected", seconds: 30 }, { type: "connected", seconds: 12 }]);
    batcher.push({ type: "message", role: "user", content: "late" });
    expect(batcher.pending).toBe(0);
  });

  it("re-queues on failure and sends with a beacon on page hide", async () => {
    const post = vi.fn(async () => {
      throw new Error("offline");
    });
    const beacon = vi.fn(() => true);
    const { batcher } = make(post, beacon);
    batcher.start();
    batcher.push({ type: "speech", speaker: "user", seconds: 1 });
    await batcher.flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(batcher.pending).toBe(1);
    expect(batcher.flushWithBeacon()).toBe(true);
    expect(beacon).toHaveBeenCalledWith("conv-1", [{ type: "speech", speaker: "user", seconds: 1 }]);
    expect(batcher.pending).toBe(0);
  });

  it("falls back to fetch when the beacon is refused", async () => {
    const post = vi.fn(async () => {});
    const beacon = vi.fn(() => false);
    const { batcher } = make(post, beacon);
    batcher.push({ type: "speech", speaker: "assistant", seconds: 2 });
    expect(batcher.flushWithBeacon()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("splits large queues into batches of 200", async () => {
    const { batcher, post } = make();
    for (let i = 0; i < 450; i++) batcher.push({ type: "speech", speaker: "user", seconds: 1 });
    await batcher.flush();
    expect(post).toHaveBeenCalledTimes(3);
    expect((post.mock.calls[0] as unknown as [string, unknown[]])[1]).toHaveLength(200);
    expect((post.mock.calls[2] as unknown as [string, unknown[]])[1]).toHaveLength(50);
  });
});
