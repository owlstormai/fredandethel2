/**
 * Conversation adapter contract.
 *
 * The UI (orb, transcript, controls) depends ONLY on this interface. Two
 * adapters implement it:
 *   - OpenAIRealtimeAdapter  (live mode: real WebRTC audio to the Realtime API)
 *   - DemoAdapter            (demo mode: no paid API, browser speech, simulated)
 *
 * Memory, consent, usage and tools are APPLICATION concerns served by our own
 * API routes; adapters never talk to the database directly.
 */
import type {
  AppMode,
  ConnectionStatus,
  ModelKey,
  SearchSource,
  TokenUsage,
} from "@/lib/types";

export interface AdapterSessionInfo {
  mode: AppMode;
  conversationId: string;
  modelKey: ModelKey;
  modelId: string;
  /** Human label for the voice in use ("Fred" / "Ethel"). */
  voiceLabel: string;
  /** Provider voice id, e.g. "cedar". Demo: "browser-speech". */
  voiceId: string;
  /** What the app injected: counts only, so the UI can say "I'm using 4 memories". */
  context: { memoryCount: number; summaryCount: number; estimatedTokens: number };
  /** True when any part of the audio or AI is simulated. Always surfaced in UI. */
  simulated: boolean;
  expiresAt: string | null;
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  /** JSON-serialisable string handed back to the model as function output. */
  output: string;
  sources?: SearchSource[];
  /** Optional UI side-effect the app should render (consent card, memory toast). */
  uiAction?:
    | { type: "consent_prompt"; scope: "memory" | "sensitive_memory" | "web_search" }
    | { type: "memory_saved"; memoryId: string; content: string }
    | { type: "memory_deleted"; memoryId: string }
    | { type: "humor_changed"; level: "off" | "gentle" | "playful" }
    | { type: "name_set"; name: string }
    | { type: "end_conversation" };
}

/** Posts tool calls to /api/tools/dispatch; implemented once, shared by adapters. */
export interface ToolDispatcher {
  dispatch(conversationId: string, call: ToolCallRequest): Promise<ToolCallResult>;
}

export type AdapterEvent =
  | { type: "status"; status: ConnectionStatus; detail?: string }
  | { type: "session"; info: AdapterSessionInfo }
  | { type: "user_speech_started" }
  | { type: "user_speech_stopped" }
  | { type: "response_started"; responseId: string }
  | { type: "assistant_speech_started"; responseId: string }
  | { type: "assistant_speech_stopped"; responseId: string }
  | { type: "response_done"; responseId: string; status: string; usage: TokenUsage | null }
  | { type: "interrupted"; responseId: string | null }
  | {
      type: "transcript";
      role: "user" | "assistant";
      itemId: string;
      text: string;
      /** false while streaming deltas; true once the item is complete. */
      final: boolean;
    }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "tool_result"; call: ToolCallRequest; result: ToolCallResult }
  | {
      /** Synthetic output amplitude 0..1 for adapters whose audio cannot be analysed (demo). */
      type: "level";
      source: "assistant";
      level: number;
    }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "ended"; reason: string };

export interface AdapterConnectOptions {
  modelKey: ModelKey;
  /** Continue an existing conversation (used for model switching). */
  conversationId?: string;
  micStream: MediaStream | null;
  tools: ToolDispatcher;
  onEvent: (event: AdapterEvent) => void;
  signal?: AbortSignal;
}

export interface ConversationAdapter {
  readonly mode: AppMode;
  connect(options: AdapterConnectOptions): Promise<AdapterSessionInfo>;
  disconnect(reason?: string): Promise<void>;
  /** Barge-in: stop assistant output immediately. */
  interrupt(): void;
  setMuted(muted: boolean): void;
  /** Typed input fallback (also used by tests). */
  sendText(text: string): void;
  /**
   * Remote audio for the orb analyser. Live: the WebRTC remote stream.
   * Demo: null (DemoAdapter emits `level` events instead).
   */
  getRemoteAudioStream(): MediaStream | null;
}
