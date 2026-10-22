/**
 * Pure reducer for the voice session UI. Adapter events (plus mic status and
 * clock ticks) go in; connection status, orb state, transcript, usage and
 * speech/latency metrics come out. No side effects, no timers, no DOM —
 * fully unit-testable with event sequences (see tests/unit/voice).
 */
import type { AdapterEvent, AdapterSessionInfo, ToolCallResult } from "@/lib/ai/adapters/types";
import type { ConnectionStatus, OrbState, SearchSource, TokenUsage } from "@/lib/types";
import { ZERO_USAGE } from "@/lib/types";
import type { MicError } from "./audio";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  sources?: SearchSource[];
  /** Wall-clock ms when the entry was first created. */
  at: number;
}

export interface ConversationError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type MicStatus = "idle" | "requesting" | "granted" | "denied" | "skipped";

export interface ConversationState {
  connection: ConnectionStatus;
  orb: OrbState;
  session: AdapterSessionInfo | null;
  transcript: TranscriptEntry[];
  activeTool: string | null;
  usage: TokenUsage;
  responses: number;
  userSpeechSeconds: number;
  assistantSpeechSeconds: number;
  connectedSince: number | null;
  lastError: ConversationError | null;
  interruptions: number;
  muted: boolean;

  // --- derived-state inputs (exposed so the UI can be precise) ---
  mic: MicStatus;
  micError: MicError | null;
  userSpeaking: boolean;
  assistantSpeaking: boolean;
  /** True from user_speech_stopped / response_started until audio starts or the response finishes. */
  awaitingResponse: boolean;
  interruptedAt: number | null;
  currentResponseId: string | null;
  /** Synthetic assistant output level (0..1) from adapters that cannot be analysed (demo). */
  outputLevel: number;
  /** response_started -> assistant_speech_started, ms, per response. */
  latenciesMs: number[];
  endedReason: string | null;
  /** Last clock value seen (ms). */
  now: number;
  // internal timers
  userSpeechStartedAt: number | null;
  assistantSpeechStartedAt: number | null;
  responseStartedAt: number | null;
  /** Sources from the latest search tool result, attached to the next assistant transcript. */
  pendingSources: SearchSource[] | null;
}

export const INTERRUPTED_HOLD_MS = 600;

export type ConversationAction =
  | (AdapterEvent & { at?: number })
  | { type: "mic"; status: MicStatus; error?: MicError | null; at?: number }
  | { type: "tick"; now: number }
  | { type: "set_muted"; muted: boolean; at?: number }
  | { type: "reset"; at?: number };

export function initialConversationState(now = 0): ConversationState {
  return {
    connection: "disconnected",
    orb: "offline",
    session: null,
    transcript: [],
    activeTool: null,
    usage: { ...ZERO_USAGE },
    responses: 0,
    userSpeechSeconds: 0,
    assistantSpeechSeconds: 0,
    connectedSince: null,
    lastError: null,
    interruptions: 0,
    muted: false,
    mic: "idle",
    micError: null,
    userSpeaking: false,
    assistantSpeaking: false,
    awaitingResponse: false,
    interruptedAt: null,
    currentResponseId: null,
    outputLevel: 0,
    latenciesMs: [],
    endedReason: null,
    now,
    userSpeechStartedAt: null,
    assistantSpeechStartedAt: null,
    responseStartedAt: null,
    pendingSources: null,
  };
}

/** Orb state from the flags. Exported so the UI can re-derive with a live clock. */
export function deriveOrbState(state: ConversationState, now: number = state.now): OrbState {
  switch (state.connection) {
    case "disconnected":
    case "ended":
      return "offline";
    case "requesting_mic":
    case "connecting":
    case "reconnecting":
      return "connecting";
    case "error":
      return "error";
    default:
      break;
  }
  if (state.lastError && !state.lastError.recoverable) return "error";
  if (state.interruptedAt !== null && now - state.interruptedAt < INTERRUPTED_HOLD_MS) return "interrupted";
  if (state.userSpeaking) return "listening";
  if (state.assistantSpeaking) return "speaking";
  if (state.awaitingResponse) return "thinking";
  if (state.muted) return "muted";
  return "idle";
}

function addUsage(total: TokenUsage, delta: TokenUsage | null): TokenUsage {
  if (!delta) return total;
  return {
    inputTextTokens: total.inputTextTokens + delta.inputTextTokens,
    inputAudioTokens: total.inputAudioTokens + delta.inputAudioTokens,
    cachedTextTokens: total.cachedTextTokens + delta.cachedTextTokens,
    cachedAudioTokens: total.cachedAudioTokens + delta.cachedAudioTokens,
    outputTextTokens: total.outputTextTokens + delta.outputTextTokens,
    outputAudioTokens: total.outputAudioTokens + delta.outputAudioTokens,
  };
}

const TOOL_LABELS: Record<string, string> = {
  search_web: "Looking that up…",
  remember: "Saving a memory…",
  forget: "Forgetting that…",
  recall_memories: "Remembering…",
  record_consent: "Noting your choice…",
  request_memory_consent: "Asking permission…",
  set_preferred_name: "Noting your name…",
  set_humor_level: "Adjusting humor…",
  end_conversation: "Wrapping up…",
  ui_action: "One moment…",
};

/** Plain-language chip text for an active tool. */
export function describeTool(name: string | null): string | null {
  if (!name) return null;
  return TOOL_LABELS[name] ?? "Working on it…";
}

function upsertTranscript(
  entries: TranscriptEntry[],
  entry: { id: string; role: "user" | "assistant"; text: string; final: boolean; sources?: SearchSource[] },
  now: number,
): TranscriptEntry[] {
  const index = entries.findIndex((e) => e.id === entry.id);
  if (index === -1) {
    if (!entry.text && !entry.final) return entries;
    return [...entries, { ...entry, at: now }];
  }
  const existing = entries[index];
  const next: TranscriptEntry = {
    ...existing,
    text: entry.text,
    final: entry.final || existing.final,
    sources: entry.sources ?? existing.sources,
  };
  const copy = entries.slice();
  copy[index] = next;
  return copy;
}

function withOrb(state: ConversationState): ConversationState {
  const orb = deriveOrbState(state, state.now);
  return orb === state.orb ? state : { ...state, orb };
}

function finishUserSpeech(state: ConversationState, now: number, durationMs?: number): ConversationState {
  if (!state.userSpeaking && durationMs === undefined) return state;
  const measured =
    durationMs !== undefined
      ? durationMs / 1000
      : state.userSpeechStartedAt !== null
        ? Math.max(0, now - state.userSpeechStartedAt) / 1000
        : 0;
  return {
    ...state,
    userSpeaking: false,
    userSpeechStartedAt: null,
    userSpeechSeconds: state.userSpeechSeconds + measured,
  };
}

function finishAssistantSpeech(state: ConversationState, now: number, durationMs?: number): ConversationState {
  if (!state.assistantSpeaking) return state;
  const measured =
    durationMs !== undefined
      ? durationMs / 1000
      : state.assistantSpeechStartedAt !== null
        ? Math.max(0, now - state.assistantSpeechStartedAt) / 1000
        : 0;
  return {
    ...state,
    assistantSpeaking: false,
    assistantSpeechStartedAt: null,
    assistantSpeechSeconds: state.assistantSpeechSeconds + measured,
    outputLevel: 0,
  };
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  const now = "now" in action && action.type === "tick" ? action.now : (action as { at?: number }).at ?? state.now;
  const base: ConversationState = now !== state.now ? { ...state, now } : state;

  switch (action.type) {
    case "tick":
      return withOrb(base);

    case "reset":
      return withOrb({ ...initialConversationState(now), muted: state.muted });

    case "mic": {
      const next: ConversationState = { ...base, mic: action.status, micError: action.error ?? null };
      if (action.status === "requesting") next.connection = "requesting_mic";
      else if (action.status === "denied" && base.connection === "requesting_mic") next.connection = "disconnected";
      return withOrb(next);
    }

    case "set_muted":
      return withOrb({ ...base, muted: action.muted, userSpeaking: action.muted ? false : base.userSpeaking });

    case "status": {
      const next: ConversationState = { ...base, connection: action.status };
      if (action.status === "connected") {
        next.connectedSince = base.connectedSince ?? now;
        next.lastError = base.lastError?.recoverable ? null : base.lastError;
        if (base.connection === "reconnecting") {
          // A fresh transport: nothing is in flight any more.
          next.userSpeaking = false;
          next.assistantSpeaking = false;
          next.awaitingResponse = false;
          next.activeTool = null;
          next.currentResponseId = null;
        }
      }
      if (action.status === "reconnecting" || action.status === "connecting") {
        next.assistantSpeaking = false;
        next.userSpeaking = false;
        next.outputLevel = 0;
      }
      if (action.status === "ended" || action.status === "disconnected") {
        next.assistantSpeaking = false;
        next.userSpeaking = false;
        next.awaitingResponse = false;
        next.activeTool = null;
        next.outputLevel = 0;
      }
      return withOrb(next);
    }

    case "session":
      return withOrb({ ...base, session: action.info });

    case "user_speech_started":
      if (base.userSpeaking) return withOrb(base);
      return withOrb({
        ...base,
        userSpeaking: true,
        userSpeechStartedAt: now,
        // Speaking again cancels "thinking" from a previous turn boundary.
        awaitingResponse: base.assistantSpeaking ? false : base.awaitingResponse,
      });

    case "user_speech_stopped":
      return withOrb({ ...finishUserSpeech(base, now, action.durationMs), awaitingResponse: true });

    case "response_started":
      return withOrb({
        ...base,
        currentResponseId: action.responseId,
        responseStartedAt: now,
        awaitingResponse: base.userSpeaking ? base.awaitingResponse : true,
        interruptedAt: null,
      });

    case "assistant_speech_started": {
      const latency = base.responseStartedAt !== null ? Math.max(0, now - base.responseStartedAt) : null;
      return withOrb({
        ...base,
        assistantSpeaking: true,
        assistantSpeechStartedAt: now,
        awaitingResponse: false,
        responseStartedAt: null,
        interruptedAt: null,
        latenciesMs: latency !== null ? [...base.latenciesMs, latency] : base.latenciesMs,
        currentResponseId: action.responseId || base.currentResponseId,
      });
    }

    case "assistant_speech_stopped":
      return withOrb(finishAssistantSpeech(base, now, action.durationMs));

    case "response_done": {
      const isCurrent = base.currentResponseId === null || base.currentResponseId === action.responseId;
      const next: ConversationState = {
        ...base,
        responses: base.responses + 1,
        usage: addUsage(base.usage, action.usage),
        currentResponseId: base.currentResponseId === action.responseId ? null : base.currentResponseId,
        responseStartedAt: isCurrent ? null : base.responseStartedAt,
      };
      // A stale `done` (e.g. the cancelled response after a barge-in) must not clear
      // "thinking" for the turn the user has since finished.
      if (isCurrent && !base.interruptedAt) {
        // Keep "thinking" while a tool is still running (its follow-up response is coming).
        if (!base.assistantSpeaking && base.activeTool === null) next.awaitingResponse = false;
        if (action.status === "cancelled" || action.status === "failed") next.awaitingResponse = base.activeTool !== null;
      } else if (isCurrent && base.interruptedAt && base.currentResponseId === null && !base.userSpeaking && !base.awaitingResponse) {
        next.awaitingResponse = false;
      }
      return withOrb(next);
    }

    case "interrupted":
      return withOrb({
        ...finishAssistantSpeech(base, now),
        interruptedAt: now,
        interruptions: base.interruptions + 1,
        awaitingResponse: false,
        activeTool: null,
        // The cancelled response is no longer "current"; its `done` is informational only.
        currentResponseId: null,
        responseStartedAt: null,
      });

    case "transcript": {
      const sources =
        action.role === "assistant" && action.final && base.pendingSources ? base.pendingSources : undefined;
      const entries = upsertTranscript(
        base.transcript,
        { id: action.itemId, role: action.role, text: action.text, final: action.final, sources },
        now,
      );
      return withOrb({
        ...base,
        transcript: entries,
        pendingSources: sources ? null : base.pendingSources,
      });
    }

    case "tool_call":
      return withOrb({ ...base, activeTool: action.call.name, awaitingResponse: true });

    case "tool_result": {
      const result: ToolCallResult = action.result;
      return withOrb({
        ...base,
        activeTool: null,
        // The model produces a follow-up response after every tool result (a goodbye for end_conversation).
        awaitingResponse: true,
        pendingSources: result.sources?.length ? result.sources : base.pendingSources,
      });
    }

    case "level":
      return { ...base, outputLevel: Math.max(0, Math.min(1, action.level)) };

    case "error": {
      const next: ConversationState = {
        ...base,
        lastError: { code: action.code, message: action.message, recoverable: action.recoverable },
      };
      if (!action.recoverable) {
        next.connection = "error";
        next.assistantSpeaking = false;
        next.userSpeaking = false;
        next.awaitingResponse = false;
        next.activeTool = null;
        next.outputLevel = 0;
      } else if (base.awaitingResponse && base.activeTool === null && base.connection === "connected") {
        // A recoverable error mid-turn (e.g. response failed): stop showing "thinking".
        next.awaitingResponse = false;
      }
      return withOrb(next);
    }

    case "ended":
      return withOrb({
        ...finishAssistantSpeech(finishUserSpeech(base, now), now),
        connection: "ended",
        endedReason: action.reason,
        awaitingResponse: false,
        activeTool: null,
        outputLevel: 0,
        currentResponseId: null,
      });

    default:
      return withOrb(base);
  }
}

/** Seconds connected so far (live clock). */
export function connectedSeconds(state: ConversationState, now: number = state.now): number {
  if (state.connectedSince === null) return 0;
  return Math.max(0, Math.round((now - state.connectedSince) / 1000));
}

/** Plain-words status line for the UI, in the companion's name. */
export function describeStatus(state: ConversationState, companionName: string, now: number = state.now): string {
  if (state.lastError && !state.lastError.recoverable) return state.lastError.message;
  switch (state.connection) {
    case "disconnected":
      return state.micError ? state.micError.message : "Press Start talking when you're ready.";
    case "requesting_mic":
      return "Asking for the microphone…";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting… hold on a moment.";
    case "ended":
      return "Conversation ended.";
    case "error":
      return state.lastError?.message ?? "Something went wrong.";
    default:
      break;
  }
  const orb = deriveOrbState(state, now);
  switch (orb) {
    case "interrupted":
      return "Okay, go ahead.";
    case "listening":
      return "Listening";
    case "thinking":
      return state.activeTool ? (describeTool(state.activeTool) ?? "Thinking") : "Thinking";
    case "speaking":
      return `${companionName} is speaking — say something or tap Stop to interrupt`;
    case "muted":
      return "Microphone is off. Tap Unmute or type below.";
    default:
      return state.lastError?.recoverable ? state.lastError.message : "I'm listening whenever you're ready.";
  }
}
