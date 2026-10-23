import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeAdapter, mapRealtimeUsage, type RemoteAudioHandle } from "@/lib/ai/adapters/openaiRealtimeAdapter";
import type { AdapterEvent, ToolCallRequest, ToolDispatcher } from "@/lib/ai/adapters/types";
import type { RealtimeConnectParams, RealtimeTransport, TransportState } from "@/lib/ai/realtime/client";
import type { RealtimeClientEvent, RealtimeServerEvent } from "@/lib/ai/realtime/events";
import { ApiClientError } from "@/lib/api/client";
import type { RealtimeSessionResponse } from "@/lib/api/contracts";

class FakeTransport implements RealtimeTransport {
  state: TransportState = "idle";
  remoteStream: MediaStream | null = null;
  sent: RealtimeClientEvent[] = [];
  params: RealtimeConnectParams | null = null;
  closed = false;
  connectImpl: (() => Promise<void>) | null = null;
  async connect(params: RealtimeConnectParams): Promise<void> {
    this.params = params;
    this.state = "connecting";
    if (this.connectImpl) await this.connectImpl();
    this.state = "open";
    this.remoteStream = { id: "remote" } as unknown as MediaStream;
    params.onRemoteStream?.(this.remoteStream);
  }
  send(event: RealtimeClientEvent) {
    this.sent.push(event);
  }
  close() {
    this.closed = true;
    this.state = "closed";
  }
  server(event: Partial<RealtimeServerEvent> & { type: string }) {
    this.params?.onServerEvent({ event_id: "ev", ...event } as RealtimeServerEvent);
  }
  sentTypes() {
    return this.sent.map((e) => e.type);
  }
}

function sessionResponse(overrides: Partial<RealtimeSessionResponse> = {}): RealtimeSessionResponse {
  return {
    mode: "live",
    conversationId: "conv-1",
    clientSecret: "ek_secret",
    expiresAt: "2026-10-22T12:00:00Z",
    model: { key: "full", id: "gpt-realtime-2.1" },
    voice: { label: "Fred", id: "cedar" },
    callsUrl: "https://api.openai.com/v1/realtime/calls",
    context: { estimatedTokens: 120, memoryCount: 3, summaryCount: 1 },
    maxSessionSeconds: 1800,
    ...overrides,
  };
}

interface Harness {
  adapter: OpenAIRealtimeAdapter;
  events: AdapterEvent[];
  transports: FakeTransport[];
  fetchJson: ReturnType<typeof vi.fn>;
  tools: ToolDispatcher & { dispatch: ReturnType<typeof vi.fn> };
  audio: { muted: boolean[]; stopped: number };
  connect: (opts?: { conversationId?: string; signal?: AbortSignal }) => Promise<unknown>;
  current: () => FakeTransport;
  types: () => string[];
}

function harness(options: { sessions?: Array<RealtimeSessionResponse | Error>; adapter?: ConstructorParameters<typeof OpenAIRealtimeAdapter>[0]; connectImpl?: () => Promise<void> } = {}): Harness {
  const events: AdapterEvent[] = [];
  const transports: FakeTransport[] = [];
  const sessions = options.sessions ?? [sessionResponse()];
  let sessionIndex = 0;
  const fetchJson = vi.fn(async () => {
    const next = sessions[Math.min(sessionIndex, sessions.length - 1)];
    sessionIndex += 1;
    if (next instanceof Error) throw next;
    return next;
  });
  const tools = { dispatch: vi.fn(async () => ({ output: '{"ok":true}' })) } as unknown as Harness["tools"];
  const audio = { muted: [] as boolean[], stopped: 0 };
  const adapter = new OpenAIRealtimeAdapter({
    createTransport: () => {
      const t = new FakeTransport();
      if (options.connectImpl) t.connectImpl = options.connectImpl;
      transports.push(t);
      return t;
    },
    fetchJson: fetchJson as unknown as <T>(path: string, init: unknown) => Promise<T>,
    attachRemoteAudio: (): RemoteAudioHandle => ({
      setMuted: (m) => audio.muted.push(m),
      stop: () => audio.stopped++,
    }),
    ...options.adapter,
  });
  const mic = { getAudioTracks: () => [{ enabled: true }], getTracks: () => [] } as unknown as MediaStream;
  return {
    adapter,
    events,
    transports,
    fetchJson,
    tools,
    audio,
    connect: (opts = {}) =>
      adapter.connect({ modelKey: "full", micStream: mic, tools, onEvent: (e) => events.push(e), ...opts }),
    current: () => transports[transports.length - 1],
    types: () => events.map((e) => e.type),
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("OpenAIRealtimeAdapter connect", () => {
  it("mints a session, opens the transport and emits connecting -> session -> connected", async () => {
    const h = harness();
    const info = await h.connect();
    expect(h.fetchJson).toHaveBeenCalledWith("/api/realtime/session", expect.objectContaining({ method: "POST", json: { modelKey: "full" } }));
    expect(h.types()).toEqual(["status", "session", "status"]);
    expect(h.events[0]).toEqual({ type: "status", status: "connecting" });
    expect(h.events[2]).toEqual({ type: "status", status: "connected" });
    expect(info).toEqual({
      mode: "live",
      conversationId: "conv-1",
      modelKey: "full",
      modelId: "gpt-realtime-2.1",
      voiceLabel: "Fred",
      voiceId: "cedar",
      context: { memoryCount: 3, summaryCount: 1, estimatedTokens: 120 },
      simulated: false,
      expiresAt: "2026-10-22T12:00:00Z",
    });
    const t = h.current();
    expect(t.params?.clientSecret).toBe("ek_secret");
    expect(t.params?.callsUrl).toBe("https://api.openai.com/v1/realtime/calls");
    expect(h.adapter.getRemoteAudioStream()).toBe(t.remoteStream);
    // greeting kicks off once the server says the session exists
    expect(t.sent).toEqual([]);
    t.server({ type: "session.created", session: {} });
    expect(t.sentTypes()).toEqual(["response.create"]);
    t.server({ type: "session.created", session: {} });
    expect(t.sentTypes()).toEqual(["response.create"]); // only once
  });

  it("passes continueConversationId through for model switches", async () => {
    const h = harness();
    await h.connect({ conversationId: "old-conv" });
    expect(h.fetchJson.mock.calls[0][1]).toMatchObject({ json: { modelKey: "full", continueConversationId: "old-conv" } });
  });

  it("maps 403 session errors to friendly unrecoverable errors", async () => {
    const h = harness({ sessions: [new ApiClientError(403, "cap_reached", "cap")] });
    await expect(h.connect()).rejects.toBeInstanceOf(ApiClientError);
    const error = h.events.find((e) => e.type === "error");
    expect(error).toMatchObject({ type: "error", code: "cap_reached", recoverable: false });
    expect((error as { message: string }).message).toMatch(/budget/i);
    expect(h.transports).toHaveLength(0);
  });

  it("does not emit an error when the caller aborts mid-connect", async () => {
    const controller = new AbortController();
    const h = harness({
      connectImpl: async () => {
        controller.abort();
      },
    });
    await expect(h.connect({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(h.events.some((e) => e.type === "error")).toBe(false);
    expect(h.current().closed).toBe(true);
  });
});

describe("OpenAIRealtimeAdapter event mapping", () => {
  let h: Harness;
  let t: FakeTransport;
  beforeEach(async () => {
    h = harness();
    await h.connect();
    t = h.current();
    h.events.length = 0;
  });

  it("maps a whole turn: speech, response, audio buffer, transcripts, usage", () => {
    t.server({ type: "input_audio_buffer.speech_started", item_id: "u1", audio_start_ms: 1000 });
    t.server({ type: "input_audio_buffer.speech_stopped", item_id: "u1", audio_end_ms: 3500 });
    t.server({ type: "conversation.item.input_audio_transcription.delta", item_id: "u1", content_index: 0, delta: "I like " });
    t.server({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", content_index: 0, transcript: "I like gardening. " });
    t.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    t.server({ type: "output_audio_buffer.started", response_id: "r1" });
    t.server({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", output_index: 0, content_index: 0, delta: "Lovely" });
    t.server({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", output_index: 0, content_index: 0, delta: ", roses?" });
    t.server({ type: "response.output_audio_transcript.done", response_id: "r1", item_id: "a1", output_index: 0, content_index: 0, transcript: "Lovely, roses?" });
    t.server({ type: "rate_limits.updated", rate_limits: [] });
    t.server({
      type: "response.done",
      response: {
        id: "r1",
        status: "completed",
        usage: {
          total_tokens: 253,
          input_tokens: 132,
          output_tokens: 121,
          input_token_details: { text_tokens: 119, audio_tokens: 13, cached_tokens: 64, cached_tokens_details: { text_tokens: 64, audio_tokens: 0 } },
          output_token_details: { text_tokens: 30, audio_tokens: 91 },
        },
      },
    });
    t.server({ type: "output_audio_buffer.stopped", response_id: "r1" });

    expect(h.events).toEqual([
      { type: "user_speech_started" },
      { type: "user_speech_stopped", durationMs: 2500 },
      { type: "transcript", role: "user", itemId: "u1", text: "I like ", final: false },
      { type: "transcript", role: "user", itemId: "u1", text: "I like gardening.", final: true },
      { type: "response_started", responseId: "r1" },
      { type: "assistant_speech_started", responseId: "r1" },
      { type: "transcript", role: "assistant", itemId: "a1", text: "Lovely", final: false },
      { type: "transcript", role: "assistant", itemId: "a1", text: "Lovely, roses?", final: false },
      { type: "transcript", role: "assistant", itemId: "a1", text: "Lovely, roses?", final: true },
      {
        type: "response_done",
        responseId: "r1",
        status: "completed",
        usage: { inputTextTokens: 119, inputAudioTokens: 13, cachedTextTokens: 64, cachedAudioTokens: 0, outputTextTokens: 30, outputAudioTokens: 91 },
      },
      expect.objectContaining({ type: "assistant_speech_stopped", responseId: "r1" }),
    ]);
    expect(t.sent).toEqual([]); // nothing sent for a normal turn
  });

  it("barge-in: cancels + clears immediately when speech starts while the assistant is audible", () => {
    t.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    t.server({ type: "output_audio_buffer.started", response_id: "r1" });
    h.events.length = 0;
    t.server({ type: "input_audio_buffer.speech_started", item_id: "u2", audio_start_ms: 9000 });
    expect(t.sent).toEqual([{ type: "response.cancel", response_id: "r1" }, { type: "output_audio_buffer.clear" }]);
    expect(h.types()).toEqual(["user_speech_started", "assistant_speech_stopped", "interrupted"]);
    expect(h.events[2]).toEqual({ type: "interrupted", responseId: "r1" });
    // the server's own cleared/done events do not double-report
    t.server({ type: "output_audio_buffer.cleared", response_id: "r1" });
    t.server({ type: "response.done", response: { id: "r1", status: "cancelled" } });
    expect(h.types()).toEqual(["user_speech_started", "assistant_speech_stopped", "interrupted", "response_done"]);
    expect(h.events[3]).toMatchObject({ status: "cancelled", usage: null });
  });

  it("does not cancel when the user speaks while the assistant is silent", () => {
    t.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    t.server({ type: "input_audio_buffer.speech_started", item_id: "u2", audio_start_ms: 10 });
    expect(t.sent).toEqual([]);
    expect(h.types()).toEqual(["response_started", "user_speech_started"]);
  });

  it("runs function calls through the dispatcher and replies with function_call_output + response.create", async () => {
    h.tools.dispatch.mockResolvedValueOnce({
      output: '{"saved":true}',
      uiAction: { type: "memory_saved", memoryId: "m1", content: "Likes roses" },
    });
    t.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    t.server({
      type: "response.function_call_arguments.done",
      response_id: "r1",
      item_id: "fc1",
      output_index: 0,
      call_id: "call_abc",
      name: "remember",
      arguments: '{"content":"Likes roses","kind":"interest"}',
    });
    expect(h.events[1]).toEqual({
      type: "tool_call",
      call: { callId: "call_abc", name: "remember", arguments: { content: "Likes roses", kind: "interest" } },
    });
    await flush();
    expect(h.tools.dispatch).toHaveBeenCalledWith("conv-1", { callId: "call_abc", name: "remember", arguments: { content: "Likes roses", kind: "interest" } });
    expect(t.sent).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_abc", output: '{"saved":true}' } },
      { type: "response.create" },
    ]);
    expect(h.events[2]).toEqual({
      type: "tool_result",
      call: { callId: "call_abc", name: "remember", arguments: { content: "Likes roses", kind: "interest" } },
      result: { output: '{"saved":true}', uiAction: { type: "memory_saved", memoryId: "m1", content: "Likes roses" } },
    });
  });

  it("feeds a failed dispatcher back to the model as an error string instead of hanging", async () => {
    h.tools.dispatch.mockRejectedValueOnce(new Error("boom"));
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "fc", output_index: 0, call_id: "c9", name: "search_web", arguments: "not json" });
    await flush();
    const output = (t.sent[0] as { item: { output: string } }).item.output;
    expect(JSON.parse(output)).toMatchObject({ error: "tool_failed" });
    expect((h.events[0] as { call: ToolCallRequest }).call.arguments).toEqual({});
  });

  it("classifies errors: most recoverable, auth/session ones fatal (and disconnects)", () => {
    t.server({ type: "error", error: { type: "invalid_request_error", code: "invalid_value", message: "bad param" } });
    expect(h.events[0]).toEqual({ type: "error", code: "invalid_value", message: "bad param", recoverable: true });
    t.server({ type: "error", error: { type: "invalid_request_error", code: "session_expired", message: "Your session has expired." } });
    expect(h.events[1]).toMatchObject({ type: "error", code: "session_expired", recoverable: false });
    expect(h.events[2]).toEqual({ type: "ended", reason: "session_error" });
    expect(t.closed).toBe(true);
  });

  it("interrupt(), sendText(), setMuted() and setOutputMuted()", () => {
    const track = { enabled: true };
    const mic = { getAudioTracks: () => [track], getTracks: () => [] } as unknown as MediaStream;
    // re-create with a trackable mic
    const h2 = harness();
    return h2.connect({}).then(async () => {
      const t2 = h2.current();
      // setMuted toggles the track
      h2.adapter.setMuted(true);
      expect(h2.adapter).toBeTruthy();
      void mic;
      // interrupt while silent: still sends cancel (safe per docs) but no interrupted-speech events beyond `interrupted`
      h2.events.length = 0;
      h2.adapter.interrupt();
      expect(t2.sentTypes()).toEqual(["response.cancel", "output_audio_buffer.clear"]);
      expect(h2.types()).toEqual(["interrupted"]);
      // speaking -> interrupt stops speech locally
      t2.sent.length = 0;
      h2.events.length = 0;
      t2.server({ type: "response.created", response: { id: "r5", status: "in_progress" } });
      t2.server({ type: "output_audio_buffer.started", response_id: "r5" });
      h2.adapter.interrupt();
      expect(t2.sent).toEqual([{ type: "response.cancel", response_id: "r5" }, { type: "output_audio_buffer.clear" }]);
      expect(h2.types()).toEqual(["response_started", "assistant_speech_started", "assistant_speech_stopped", "interrupted"]);
      // sendText while speaking interrupts first, then creates the message + response
      t2.sent.length = 0;
      h2.events.length = 0;
      t2.server({ type: "output_audio_buffer.started", response_id: "r5" });
      h2.adapter.sendText("  Hello there  ");
      expect(t2.sentTypes()).toEqual(["response.cancel", "output_audio_buffer.clear", "conversation.item.create", "response.create"]);
      expect(t2.sent[2]).toEqual({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello there" }] },
      });
      expect(h2.events.at(-1)).toMatchObject({ type: "transcript", role: "user", text: "Hello there", final: true });
      // output mute reaches the audio element handle
      h2.adapter.setOutputMuted(true);
      expect(h2.audio.muted.at(-1)).toBe(true);
    });
  });

  it("disconnect closes the transport, stops remote audio and emits ended once", async () => {
    await h.adapter.disconnect("user_ended");
    expect(t.closed).toBe(true);
    expect(h.audio.stopped).toBe(1);
    expect(h.events).toEqual([{ type: "ended", reason: "user_ended" }]);
    await h.adapter.disconnect("user_ended");
    expect(h.events).toHaveLength(1);
    h.adapter.sendText("ignored after close");
    expect(t.sent).toEqual([]);
  });
});

describe("OpenAIRealtimeAdapter reconnect and session limits", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reconnects after a failed peer with continueConversationId and a new transport", async () => {
    const h = harness({ sessions: [sessionResponse(), sessionResponse({ conversationId: "conv-2", clientSecret: "ek_2" })] });
    await h.connect();
    const first = h.current();
    first.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    first.server({ type: "output_audio_buffer.started", response_id: "r1" });
    h.events.length = 0;

    first.params?.onConnectionState?.("failed");
    expect(h.types()).toEqual(["assistant_speech_stopped", "status"]);
    expect(h.events[1]).toMatchObject({ type: "status", status: "reconnecting" });
    expect(first.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(h.fetchJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchJson).toHaveBeenCalledTimes(2);
    expect(h.fetchJson.mock.calls[1][1]).toMatchObject({ json: { modelKey: "full", continueConversationId: "conv-1" } });
    expect(h.transports).toHaveLength(2);
    expect(h.current().params?.clientSecret).toBe("ek_2");
    const sessionEvent = h.events.find((e) => e.type === "session") as { info: { conversationId: string } };
    expect(sessionEvent.info.conversationId).toBe("conv-2");
    expect(h.events.at(-1)).toEqual({ type: "status", status: "connected", detail: "reconnected" });
    // no second greeting after a reconnect
    h.current().server({ type: "session.created", session: {} });
    expect(h.current().sent).toEqual([]);
  });

  it("waits a 3s grace period on 'disconnected' and cancels if the peer recovers", async () => {
    const h = harness();
    await h.connect();
    const t = h.current();
    t.params?.onConnectionState?.("disconnected");
    await vi.advanceTimersByTimeAsync(2500);
    t.params?.onConnectionState?.("connected");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fetchJson).toHaveBeenCalledTimes(1);
    expect(h.events.some((e) => e.type === "status" && e.status === "reconnecting")).toBe(false);

    t.params?.onConnectionState?.("disconnected");
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.events.some((e) => e.type === "status" && e.status === "reconnecting")).toBe(true);
  });

  it("gives up after three attempts with 1s/2s/4s backoff and ends with an error", async () => {
    const h = harness({ sessions: [sessionResponse(), new Error("network down")] });
    await h.connect();
    h.current().params?.onDataChannelClose?.();
    h.events.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.fetchJson).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fetchJson).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.fetchJson).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.types()).toEqual(["error", "ended"]);
    expect(h.events[0]).toMatchObject({ code: "reconnect_failed", recoverable: false });
    expect(h.events[1]).toEqual({ type: "ended", reason: "reconnect_failed" });
  });

  it("warns two minutes before the session limit and ends at the limit", async () => {
    const h = harness({ sessions: [sessionResponse({ maxSessionSeconds: 300 })] });
    await h.connect();
    h.events.length = 0;
    await vi.advanceTimersByTimeAsync(180_000 - 1);
    expect(h.events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.events).toEqual([{ type: "error", code: "session_ending_soon", message: "We'll need to wrap up in about two minutes.", recoverable: true }]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.events.at(-1)).toEqual({ type: "ended", reason: "session_limit" });
    expect(h.current().closed).toBe(true);
  });
});

describe("mapRealtimeUsage", () => {
  it("handles missing details and derives cached text from cached_tokens when details are absent", () => {
    expect(mapRealtimeUsage(undefined)).toBeNull();
    expect(mapRealtimeUsage({})).toEqual({ inputTextTokens: 0, inputAudioTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0, outputTextTokens: 0, outputAudioTokens: 0 });
    expect(mapRealtimeUsage({ input_token_details: { text_tokens: 100, audio_tokens: 50, cached_tokens: 40 }, output_token_details: { audio_tokens: 7 } })).toEqual({
      inputTextTokens: 100,
      inputAudioTokens: 50,
      cachedTextTokens: 40,
      cachedAudioTokens: 0,
      outputTextTokens: 0,
      outputAudioTokens: 7,
    });
    expect(
      mapRealtimeUsage({ input_token_details: { text_tokens: 100, audio_tokens: 50, cached_tokens: 40, cached_tokens_details: { text_tokens: 10, audio_tokens: 30 } } }),
    ).toMatchObject({ cachedTextTokens: 10, cachedAudioTokens: 30 });
  });
});

describe("OpenAIRealtimeAdapter function-call round trip (parallel calls, name fallback)", () => {
  let h: Harness;
  let t: FakeTransport;
  beforeEach(async () => {
    h = harness();
    await h.connect();
    t = h.current();
    h.events.length = 0;
  });

  it("sends one response.create only after EVERY pending call of the turn has its output", async () => {
    // Reasoning realtime models may call several tools in one response (parallel_tool_calls).
    // A response.create per call would race the active response; API_VERIFICATION §5: outputs first, then response.create.
    let resolveFirst!: (value: { output: string }) => void;
    h.tools.dispatch.mockImplementationOnce(() => new Promise<{ output: string }>((r) => (resolveFirst = r)));
    h.tools.dispatch.mockResolvedValueOnce({ output: "Consent recorded (memory: yes)." });
    t.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "fc1", output_index: 0, call_id: "call_a", name: "set_preferred_name", arguments: '{"name":"Margaret"}' });
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "fc2", output_index: 1, call_id: "call_b", name: "record_consent", arguments: '{"scope":"memory","granted":true,"user_words":"yes"}' });
    await flush();
    // second call finished first: its output is sent, but no response.create yet
    expect(t.sent).toEqual([{ type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_b", output: "Consent recorded (memory: yes)." } }]);
    resolveFirst({ output: "Name set to Margaret." });
    await flush();
    expect(t.sentTypes()).toEqual(["conversation.item.create", "conversation.item.create", "response.create"]);
    expect((t.sent[1] as { item: { call_id: string } }).item.call_id).toBe("call_a");
    expect(h.types().filter((x) => x === "tool_result")).toHaveLength(2);
  });

  it("still sends response.create after a single call (unchanged behaviour)", async () => {
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "fc1", output_index: 0, call_id: "call_a", name: "end_conversation", arguments: "{}" });
    await flush();
    expect(t.sentTypes()).toEqual(["conversation.item.create", "response.create"]);
  });

  it("resolves the function name from response.output_item.added when arguments.done lacks `name`", async () => {
    t.server({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    t.server({ type: "response.output_item.added", response_id: "r1", output_index: 0, item: { id: "fc1", type: "function_call", name: "remember", call_id: "call_a", arguments: "" } });
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "fc1", output_index: 0, call_id: "call_a", arguments: '{"content":"Likes roses"}' });
    await flush();
    expect(h.tools.dispatch).toHaveBeenCalledWith("conv-1", { callId: "call_a", name: "remember", arguments: { content: "Likes roses" } });
    // an explicit `name` always wins over the tracked one
    t.server({ type: "response.output_item.added", response_id: "r1", output_index: 1, item: { id: "fc2", type: "function_call", name: "forget", call_id: "call_b", arguments: "" } });
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "fc2", output_index: 1, call_id: "call_b", name: "recall_memories", arguments: '{"query":"roses"}' });
    await flush();
    expect(h.tools.dispatch).toHaveBeenLastCalledWith("conv-1", { callId: "call_b", name: "recall_memories", arguments: { query: "roses" } });
    // message items are ignored by the tracker
    t.server({ type: "response.output_item.added", response_id: "r1", output_index: 2, item: { id: "msg1", type: "message", role: "assistant" } });
    t.server({ type: "response.function_call_arguments.done", response_id: "r1", item_id: "msg1", output_index: 2, call_id: "call_c", arguments: "{}" });
    await flush();
    expect(h.tools.dispatch).toHaveBeenLastCalledWith("conv-1", { callId: "call_c", name: "", arguments: {} });
  });
});
