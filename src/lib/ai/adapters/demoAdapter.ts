"use client";
/**
 * DemoAdapter — demo mode. NO paid API, NO live AI. Everything here is
 * simulated and the UI shows a persistent "Simulated — no live AI" badge.
 *
 *   input : browser SpeechRecognition when available (interim results feed the
 *           live user transcript) plus typed text; a pause window derived from
 *           the pause-sensitivity preference joins hesitant fragments into one
 *           utterance instead of cutting the speaker off
 *   brain : POST /api/demo/turn (server-side demo brain over the SAME memory
 *           store as live mode, so consent/recall/model-switch flows are real)
 *   output: browser speechSynthesis with a synthetic amplitude envelope for the
 *           orb; when speech synthesis is missing, voiceless (headless), or
 *           silent, a timing simulation at 160 wpm produces the same events
 */
import { apiFetch } from "@/lib/api/client";
import type { DemoTurnResponse } from "@/lib/api/contracts";
import { narrowUiAction } from "@/lib/ai/tools/clientDispatcher";
import { setTrackEnabled } from "@/lib/ai/realtime/audio";
import type { CompanionVoice, Conversation, ModelKey, PauseSensitivity } from "@/lib/types";
import type {
  AdapterConnectOptions,
  AdapterEvent,
  AdapterSessionInfo,
  ConversationAdapter,
  ToolCallRequest,
  ToolCallResult,
} from "./types";

// ---------------------------------------------------------------------------
// Minimal browser API surfaces (lib.dom lacks SpeechRecognition; we also fake these in tests)
// ---------------------------------------------------------------------------

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence?: number };
  length: number;
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onstart?: (() => void) | null;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechSynthesisVoiceLike {
  name: string;
  lang: string;
  default?: boolean;
}
export interface SpeechSynthesisUtteranceLike {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechSynthesisVoiceLike | null;
  onstart: ((event: unknown) => void) | null;
  onend: ((event: unknown) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onboundary: ((event: { name?: string; charIndex?: number }) => void) | null;
}
export interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoiceLike[];
  speaking?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
}
export type SpeechSynthesisUtteranceCtor = new (text: string) => SpeechSynthesisUtteranceLike;

export type FetchJson = <T>(path: string, init: Parameters<typeof apiFetch>[1]) => Promise<T>;

export interface DemoAdapterOptions {
  companionVoice?: CompanionVoice;
  pauseSensitivity?: PauseSensitivity;
  fetchJson?: FetchJson;
  /** `null` disables speech output (timing simulation only). Default: window.speechSynthesis. */
  speechSynthesis?: SpeechSynthesisLike | null;
  SpeechSynthesisUtterance?: SpeechSynthesisUtteranceCtor | null;
  /** `null` disables voice input (typing only). Default: window.SpeechRecognition / webkit. */
  SpeechRecognition?: SpeechRecognitionCtor | null;
  now?: () => number;
  random?: () => number;
  /** Speech rate for the timing simulation and reveal cadence. Default 160. */
  wordsPerMinute?: number;
}

/** Silence window before a recognised utterance is treated as complete (ms). */
export const PAUSE_WINDOW_MS: Record<PauseSensitivity, number> = { patient: 2000, balanced: 1200, quick: 700 };
export const COMPANION_LABEL: Record<CompanionVoice, string> = { fred: "Fred", ethel: "Ethel" };
export const GREETING_TEXT = "__greeting__";
/** Headless browsers expose speechSynthesis but never fire `start`; fall back after this long. */
export const SPEECH_START_WATCHDOG_MS = 1000;
/** If `end` never fires, finish the simulated way this long after the expected duration. */
export const SPEECH_END_GRACE_MS = 3000;
const LEVEL_INTERVAL_MS = 33; // ~30 Hz
const BARGE_IN_MIN_WORDS = 2;

const FRED_VOICE = /\b(male|david|daniel|fred|george|alex|james|guy|arthur|ryan|oliver|thomas)\b/i;
const ETHEL_VOICE = /\b(female|samantha|zira|karen|moira|fiona|victoria|susan|aria|jenny|zoe|emma|libby|sonia|ava|allison)\b/i;

export function pickVoice(voices: SpeechSynthesisVoiceLike[], companion: CompanionVoice): SpeechSynthesisVoiceLike | null {
  if (!voices.length) return null;
  const english = voices.filter((v) => /^en\b/i.test(v.lang ?? ""));
  const pool = english.length ? english : voices;
  const preferred = companion === "fred" ? FRED_VOICE : ETHEL_VOICE;
  const avoid = companion === "fred" ? /female/i : /\bmale\b/i;
  const match = pool.find((v) => preferred.test(v.name) && !avoid.test(v.name));
  if (match) return match;
  return pool.find((v) => v.default) ?? pool[0] ?? null;
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const TOOL_TO_ACTION: Array<[RegExp, string]> = [
  [/consent/i, "consent_prompt"],
  [/remember|save_memory|store_memory/i, "memory_saved"],
  [/forget|delete_memory/i, "memory_deleted"],
  [/humor/i, "humor_changed"],
  [/name/i, "name_set"],
  [/end_conversation|goodbye/i, "end_conversation"],
];

/** Pair the server's loose uiActions list with its toolCalls (by type affinity, then order). */
export function pairUiActions(
  toolCalls: DemoTurnResponse["toolCalls"],
  uiActions: DemoTurnResponse["uiActions"],
): Array<{ call: DemoTurnResponse["toolCalls"][number] | null; uiAction: ToolCallResult["uiAction"] }> {
  const actions = uiActions.map((a) => narrowUiAction(a)).filter((a): a is NonNullable<ToolCallResult["uiAction"]> => Boolean(a));
  const remaining = actions.slice();
  const out: Array<{ call: DemoTurnResponse["toolCalls"][number] | null; uiAction: ToolCallResult["uiAction"] }> = [];
  for (const call of toolCalls) {
    const wanted = TOOL_TO_ACTION.find(([re]) => re.test(call.name))?.[1];
    let index = wanted ? remaining.findIndex((a) => a.type === wanted) : -1;
    if (index === -1 && toolCalls.length === 1 && remaining.length === 1) index = 0;
    const uiAction = index >= 0 ? remaining.splice(index, 1)[0] : undefined;
    out.push({ call, uiAction });
  }
  for (const uiAction of remaining) out.push({ call: null, uiAction });
  return out;
}

interface SpeechRun {
  responseId: string;
  text: string;
  words: string[];
  revealed: number;
  startedAt: number | null;
  finished: boolean;
  usedSynthesis: boolean;
  utterance: SpeechSynthesisUtteranceLike | null;
  levelTimer: ReturnType<typeof setInterval> | null;
  revealTimer: ReturnType<typeof setInterval> | null;
  startWatchdog: ReturnType<typeof setTimeout> | null;
  endWatchdog: ReturnType<typeof setTimeout> | null;
  boundarySeen: boolean;
  pulse: number;
  level: number;
  itemId: string;
}

export class DemoAdapter implements ConversationAdapter {
  readonly mode = "demo" as const;

  private readonly companion: CompanionVoice;
  private readonly pauseWindowMs: number;
  private readonly fetchJson: FetchJson;
  private readonly synth: SpeechSynthesisLike | null;
  private readonly Utterance: SpeechSynthesisUtteranceCtor | null;
  private readonly Recognition: SpeechRecognitionCtor | null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly msPerWord: number;

  private onEvent: (event: AdapterEvent) => void = () => {};
  private connected = false;
  private closed = false;
  private signal: AbortSignal | undefined;
  private micStream: MediaStream | null = null;
  private muted = false;
  private outputMuted = false;
  private sessionInfo: AdapterSessionInfo | null = null;
  private conversationId: string | null = null;

  private seq = 0;
  private turnSeq = 0;
  private speech: SpeechRun | null = null;

  // recognition
  private recognition: SpeechRecognitionLike | null = null;
  private recognitionActive = false;
  private recognitionRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private recognitionErrors = 0;
  private recognitionErrorReported = false;
  private segments: string[] = [];
  private interim = "";
  private lastFinalIndex = -1;
  private userSpeaking = false;
  private userSpeechStartedAt: number | null = null;
  private userItemId: string | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DemoAdapterOptions = {}) {
    this.companion = options.companionVoice ?? "fred";
    this.pauseWindowMs = PAUSE_WINDOW_MS[options.pauseSensitivity ?? "patient"];
    this.fetchJson = options.fetchJson ?? apiFetch;
    const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : null;
    this.synth =
      options.speechSynthesis !== undefined
        ? options.speechSynthesis
        : ((w?.speechSynthesis as SpeechSynthesisLike | undefined) ?? null);
    this.Utterance =
      options.SpeechSynthesisUtterance !== undefined
        ? options.SpeechSynthesisUtterance
        : ((w?.SpeechSynthesisUtterance as SpeechSynthesisUtteranceCtor | undefined) ?? null);
    this.Recognition =
      options.SpeechRecognition !== undefined
        ? options.SpeechRecognition
        : ((w?.SpeechRecognition as SpeechRecognitionCtor | undefined) ??
          (w?.webkitSpeechRecognition as SpeechRecognitionCtor | undefined) ??
          null);
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.msPerWord = 60_000 / (options.wordsPerMinute ?? 160);
  }

  // ---------------------------------------------------------------------------
  // ConversationAdapter
  // ---------------------------------------------------------------------------

  async connect(options: AdapterConnectOptions): Promise<AdapterSessionInfo> {
    if (this.connected || this.closed) throw new Error("Adapter already used; create a new adapter per session.");
    this.onEvent = options.onEvent;
    this.signal = options.signal;
    this.micStream = options.micStream;
    setTrackEnabled(this.micStream, !this.muted);
    this.emit({ type: "status", status: "connecting" });

    let conversation: Conversation;
    try {
      // The route returns `{ conversation }`; accept a bare Conversation too.
      const payload = await this.fetchJson<Conversation | { conversation: Conversation }>("/api/conversations", {
        method: "POST",
        json: {
          mode: "demo",
          modelKey: options.modelKey,
          ...(options.conversationId ? { continueConversationId: options.conversationId } : {}),
        },
        signal: this.signal,
      });
      conversation = "conversation" in payload ? payload.conversation : payload;
      if (!conversation?.id) throw new Error("Conversation response had no id.");
    } catch (error) {
      this.closed = true;
      if (!this.signal?.aborted) {
        this.emit({
          type: "error",
          code: "demo_connect_failed",
          message: "We couldn't start the demo conversation. Please check your connection and try again.",
          recoverable: false,
        });
      }
      throw error;
    }
    if (this.signal?.aborted) {
      this.closed = true;
      const error = new Error("Connection cancelled.");
      error.name = "AbortError";
      throw error;
    }

    const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
    const count = (key: string) => (typeof metadata[key] === "number" ? (metadata[key] as number) : 0);
    this.conversationId = conversation.id;
    this.sessionInfo = {
      mode: "demo",
      conversationId: conversation.id,
      modelKey: (conversation.modelKey ?? options.modelKey) as ModelKey,
      modelId: conversation.modelId ?? `demo-${options.modelKey}`,
      voiceLabel: COMPANION_LABEL[this.companion],
      voiceId: "browser-speech",
      context: {
        memoryCount: count("memoryCount"),
        summaryCount: count("summaryCount"),
        estimatedTokens: count("estimatedTokens"),
      },
      simulated: true,
      expiresAt: null,
    };
    this.connected = true;
    this.emit({ type: "status", status: "connected" });
    this.emit({ type: "session", info: this.sessionInfo });
    this.startRecognition();
    // Opening line comes from the server-side demo brain (onboarding-aware).
    void this.runTurn(GREETING_TEXT, { greeting: true });
    return this.sessionInfo;
  }

  async disconnect(reason = "user_ended"): Promise<void> {
    if (this.closed) return;
    const wasConnected = this.connected;
    this.closed = true;
    this.connected = false;
    this.stopRecognition();
    this.clearCommitTimer();
    if (this.speech) this.endSpeech(this.speech, "cancelled");
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
    if (wasConnected) this.emit({ type: "ended", reason });
  }

  interrupt(): void {
    if (!this.connected) return;
    const run = this.speech;
    if (!run) return;
    this.emit({ type: "interrupted", responseId: run.responseId });
    this.endSpeech(run, "cancelled");
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    setTrackEnabled(this.micStream, !muted);
    if (!this.connected) return;
    if (muted) {
      this.stopRecognition();
      this.discardPendingUtterance();
    } else {
      this.startRecognition();
    }
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.connected) return;
    this.clearCommitTimer();
    this.segments = [];
    this.interim = "";
    if (this.userSpeaking) {
      this.userSpeaking = false;
      this.emit({ type: "user_speech_stopped" });
    }
    const itemId = this.userItemId ?? `demo_user_${++this.seq}`;
    this.userItemId = null;
    this.emit({ type: "transcript", role: "user", itemId, text: trimmed, final: true });
    void this.runTurn(trimmed);
  }

  getRemoteAudioStream(): MediaStream | null {
    return null; // demo emits synthetic `level` events instead
  }

  /** Comparison-mode parity with the live adapter: silence future utterances. */
  setOutputMuted(muted: boolean): void {
    this.outputMuted = muted;
    if (this.speech?.utterance) this.speech.utterance.volume = muted ? 0 : 1;
  }

  get currentSessionInfo(): AdapterSessionInfo | null {
    return this.sessionInfo;
  }

  // ---------------------------------------------------------------------------
  // Recognition (input)
  // ---------------------------------------------------------------------------

  private startRecognition(): void {
    if (!this.Recognition || !this.connected || this.muted || this.recognitionActive) return;
    if (this.recognitionRestartTimer) {
      clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = null;
    }
    let rec: SpeechRecognitionLike;
    try {
      rec = new this.Recognition();
    } catch {
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    if ("maxAlternatives" in rec) rec.maxAlternatives = 1;
    this.lastFinalIndex = -1;
    rec.onresult = (event) => this.handleRecognitionResult(event);
    rec.onerror = (event) => this.handleRecognitionError(event?.error ?? "unknown");
    rec.onend = () => {
      this.recognitionActive = false;
      if (this.recognition === rec) this.recognition = null;
      if (this.connected && !this.muted && !this.closed && this.recognitionErrors < 6) {
        const delay = 250 + this.recognitionErrors * 500;
        this.recognitionRestartTimer = setTimeout(() => {
          this.recognitionRestartTimer = null;
          this.startRecognition();
        }, delay);
      }
    };
    this.recognition = rec;
    try {
      rec.start();
      this.recognitionActive = true;
    } catch {
      this.recognitionActive = false;
      this.recognition = null;
    }
  }

  private stopRecognition(): void {
    if (this.recognitionRestartTimer) {
      clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = null;
    }
    const rec = this.recognition;
    this.recognition = null;
    this.recognitionActive = false;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }

  private handleRecognitionError(code: string): void {
    if (code === "no-speech" || code === "aborted") return;
    this.recognitionErrors += 1;
    if (code === "not-allowed" || code === "service-not-allowed") {
      this.recognitionErrors = 99; // do not restart
      if (!this.recognitionErrorReported) {
        this.recognitionErrorReported = true;
        this.emit({
          type: "error",
          code: "speech_recognition_blocked",
          message: "I can't hear you because the browser blocked speech recognition. You can type below instead.",
          recoverable: true,
        });
      }
      return;
    }
    if (code === "network" && !this.recognitionErrorReported) {
      this.recognitionErrorReported = true;
      this.emit({
        type: "error",
        code: "speech_recognition_network",
        message: "Speech recognition needs an internet connection. You can type below instead.",
        recoverable: true,
      });
    }
  }

  private handleRecognitionResult(event: SpeechRecognitionEventLike): void {
    if (!this.connected || this.muted) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = (result?.[0]?.transcript ?? "").trim();
      if (!text) continue;
      if (result.isFinal) {
        if (i > this.lastFinalIndex) {
          this.lastFinalIndex = i;
          this.segments.push(text);
        }
      } else {
        interim = interim ? `${interim} ${text}` : text;
      }
    }
    this.interim = interim;
    const combined = [...this.segments, this.interim].filter(Boolean).join(" ");
    if (!combined) return;

    if (this.speech && !this.userSpeaking) {
      // Barge-in needs a little confidence so the speaker's own voice/echo doesn't trip it.
      if (splitWords(combined).length < BARGE_IN_MIN_WORDS) {
        this.segments = [];
        this.interim = "";
        this.lastFinalIndex = Math.max(this.lastFinalIndex, event.results.length - 1);
        return;
      }
      this.interrupt();
    }

    if (!this.userSpeaking) {
      this.userSpeaking = true;
      this.userSpeechStartedAt = this.now();
      this.userItemId = `demo_user_${++this.seq}`;
      this.emit({ type: "user_speech_started" });
    }
    this.emit({ type: "transcript", role: "user", itemId: this.userItemId as string, text: combined, final: false });
    this.armCommitTimer();
  }

  /** Pause-sensitivity window: only after this much silence is the utterance final. */
  private armCommitTimer(): void {
    this.clearCommitTimer();
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      this.commitUtterance();
    }, this.pauseWindowMs);
  }

  private clearCommitTimer(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private commitUtterance(): void {
    const text = [...this.segments, this.interim].filter(Boolean).join(" ").trim();
    this.segments = [];
    this.interim = "";
    const itemId = this.userItemId ?? `demo_user_${++this.seq}`;
    this.userItemId = null;
    if (this.userSpeaking) {
      this.userSpeaking = false;
      const durationMs = this.userSpeechStartedAt !== null ? Math.max(0, this.now() - this.userSpeechStartedAt) : undefined;
      this.userSpeechStartedAt = null;
      this.emit({ type: "user_speech_stopped", ...(durationMs !== undefined ? { durationMs } : {}) });
    }
    if (!text) return;
    this.emit({ type: "transcript", role: "user", itemId, text, final: true });
    void this.runTurn(text);
  }

  private discardPendingUtterance(): void {
    this.clearCommitTimer();
    this.segments = [];
    this.interim = "";
    if (this.userSpeaking) {
      this.userSpeaking = false;
      this.userSpeechStartedAt = null;
      this.emit({ type: "user_speech_stopped" });
    }
    this.userItemId = null;
  }

  // ---------------------------------------------------------------------------
  // Turn (server-side demo brain)
  // ---------------------------------------------------------------------------

  private async runTurn(text: string, opts: { greeting?: boolean } = {}): Promise<void> {
    if (!this.connected || !this.conversationId) return;
    if (this.speech) this.interrupt();
    const turn = ++this.turnSeq;
    const responseId = `demo_resp_${turn}`;
    this.emit({ type: "response_started", responseId });

    let result: DemoTurnResponse;
    try {
      result = await this.fetchJson<DemoTurnResponse>("/api/demo/turn", {
        method: "POST",
        json: { conversationId: this.conversationId, text },
        signal: this.signal,
      });
    } catch {
      if (turn !== this.turnSeq || !this.connected) return;
      this.emit({
        type: "error",
        code: "demo_turn_failed",
        message: opts.greeting
          ? "The demo companion couldn't say hello just now. Try saying or typing something."
          : "The demo companion couldn't answer just now. Please try again.",
        recoverable: true,
      });
      this.emit({ type: "response_done", responseId, status: "failed", usage: null });
      return;
    }
    if (turn !== this.turnSeq || !this.connected) return; // superseded by a newer utterance

    let endRequested = false;
    for (const pair of pairUiActions(result.toolCalls ?? [], result.uiActions ?? [])) {
      const call: ToolCallRequest = pair.call
        ? { callId: `demo_call_${++this.seq}`, name: pair.call.name, arguments: pair.call.arguments ?? {} }
        : { callId: `demo_call_${++this.seq}`, name: "ui_action", arguments: {} };
      const toolResult: ToolCallResult = {
        output: pair.call?.output ?? "",
        ...(pair.uiAction ? { uiAction: pair.uiAction } : {}),
      };
      if (pair.uiAction?.type === "end_conversation") endRequested = true;
      this.emit({ type: "tool_call", call });
      this.emit({ type: "tool_result", call, result: toolResult });
    }

    const reply = (result.reply ?? "").trim();
    if (!reply) {
      this.emit({ type: "response_done", responseId, status: "completed", usage: null });
      return;
    }
    this.speak(responseId, reply);
    if (endRequested) {
      // Let the goodbye finish, then end.
      const run = this.speech;
      const check = setInterval(() => {
        if (!run || run.finished) {
          clearInterval(check);
          void this.disconnect("assistant_ended");
        }
      }, 200);
    }
  }

  // ---------------------------------------------------------------------------
  // Output (speech synthesis with watchdogs, or timing simulation)
  // ---------------------------------------------------------------------------

  private speak(responseId: string, text: string): void {
    const run: SpeechRun = {
      responseId,
      text,
      words: splitWords(text),
      revealed: 0,
      startedAt: null,
      finished: false,
      usedSynthesis: false,
      utterance: null,
      levelTimer: null,
      revealTimer: null,
      startWatchdog: null,
      endWatchdog: null,
      boundarySeen: false,
      pulse: 0,
      level: 0,
      itemId: `demo_assistant_${++this.seq}`,
    };
    this.speech = run;

    const voices = safeVoices(this.synth);
    const canSynthesize = Boolean(this.synth && this.Utterance && voices.length > 0 && !this.outputMuted);
    if (!canSynthesize) {
      this.beginSimulated(run);
      return;
    }

    const utterance = new (this.Utterance as SpeechSynthesisUtteranceCtor)(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = this.outputMuted ? 0 : 1;
    utterance.voice = pickVoice(voices, this.companion);
    run.utterance = utterance;
    run.usedSynthesis = true;

    utterance.onstart = () => {
      if (this.speech !== run || run.finished) return;
      if (run.startWatchdog) clearTimeout(run.startWatchdog);
      run.startWatchdog = null;
      this.beginSpeech(run);
      // Reveal words by timing unless boundary events show up (then they drive it).
      run.revealTimer = setInterval(() => {
        if (run.boundarySeen) return;
        this.reveal(run, run.revealed + 1);
      }, this.msPerWord);
      const expected = this.expectedDurationMs(run.words.length);
      run.endWatchdog = setTimeout(() => {
        if (this.speech === run && !run.finished) this.endSpeech(run, "completed");
      }, expected + SPEECH_END_GRACE_MS);
    };
    utterance.onboundary = (event) => {
      if (this.speech !== run || run.finished) return;
      if (event?.name && event.name !== "word") return;
      run.boundarySeen = true;
      run.pulse = 0.35;
      const charIndex = typeof event?.charIndex === "number" ? event.charIndex : null;
      const count = charIndex !== null ? splitWords(text.slice(0, charIndex)).length + 1 : run.revealed + 1;
      this.reveal(run, count);
    };
    utterance.onend = () => {
      if (this.speech !== run || run.finished) return;
      if (run.startedAt === null) {
        // Some engines fire end without start (silent). Finish the simulated way.
        this.beginSimulated(run);
        return;
      }
      this.endSpeech(run, "completed");
    };
    utterance.onerror = (event) => {
      if (this.speech !== run || run.finished) return;
      const code = event?.error ?? "";
      if (code === "interrupted" || code === "canceled" || code === "cancelled") return; // our own cancel
      if (run.startedAt === null) this.beginSimulated(run);
      else this.endSpeech(run, "completed");
    };

    // Watchdog: headless browsers accept speak() but never fire start.
    run.startWatchdog = setTimeout(() => {
      run.startWatchdog = null;
      if (this.speech !== run || run.finished || run.startedAt !== null) return;
      this.detachUtterance(run);
      try {
        this.synth?.cancel();
      } catch {
        /* ignore */
      }
      this.beginSimulated(run);
    }, SPEECH_START_WATCHDOG_MS);

    try {
      this.synth?.speak(utterance);
    } catch {
      if (run.startWatchdog) clearTimeout(run.startWatchdog);
      run.startWatchdog = null;
      this.detachUtterance(run);
      this.beginSimulated(run);
    }
  }

  private expectedDurationMs(wordCount: number): number {
    return Math.max(800, Math.round((wordCount * this.msPerWord) / 0.95));
  }

  /** Timing simulation at ~160 wpm: same events, no sound. */
  private beginSimulated(run: SpeechRun): void {
    run.usedSynthesis = false;
    run.utterance = null;
    this.beginSpeech(run);
    run.revealTimer = setInterval(() => {
      if (this.speech !== run || run.finished) return;
      run.pulse = 0.3;
      this.reveal(run, run.revealed + 1);
      if (run.revealed >= run.words.length) this.endSpeech(run, "completed");
    }, this.msPerWord);
  }

  private beginSpeech(run: SpeechRun): void {
    if (run.startedAt !== null) return;
    run.startedAt = this.now();
    this.emit({ type: "assistant_speech_started", responseId: run.responseId });
    this.emit({ type: "transcript", role: "assistant", itemId: run.itemId, text: "", final: false });
    let tick = 0;
    run.levelTimer = setInterval(() => {
      if (this.speech !== run || run.finished) return;
      tick += 1;
      const t = (tick * LEVEL_INTERVAL_MS) / 1000;
      const base = 0.38 + 0.14 * Math.sin(t * 2 * Math.PI * 1.3) + 0.1 * Math.sin(t * 2 * Math.PI * 3.7 + 1);
      const jitter = (this.random() - 0.5) * 0.14;
      const target = Math.max(0.05, Math.min(1, base + jitter + run.pulse));
      run.pulse *= 0.8;
      run.level = run.level * 0.55 + target * 0.45;
      this.emit({ type: "level", source: "assistant", level: run.level });
    }, LEVEL_INTERVAL_MS);
  }

  private reveal(run: SpeechRun, count: number): void {
    const next = Math.min(run.words.length, Math.max(run.revealed, count));
    if (next === run.revealed) return;
    run.revealed = next;
    this.emit({
      type: "transcript",
      role: "assistant",
      itemId: run.itemId,
      text: run.words.slice(0, next).join(" "),
      final: false,
    });
  }

  private endSpeech(run: SpeechRun, status: "completed" | "cancelled"): void {
    if (run.finished) return;
    run.finished = true;
    if (run.levelTimer) clearInterval(run.levelTimer);
    if (run.revealTimer) clearInterval(run.revealTimer);
    if (run.startWatchdog) clearTimeout(run.startWatchdog);
    if (run.endWatchdog) clearTimeout(run.endWatchdog);
    run.levelTimer = run.revealTimer = null;
    run.startWatchdog = run.endWatchdog = null;
    if (run.usedSynthesis) {
      this.detachUtterance(run);
      if (status === "cancelled") {
        try {
          this.synth?.cancel();
        } catch {
          /* ignore */
        }
      }
    }
    if (this.speech === run) this.speech = null;

    // Mirror real truncation: what was actually heard stays in the transcript.
    const spoken = status === "completed" ? run.text : run.words.slice(0, run.revealed).join(" ");
    const started = run.startedAt !== null;
    this.emit({ type: "transcript", role: "assistant", itemId: run.itemId, text: spoken, final: true });
    if (started) {
      const durationMs = Math.max(0, this.now() - (run.startedAt as number));
      this.emit({ type: "level", source: "assistant", level: 0 });
      this.emit({ type: "assistant_speech_stopped", responseId: run.responseId, durationMs });
    }
    this.emit({ type: "response_done", responseId: run.responseId, status, usage: null });
  }

  private detachUtterance(run: SpeechRun): void {
    const u = run.utterance;
    if (!u) return;
    u.onstart = null;
    u.onend = null;
    u.onerror = null;
    u.onboundary = null;
  }

  private emit(event: AdapterEvent): void {
    try {
      this.onEvent(event);
    } catch {
      /* listeners must not break the adapter */
    }
  }
}

function safeVoices(synth: SpeechSynthesisLike | null): SpeechSynthesisVoiceLike[] {
  if (!synth) return [];
  try {
    return synth.getVoices() ?? [];
  } catch {
    return [];
  }
}
