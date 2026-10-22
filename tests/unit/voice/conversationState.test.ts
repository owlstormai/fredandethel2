import { describe, expect, it } from "vitest";
import type { AdapterEvent, AdapterSessionInfo } from "@/lib/ai/adapters/types";
import {
  conversationReducer,
  connectedSeconds,
  deriveOrbState,
  describeStatus,
  initialConversationState,
  INTERRUPTED_HOLD_MS,
  type ConversationAction,
  type ConversationState,
} from "@/lib/ai/realtime/conversationState";

const session: AdapterSessionInfo = {
  mode: "live",
  conversationId: "c1",
  modelKey: "full",
  modelId: "gpt-realtime-2.1",
  voiceLabel: "Fred",
  voiceId: "cedar",
  context: { memoryCount: 2, summaryCount: 1, estimatedTokens: 300 },
  simulated: false,
  expiresAt: null,
};

/** Reduce a timed sequence: [atMs, action]. */
function run(steps: Array<[number, ConversationAction]>, start = initialConversationState(0)): ConversationState {
  return steps.reduce((state, [at, action]) => conversationReducer(state, { ...action, at } as ConversationAction), start);
}

const connectSteps: Array<[number, ConversationAction]> = [
  [0, { type: "mic", status: "requesting" }],
  [100, { type: "mic", status: "granted" }],
  [100, { type: "status", status: "connecting" }],
  [900, { type: "session", info: session }],
  [1000, { type: "status", status: "connected" }],
];

describe("conversationReducer: connection", () => {
  it("starts offline, shows connecting while the mic is requested and the session opens", () => {
    let state = initialConversationState(0);
    expect(state.orb).toBe("offline");
    state = conversationReducer(state, { type: "mic", status: "requesting", at: 0 });
    expect(state.connection).toBe("requesting_mic");
    expect(state.orb).toBe("connecting");
    state = conversationReducer(state, { type: "status", status: "connecting", at: 10 });
    expect(state.orb).toBe("connecting");
    state = conversationReducer(state, { type: "status", status: "connected", at: 1000 });
    expect(state.connection).toBe("connected");
    expect(state.orb).toBe("idle");
    expect(state.connectedSince).toBe(1000);
  });

  it("records a mic denial and returns to disconnected with the error available", () => {
    const err = { code: "denied" as const, message: "Blocked." };
    const state = run([
      [0, { type: "mic", status: "requesting" }],
      [50, { type: "mic", status: "denied", error: err }],
    ]);
    expect(state.connection).toBe("disconnected");
    expect(state.micError).toEqual(err);
    expect(state.orb).toBe("offline");
    expect(describeStatus(state, "Fred")).toBe("Blocked.");
  });

  it("stores session info", () => {
    const state = run(connectSteps);
    expect(state.session?.conversationId).toBe("c1");
    expect(state.session?.simulated).toBe(false);
  });
});

describe("conversationReducer: a full turn with barge-in", () => {
  it("greeting -> user speaks -> thinking -> speaking -> barge-in -> interrupted -> listening -> idle", () => {
    const steps: Array<[number, ConversationAction]> = [
      ...connectSteps,
      // greeting
      [1100, { type: "response_started", responseId: "r1" }],
      [1500, { type: "assistant_speech_started", responseId: "r1" }],
      [1600, { type: "transcript", role: "assistant", itemId: "a1", text: "Hello", final: false }],
      [1700, { type: "transcript", role: "assistant", itemId: "a1", text: "Hello there", final: true }],
      [1800, { type: "response_done", responseId: "r1", status: "completed", usage: null }],
      [3500, { type: "assistant_speech_stopped", responseId: "r1" }],
    ];
    let state = run(steps);
    expect(state.orb).toBe("idle");
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ role: "assistant", text: "Hello there", final: true });
    expect(state.latenciesMs).toEqual([400]);
    expect(state.assistantSpeechSeconds).toBeCloseTo(2, 5);
    expect(state.responses).toBe(1);

    // user speaks
    state = run(
      [
        [4000, { type: "user_speech_started" }],
        [4100, { type: "transcript", role: "user", itemId: "u1", text: "I like", final: false }],
      ],
      state,
    );
    expect(state.orb).toBe("listening");
    expect(describeStatus(state, "Fred")).toBe("Listening");

    state = run([[6500, { type: "user_speech_stopped", durationMs: 2400 }]], state);
    expect(state.orb).toBe("thinking");
    expect(state.userSpeechSeconds).toBeCloseTo(2.4, 5);

    state = run(
      [
        [6600, { type: "transcript", role: "user", itemId: "u1", text: "I like gardening", final: true }],
        [6700, { type: "response_started", responseId: "r2" }],
      ],
      state,
    );
    expect(state.orb).toBe("thinking");
    expect(state.transcript[1]).toMatchObject({ role: "user", text: "I like gardening", final: true });

    state = run([[7300, { type: "assistant_speech_started", responseId: "r2" }]], state);
    expect(state.orb).toBe("speaking");
    expect(describeStatus(state, "Fred")).toContain("Fred is speaking");

    // barge-in: adapter emits user_speech_started then interrupted (+ assistant_speech_stopped)
    state = run(
      [
        [8000, { type: "user_speech_started" }],
        [8000, { type: "interrupted", responseId: "r2" }],
        [8050, { type: "assistant_speech_stopped", responseId: "r2" }],
      ],
      state,
    );
    expect(state.orb).toBe("interrupted");
    expect(state.interruptions).toBe(1);
    expect(state.assistantSpeaking).toBe(false);
    expect(state.userSpeaking).toBe(true);

    // interrupted hold expires -> user is still speaking -> listening
    state = conversationReducer(state, { type: "tick", now: 8000 + INTERRUPTED_HOLD_MS });
    expect(state.orb).toBe("listening");

    state = run(
      [
        [9000, { type: "user_speech_stopped" }],
        [9100, { type: "response_done", responseId: "r2", status: "cancelled", usage: null }],
      ],
      state,
    );
    expect(state.orb).toBe("thinking");
    expect(state.userSpeechSeconds).toBeCloseTo(3.4, 5); // 2.4 + 1.0 wall clock

    state = run(
      [
        [9200, { type: "response_started", responseId: "r3" }],
        [9700, { type: "assistant_speech_started", responseId: "r3" }],
        [9800, { type: "response_done", responseId: "r3", status: "completed", usage: null }],
        [12000, { type: "assistant_speech_stopped", responseId: "r3" }],
      ],
      state,
    );
    expect(state.orb).toBe("idle");
    expect(state.responses).toBe(3);
  });

  it("stays thinking after a cancelled response when a new response is pending via tool", () => {
    const state = run([
      ...connectSteps,
      [2000, { type: "user_speech_started" }],
      [3000, { type: "user_speech_stopped" }],
      [3100, { type: "response_started", responseId: "r1" }],
      [3500, { type: "tool_call", call: { callId: "c1", name: "search_web", arguments: { query: "weather" } } }],
      [3600, { type: "response_done", responseId: "r1", status: "completed", usage: null }],
    ]);
    expect(state.orb).toBe("thinking");
    expect(state.activeTool).toBe("search_web");
    expect(describeStatus(state, "Fred")).toBe("Looking that up…");
    const after = run(
      [[4500, { type: "tool_result", call: { callId: "c1", name: "search_web", arguments: {} }, result: { output: "{}", sources: [{ title: "BBC", url: "https://bbc.co.uk" }] } }]],
      state,
    );
    expect(after.activeTool).toBeNull();
    expect(after.orb).toBe("thinking");
    const spoken = run(
      [
        [4600, { type: "response_started", responseId: "r2" }],
        [5000, { type: "assistant_speech_started", responseId: "r2" }],
        [5100, { type: "transcript", role: "assistant", itemId: "a2", text: "Sunny.", final: true }],
      ],
      after,
    );
    expect(spoken.transcript[0].sources).toEqual([{ title: "BBC", url: "https://bbc.co.uk" }]);
    expect(spoken.pendingSources).toBeNull();
  });
});

describe("conversationReducer: mute, errors, reconnect, end", () => {
  it("muted shows the muted orb only when nobody is speaking", () => {
    let state = run([...connectSteps, [1100, { type: "set_muted", muted: true }]]);
    expect(state.orb).toBe("muted");
    expect(describeStatus(state, "Fred")).toContain("Microphone is off");
    state = run([[1200, { type: "response_started", responseId: "r1" }], [1500, { type: "assistant_speech_started", responseId: "r1" }]], state);
    expect(state.orb).toBe("speaking");
    state = run([[2500, { type: "assistant_speech_stopped", responseId: "r1" }], [2500, { type: "response_done", responseId: "r1", status: "completed", usage: null }]], state);
    expect(state.orb).toBe("muted");
    state = run([[2600, { type: "set_muted", muted: false }]], state);
    expect(state.orb).toBe("idle");
  });

  it("recoverable errors keep the connection; unrecoverable ones put the orb in error", () => {
    let state = run([...connectSteps, [2000, { type: "error", code: "session_ending_soon", message: "Two minutes left.", recoverable: true }]]);
    expect(state.connection).toBe("connected");
    expect(state.orb).toBe("idle");
    expect(describeStatus(state, "Fred")).toBe("Two minutes left.");
    state = run([[3000, { type: "error", code: "invalid_client_secret", message: "Session expired.", recoverable: false }]], state);
    expect(state.connection).toBe("error");
    expect(state.orb).toBe("error");
    expect(describeStatus(state, "Fred")).toBe("Session expired.");
  });

  it("reconnecting shows connecting, then clears in-flight flags when connected again", () => {
    let state = run([
      ...connectSteps,
      [2000, { type: "response_started", responseId: "r1" }],
      [2500, { type: "assistant_speech_started", responseId: "r1" }],
      [3000, { type: "status", status: "reconnecting" }],
    ]);
    expect(state.orb).toBe("connecting");
    expect(describeStatus(state, "Fred")).toContain("Reconnecting");
    state = run([[4500, { type: "session", info: { ...session, conversationId: "c2" } }], [4600, { type: "status", status: "connected" }]], state);
    expect(state.connection).toBe("connected");
    expect(state.orb).toBe("idle");
    expect(state.session?.conversationId).toBe("c2");
    expect(state.connectedSince).toBe(1000); // original connect time kept
  });

  it("ended closes speech timers and reports offline", () => {
    const state = run([
      ...connectSteps,
      [2000, { type: "response_started", responseId: "r1" }],
      [2500, { type: "assistant_speech_started", responseId: "r1" }],
      [4500, { type: "ended", reason: "user_ended" }],
    ]);
    expect(state.connection).toBe("ended");
    expect(state.orb).toBe("offline");
    expect(state.assistantSpeechSeconds).toBeCloseTo(2, 5);
    expect(state.endedReason).toBe("user_ended");
    expect(connectedSeconds(state)).toBe(4);
  });

  it("accumulates usage across responses", () => {
    const usage = { inputTextTokens: 10, inputAudioTokens: 20, cachedTextTokens: 5, cachedAudioTokens: 0, outputTextTokens: 7, outputAudioTokens: 30 };
    const state = run([
      ...connectSteps,
      [2000, { type: "response_done", responseId: "r1", status: "completed", usage }],
      [3000, { type: "response_done", responseId: "r2", status: "completed", usage }],
    ]);
    expect(state.usage).toEqual({ inputTextTokens: 20, inputAudioTokens: 40, cachedTextTokens: 10, cachedAudioTokens: 0, outputTextTokens: 14, outputAudioTokens: 60 });
    expect(state.responses).toBe(2);
  });

  it("level events clamp and reset when speech stops", () => {
    let state = run([...connectSteps, [2000, { type: "level", source: "assistant", level: 1.7 }]]);
    expect(state.outputLevel).toBe(1);
    state = run([[2100, { type: "assistant_speech_started", responseId: "r1" }], [2200, { type: "assistant_speech_stopped", responseId: "r1" }]], state);
    expect(state.outputLevel).toBe(0);
  });

  it("reset returns to the initial state but keeps the mute choice", () => {
    const state = run([...connectSteps, [1100, { type: "set_muted", muted: true }], [1200, { type: "reset" }]]);
    expect(state.connection).toBe("disconnected");
    expect(state.muted).toBe(true);
    expect(state.transcript).toEqual([]);
  });

  it("deriveOrbState precedence: error > interrupted > listening > speaking > thinking > muted > idle", () => {
    const base: ConversationState = { ...initialConversationState(1000), connection: "connected", now: 1000 };
    expect(deriveOrbState({ ...base, lastError: { code: "x", message: "", recoverable: false } })).toBe("error");
    expect(deriveOrbState({ ...base, interruptedAt: 900, userSpeaking: true })).toBe("interrupted");
    expect(deriveOrbState({ ...base, interruptedAt: 100, userSpeaking: true, assistantSpeaking: true })).toBe("listening");
    expect(deriveOrbState({ ...base, assistantSpeaking: true, awaitingResponse: true })).toBe("speaking");
    expect(deriveOrbState({ ...base, awaitingResponse: true, muted: true })).toBe("thinking");
    expect(deriveOrbState({ ...base, muted: true })).toBe("muted");
    expect(deriveOrbState(base)).toBe("idle");
  });

  it("ignores events it does not know and duplicate speech starts", () => {
    const state = run([...connectSteps, [2000, { type: "user_speech_started" }], [2500, { type: "user_speech_started" }]]);
    expect(state.userSpeechStartedAt).toBe(2000);
    const weird = conversationReducer(state, { type: "bogus" } as unknown as AdapterEvent);
    expect(weird.connection).toBe("connected");
  });
});
