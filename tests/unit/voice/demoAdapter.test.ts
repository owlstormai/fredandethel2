// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DemoAdapter,
  GREETING_TEXT,
  PAUSE_WINDOW_MS,
  SPEECH_END_GRACE_MS,
  SPEECH_START_WATCHDOG_MS,
  pairUiActions,
  pickVoice,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  type SpeechSynthesisUtteranceLike,
} from "@/lib/ai/adapters/demoAdapter";
import type { AdapterEvent } from "@/lib/ai/adapters/types";
import type { DemoTurnResponse } from "@/lib/api/contracts";

class FakeUtterance implements SpeechSynthesisUtteranceLike {
  rate = 1;
  pitch = 1;
  volume = 1;
  voice = null;
  onstart: ((e: unknown) => void) | null = null;
  onend: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onboundary: ((e: { name?: string; charIndex?: number }) => void) | null = null;
  constructor(public text: string) {}
}

class FakeSynth {
  utterances: FakeUtterance[] = [];
  cancelled = 0;
  voices = [
    { name: "Daniel", lang: "en-GB" },
    { name: "Samantha", lang: "en-US", default: true },
    { name: "Amelie", lang: "fr-FR" },
  ];
  /** normal: start+boundaries+end; silent: never fires start; stuck: start but never end */
  behavior: "normal" | "silent" | "stuck" = "normal";
  msPerWord = 100;
  getVoices() {
    return this.voices;
  }
  speak(u: SpeechSynthesisUtteranceLike) {
    this.utterances.push(u as FakeUtterance);
    if (this.behavior === "silent") return;
    setTimeout(() => u.onstart?.({}), 10);
    if (this.behavior === "stuck") return;
    const words = u.text.split(/\s+/).filter(Boolean);
    let charIndex = 0;
    words.forEach((w, i) => {
      const at = charIndex;
      setTimeout(() => u.onboundary?.({ name: "word", charIndex: at }), 10 + (i + 1) * this.msPerWord);
      charIndex += w.length + 1;
    });
    setTimeout(() => u.onend?.({}), 10 + words.length * this.msPerWord + 20);
  }
  cancel() {
    this.cancelled += 1;
    const current = this.utterances.at(-1);
    current?.onerror?.({ error: "interrupted" });
  }
}

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = 0;
  aborted = 0;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
  }
  stop() {}
  abort() {
    this.aborted += 1;
  }
  emit(results: Array<{ text: string; isFinal: boolean }>, resultIndex = 0) {
    this.onresult?.({
      resultIndex,
      results: results.map((r) => ({ isFinal: r.isFinal, length: 1, 0: { transcript: r.text } })),
    });
  }
}

function turnResponse(reply: string, extra: Partial<DemoTurnResponse> = {}): DemoTurnResponse {
  return { reply, toolCalls: [], uiActions: [], simulated: true, ...extra };
}

interface Harness {
  adapter: DemoAdapter;
  synth: FakeSynth;
  events: AdapterEvent[];
  fetchJson: ReturnType<typeof vi.fn>;
  turns: Record<string, DemoTurnResponse>;
  types: () => string[];
  rec: () => FakeRecognition;
  connect: () => Promise<unknown>;
}

function harness(opts: { pause?: "patient" | "balanced" | "quick"; recognition?: boolean; synth?: FakeSynth | null; voices?: FakeSynth["voices"] } = {}): Harness {
  const synth = opts.synth === undefined ? new FakeSynth() : opts.synth;
  if (synth && opts.voices) synth.voices = opts.voices;
  const turns: Record<string, DemoTurnResponse> = { [GREETING_TEXT]: turnResponse("Hello there, lovely to meet you") };
  const fetchJson = vi.fn(async (path: string, init: { json?: { text?: string } }) => {
    if (path === "/api/conversations") return { id: "11111111-1111-4111-8111-111111111111", modelKey: "full", modelId: "demo-full", metadata: { memoryCount: 2 } };
    if (path === "/api/demo/turn") {
      const text = init.json?.text ?? "";
      return turns[text] ?? turnResponse(`You said ${text}`);
    }
    throw new Error(`unexpected ${path}`);
  });
  const events: AdapterEvent[] = [];
  const adapter = new DemoAdapter({
    companionVoice: "fred",
    pauseSensitivity: opts.pause ?? "patient",
    fetchJson: fetchJson as unknown as <T>(path: string, init: unknown) => Promise<T>,
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    SpeechRecognition: opts.recognition === false ? null : FakeRecognition,
    random: () => 0.5,
  });
  return {
    adapter,
    synth: synth as FakeSynth,
    events,
    fetchJson,
    turns,
    types: () => events.map((e) => e.type),
    rec: () => FakeRecognition.instances.at(-1) as FakeRecognition,
    connect: () => adapter.connect({ modelKey: "full", micStream: null, tools: { dispatch: async () => ({ output: "" }) }, onEvent: (e) => events.push(e) }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
});
afterEach(() => vi.useRealTimers());

describe("DemoAdapter connect + greeting", () => {
  it("creates a demo conversation, emits a simulated session and speaks the server greeting", async () => {
    const h = harness();
    const info = await h.connect();
    expect(h.fetchJson).toHaveBeenCalledWith("/api/conversations", expect.objectContaining({ json: { mode: "demo", modelKey: "full" } }));
    expect(info).toMatchObject({ mode: "demo", simulated: true, voiceLabel: "Fred", voiceId: "browser-speech", modelId: "demo-full", context: { memoryCount: 2 } });
    expect(h.types().slice(0, 3)).toEqual(["status", "status", "session"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchJson).toHaveBeenCalledWith("/api/demo/turn", expect.objectContaining({ json: { conversationId: "11111111-1111-4111-8111-111111111111", text: GREETING_TEXT } }));
    expect(h.types()).toContain("response_started");
    await vi.advanceTimersByTimeAsync(20);
    expect(h.types()).toContain("assistant_speech_started");
    expect(h.synth.utterances[0].rate).toBe(0.95);
    expect(h.synth.utterances[0].voice).toEqual({ name: "Daniel", lang: "en-GB" });
    await vi.advanceTimersByTimeAsync(2000);
    const finalTranscript = h.events.find((e) => e.type === "transcript" && e.final) as { text: string; role: string };
    expect(finalTranscript).toMatchObject({ role: "assistant", text: "Hello there, lovely to meet you" });
    const levels = h.events.filter((e) => e.type === "level") as Array<{ level: number }>;
    expect(levels.length).toBeGreaterThan(5);
    expect(levels.every((l) => l.level >= 0 && l.level <= 1)).toBe(true);
    expect(h.types().at(-2)).toBe("assistant_speech_stopped");
    expect(h.events.at(-1)).toMatchObject({ type: "response_done", status: "completed", usage: null });
    // no user transcript for the greeting
    expect(h.events.some((e) => e.type === "transcript" && e.role === "user")).toBe(false);
    // recognition was started continuous + interim
    expect(h.rec().started).toBe(1);
    expect(h.rec().continuous).toBe(true);
    expect(h.rec().interimResults).toBe(true);
  });

  it("emits an unrecoverable error when the conversation cannot be created", async () => {
    const h = harness();
    h.fetchJson.mockRejectedValueOnce(new Error("500"));
    await expect(h.connect()).rejects.toThrow();
    expect(h.events.at(-1)).toMatchObject({ type: "error", code: "demo_connect_failed", recoverable: false });
  });
});

async function settleGreeting(h: Harness) {
  await h.connect();
  await vi.advanceTimersByTimeAsync(3000);
  h.events.length = 0;
}

describe("DemoAdapter voice input with pause window", () => {
  it("joins hesitant fragments and only commits after the pause window", async () => {
    const h = harness({ pause: "patient" });
    await settleGreeting(h);
    const rec = h.rec();
    rec.emit([{ text: "I was", isFinal: false }]);
    expect(h.types()).toEqual(["user_speech_started", "transcript"]);
    expect(h.events[1]).toMatchObject({ role: "user", text: "I was", final: false });

    rec.emit([{ text: "I was thinking", isFinal: true }]);
    await vi.advanceTimersByTimeAsync(PAUSE_WINDOW_MS.patient - 100);
    expect(h.types()).not.toContain("user_speech_stopped");
    expect(h.fetchJson).not.toHaveBeenCalledWith("/api/demo/turn", expect.objectContaining({ json: expect.objectContaining({ text: "I was thinking" }) }));

    // the speaker continues after a long pause: the fragment is joined, not cut off
    rec.emit([{ text: "I was thinking", isFinal: true }, { text: "about my garden", isFinal: false }], 1);
    await vi.advanceTimersByTimeAsync(PAUSE_WINDOW_MS.patient - 1);
    expect(h.types()).not.toContain("user_speech_stopped");
    await vi.advanceTimersByTimeAsync(1);
    const stopped = h.events.find((e) => e.type === "user_speech_stopped") as { durationMs?: number };
    expect(stopped).toBeTruthy();
    expect(stopped.durationMs).toBeGreaterThan(PAUSE_WINDOW_MS.patient);
    const final = h.events.find((e) => e.type === "transcript" && e.final) as { text: string };
    expect(final.text).toBe("I was thinking about my garden");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchJson).toHaveBeenCalledWith("/api/demo/turn", expect.objectContaining({ json: expect.objectContaining({ text: "I was thinking about my garden" }) }));
    expect(h.types()).toContain("response_started");
  });

  it("uses the configured window for quick/balanced", async () => {
    const h = harness({ pause: "quick" });
    await settleGreeting(h);
    h.rec().emit([{ text: "hello there", isFinal: true }]);
    await vi.advanceTimersByTimeAsync(PAUSE_WINDOW_MS.quick);
    expect(h.types()).toContain("user_speech_stopped");
    expect(PAUSE_WINDOW_MS).toEqual({ patient: 2000, balanced: 1200, quick: 700 });
  });

  it("barge-in: two words while speaking interrupts; a single word is ignored as echo", async () => {
    const h = harness({ pause: "quick" });
    await h.connect();
    await vi.advanceTimersByTimeAsync(20); // greeting started speaking
    expect(h.types()).toContain("assistant_speech_started");
    h.events.length = 0;
    h.rec().emit([{ text: "Hello", isFinal: false }]);
    expect(h.events).toEqual([]);
    h.rec().emit([{ text: "Hello Fred", isFinal: false }]);
    expect(h.types().slice(0, 4)).toEqual(["interrupted", "transcript", "level", "assistant_speech_stopped"]);
    expect(h.synth.cancelled).toBe(1);
    const truncated = h.events[1] as { text: string; final: boolean };
    expect(truncated.final).toBe(true);
    expect(truncated.text.split(" ").length).toBeLessThan(6);
    expect(h.events.find((e) => e.type === "response_done")).toMatchObject({ status: "cancelled" });
    expect(h.types()).toContain("user_speech_started");
  });

  it("muting stops recognition and unmuting restarts it; recognition restarts after onend", async () => {
    const h = harness();
    await settleGreeting(h);
    const first = h.rec();
    h.adapter.setMuted(true);
    expect(first.aborted).toBe(1);
    h.adapter.setMuted(false);
    expect(FakeRecognition.instances).toHaveLength(2);
    const second = h.rec();
    second.onend?.();
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeRecognition.instances).toHaveLength(3);
  });

  it("reports a blocked recognition once as a recoverable error and keeps typing available", async () => {
    const h = harness();
    await settleGreeting(h);
    h.rec().onerror?.({ error: "not-allowed" });
    h.rec().onerror?.({ error: "not-allowed" });
    expect(h.events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ code: "speech_recognition_blocked", recoverable: true });
    h.adapter.sendText("typed hello");
    expect(h.events.at(-2)).toMatchObject({ type: "transcript", role: "user", text: "typed hello", final: true });
    expect(h.events.at(-1)).toMatchObject({ type: "response_started" });
  });
});

describe("DemoAdapter turn, tools and typed input", () => {
  it("emits tool_call/tool_result pairs with uiActions, then speaks", async () => {
    const h = harness({ recognition: false });
    h.turns["remember my roses"] = turnResponse("Noted, roses it is", {
      toolCalls: [{ name: "remember", arguments: { content: "Loves roses" }, output: "Saved." }],
      uiActions: [{ type: "memory_saved", memoryId: "m1", content: "Loves roses" }, { type: "bogus" }],
    });
    await settleGreeting(h);
    h.adapter.sendText("remember my roses");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.types().slice(0, 4)).toEqual(["transcript", "response_started", "tool_call", "tool_result"]);
    expect(h.events[2]).toMatchObject({ call: { name: "remember", arguments: { content: "Loves roses" } } });
    expect(h.events[3]).toMatchObject({ result: { output: "Saved.", uiAction: { type: "memory_saved", memoryId: "m1" } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.events.at(-1)).toMatchObject({ type: "response_done", status: "completed" });
  });

  it("ends the conversation after the goodbye when the brain asks for it", async () => {
    const h = harness({ recognition: false });
    h.turns["goodbye"] = turnResponse("Bye for now", { toolCalls: [{ name: "end_conversation", arguments: {}, output: "Ending." }], uiActions: [{ type: "end_conversation" }] });
    await settleGreeting(h);
    h.adapter.sendText("goodbye");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events.find((e) => e.type === "tool_result")).toMatchObject({ result: { uiAction: { type: "end_conversation" } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.events.at(-1)).toEqual({ type: "ended", reason: "assistant_ended" });
  });

  it("recovers from a failed turn with a recoverable error", async () => {
    const h = harness({ recognition: false });
    await settleGreeting(h);
    h.fetchJson.mockRejectedValueOnce(new Error("503"));
    h.adapter.sendText("hello");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events.at(-2)).toMatchObject({ type: "error", code: "demo_turn_failed", recoverable: true });
    expect(h.events.at(-1)).toMatchObject({ type: "response_done", status: "failed" });
  });

  it("a newer utterance supersedes an in-flight turn", async () => {
    const h = harness({ recognition: false });
    await settleGreeting(h);
    const first: { resolve?: (v: DemoTurnResponse) => void } = {};
    h.fetchJson.mockImplementationOnce(() => new Promise<DemoTurnResponse>((r) => (first.resolve = r)));
    h.adapter.sendText("first");
    h.adapter.sendText("second");
    await vi.advanceTimersByTimeAsync(0);
    first.resolve?.(turnResponse("stale reply"));
    await vi.advanceTimersByTimeAsync(3000);
    const spoken = h.events.filter((e) => e.type === "transcript" && e.role === "assistant" && e.final) as Array<{ text: string }>;
    expect(spoken.map((s) => s.text)).toEqual(["You said second"]);
  });

  it("interrupt() cancels speech and reports what was actually said", async () => {
    const h = harness({ recognition: false });
    await h.connect();
    await vi.advanceTimersByTimeAsync(10 + 250); // start + ~2 words
    h.events.length = 0;
    h.adapter.interrupt();
    expect(h.types()).toEqual(["interrupted", "transcript", "level", "assistant_speech_stopped", "response_done"]);
    expect((h.events[1] as { text: string }).text).toBe("Hello there,");
    expect(h.synth.cancelled).toBe(1);
    h.adapter.interrupt(); // nothing speaking: no-op
    expect(h.events).toHaveLength(5);
  });

  it("disconnect stops everything and emits ended once", async () => {
    const h = harness();
    await h.connect();
    await vi.advanceTimersByTimeAsync(20);
    h.events.length = 0;
    await h.adapter.disconnect("user_ended");
    expect(h.types()).toContain("assistant_speech_stopped");
    expect(h.events.at(-1)).toEqual({ type: "ended", reason: "user_ended" });
    expect(h.rec().aborted).toBe(1);
    await h.adapter.disconnect("user_ended");
    expect(h.events.filter((e) => e.type === "ended")).toHaveLength(1);
  });
});

describe("DemoAdapter speech synthesis watchdogs (headless browsers)", () => {
  it("falls back to simulated timing when `start` never fires within 1s, cancelling the stuck utterance", async () => {
    const h = harness({ recognition: false });
    h.synth.behavior = "silent";
    await h.connect();
    await vi.advanceTimersByTimeAsync(SPEECH_START_WATCHDOG_MS - 1);
    expect(h.types()).not.toContain("assistant_speech_started");
    await vi.advanceTimersByTimeAsync(1);
    expect(h.types()).toContain("assistant_speech_started");
    expect(h.synth.cancelled).toBe(1);
    // 6 words at 160 wpm = 375ms each
    await vi.advanceTimersByTimeAsync(375 * 6 + 10);
    expect(h.events.at(-2)).toMatchObject({ type: "assistant_speech_stopped" });
    expect(h.events.at(-1)).toMatchObject({ type: "response_done", status: "completed" });
    const finalText = h.events.filter((e) => e.type === "transcript" && e.final).at(-1) as { text: string };
    expect(finalText.text).toBe("Hello there, lovely to meet you");
  });

  it("finishes the simulated way when `end` never fires (expected duration + 3s)", async () => {
    const h = harness({ recognition: false });
    h.synth.behavior = "stuck";
    await h.connect();
    await vi.advanceTimersByTimeAsync(20);
    expect(h.types()).toContain("assistant_speech_started");
    const expected = Math.round((6 * 375) / 0.95);
    await vi.advanceTimersByTimeAsync(expected + SPEECH_END_GRACE_MS - 30);
    expect(h.types()).not.toContain("assistant_speech_stopped");
    await vi.advanceTimersByTimeAsync(40);
    expect(h.types()).toContain("assistant_speech_stopped");
    expect(h.events.at(-1)).toMatchObject({ type: "response_done", status: "completed" });
  });

  it("uses the simulated path directly when there are no voices or no speechSynthesis", async () => {
    const noVoices = harness({ recognition: false, voices: [] });
    await noVoices.connect();
    await vi.advanceTimersByTimeAsync(5);
    expect(noVoices.synth.utterances).toHaveLength(0);
    expect(noVoices.types()).toContain("assistant_speech_started");
    await vi.advanceTimersByTimeAsync(375 * 6 + 10);
    expect(noVoices.events.at(-1)).toMatchObject({ type: "response_done", status: "completed" });

    const noSynth = harness({ recognition: false, synth: null });
    await noSynth.connect();
    await vi.advanceTimersByTimeAsync(5);
    expect(noSynth.types()).toContain("assistant_speech_started");
    const levels = noSynth.events.filter((e) => e.type === "level");
    await vi.advanceTimersByTimeAsync(1000);
    expect(noSynth.events.filter((e) => e.type === "level").length).toBeGreaterThan(levels.length + 20);
  });
});

describe("helpers", () => {
  it("pickVoice prefers gendered English names per companion and falls back sanely", () => {
    const voices = [
      { name: "Google US English", lang: "en-US", default: true },
      { name: "Microsoft Zira - English (United States)", lang: "en-US" },
      { name: "Microsoft David - English (United States)", lang: "en-US" },
      { name: "Microsoft Hortense - French", lang: "fr-FR" },
    ];
    expect(pickVoice(voices, "fred")?.name).toContain("David");
    expect(pickVoice(voices, "ethel")?.name).toContain("Zira");
    expect(pickVoice([voices[0]], "fred")?.name).toBe("Google US English");
    expect(pickVoice([voices[3]], "ethel")?.name).toContain("Hortense");
    expect(pickVoice([], "fred")).toBeNull();
  });

  it("pairUiActions matches by tool affinity, then order, and keeps orphans", () => {
    const pairs = pairUiActions(
      [
        { name: "set_preferred_name", arguments: { name: "Peg" }, output: "ok" },
        { name: "request_memory_consent", arguments: {}, output: "ok" },
      ],
      [{ type: "consent_prompt", scope: "memory" }, { type: "name_set", name: "Peg" }, { type: "humor_changed", level: "off" }, { type: "nonsense" }],
    );
    expect(pairs).toEqual([
      { call: expect.objectContaining({ name: "set_preferred_name" }), uiAction: { type: "name_set", name: "Peg" } },
      { call: expect.objectContaining({ name: "request_memory_consent" }), uiAction: { type: "consent_prompt", scope: "memory" } },
      { call: null, uiAction: { type: "humor_changed", level: "off" } },
    ]);
  });
});
