"use client";
/**
 * OpenAIRealtimeAdapter — live mode. Real two-way audio over WebRTC to the
 * OpenAI Realtime API using a server-minted ephemeral client secret.
 *
 * Responsibilities:
 *   - POST /api/realtime/session -> { clientSecret, callsUrl, ... } (our server
 *     chooses model, voice, instructions, VAD and tools; nothing secret here)
 *   - drive RealtimeWebRTCClient and translate server events -> AdapterEvents
 *   - barge-in: the moment `input_audio_buffer.speech_started` arrives while
 *     the assistant is audible we send `response.cancel` + `output_audio_buffer.clear`
 *     (the server also truncates automatically over WebRTC; we do not wait for it)
 *   - function calls -> ToolDispatcher -> function_call_output per call, then ONE
 *     response.create once every call of that turn has its output (reasoning
 *     models may emit several function calls in one response; a response.create
 *     per call would race the active response and drop outputs)
 *   - reconnect with app-owned context rehydration (continueConversationId)
 *   - session max-duration timer with a 2-minute warning
 *
 * Pause tolerance is deliberately NOT implemented here: turn detection is the
 * server-configured semantic VAD (eagerness from the pause-sensitivity
 * preference). This adapter never cuts a speaker off on its own.
 */
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { RealtimeSessionResponse } from "@/lib/api/contracts";
import type { ModelKey, TokenUsage } from "@/lib/types";
import {
  createRemoteAudioElement,
  ensureAudioPlayback,
  removeAudioElement,
  setTrackEnabled,
} from "@/lib/ai/realtime/audio";
import { RealtimeConnectError, RealtimeWebRTCClient, type RealtimeTransport } from "@/lib/ai/realtime/client";
import type { RealtimeClientEvent, RealtimeServerEvent, RealtimeUsage } from "@/lib/ai/realtime/events";
import type {
  AdapterConnectOptions,
  AdapterEvent,
  AdapterSessionInfo,
  ConversationAdapter,
  ToolCallRequest,
  ToolDispatcher,
} from "./types";

export interface RemoteAudioHandle {
  setMuted(muted: boolean): void;
  stop(): void;
}

export type FetchJson = <T>(path: string, init: Parameters<typeof apiFetch>[1]) => Promise<T>;

export interface OpenAIRealtimeAdapterOptions {
  /** Injected for tests; defaults to a real RealtimeWebRTCClient per connection. */
  createTransport?: () => RealtimeTransport;
  /** Injected for tests; defaults to apiFetch (same-origin cookies). */
  fetchJson?: FetchJson;
  /** Injected for tests; defaults to a hidden <audio> element. */
  attachRemoteAudio?: (stream: MediaStream) => RemoteAudioHandle;
  now?: () => number;
  /** Send `response.create` once the session is created so the companion greets first. Default true. */
  greetOnConnect?: boolean;
  /** Reconnect backoff schedule in ms. Default [1000, 2000, 4000]. */
  reconnectBackoffMs?: number[];
  /** Grace period before a "disconnected" peer state triggers a reconnect. Default 3000. */
  disconnectGraceMs?: number;
  /** Warn this long before the session limit. Default 120_000. */
  sessionWarningMs?: number;
}

const UNRECOVERABLE_ERROR = /(invalid_api_key|invalid_client_secret|client_secret|session_expired|session_not_found|unauthorized|forbidden|insufficient_quota|authentication)/i;

const SESSION_ERROR_MESSAGES: Record<string, string> = {
  live_unavailable: "Live voice isn't set up on this server yet. The simulated demo still works.",
  cap_reached: "Today's talking budget has been used up. Please try again tomorrow.",
  demo_user: "This is a demo account, which uses the simulated companion rather than live AI.",
};

export function mapRealtimeUsage(usage: RealtimeUsage | undefined | null): TokenUsage | null {
  if (!usage) return null;
  const input = usage.input_token_details ?? {};
  const output = usage.output_token_details ?? {};
  const cachedAudio = input.cached_tokens_details?.audio_tokens ?? 0;
  const cachedText =
    input.cached_tokens_details?.text_tokens ?? Math.max(0, (input.cached_tokens ?? 0) - cachedAudio);
  return {
    inputTextTokens: input.text_tokens ?? 0,
    inputAudioTokens: input.audio_tokens ?? 0,
    cachedTextTokens: cachedText,
    cachedAudioTokens: cachedAudio,
    outputTextTokens: output.text_tokens ?? 0,
    outputAudioTokens: output.audio_tokens ?? 0,
  };
}

function defaultAttachRemoteAudio(stream: MediaStream): RemoteAudioHandle {
  if (typeof document === "undefined") return { setMuted: () => {}, stop: () => {} };
  const el = createRemoteAudioElement(stream);
  void ensureAudioPlayback(el);
  return {
    setMuted: (muted) => {
      el.muted = muted;
    },
    stop: () => removeAudioElement(el),
  };
}

type Phase = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export class OpenAIRealtimeAdapter implements ConversationAdapter {
  readonly mode = "live" as const;

  private readonly createTransport: () => RealtimeTransport;
  private readonly fetchJson: FetchJson;
  private readonly attachRemoteAudio: (stream: MediaStream) => RemoteAudioHandle;
  private readonly now: () => number;
  private readonly greetOnConnect: boolean;
  private readonly reconnectBackoffMs: number[];
  private readonly disconnectGraceMs: number;
  private readonly sessionWarningMs: number;

  private phase: Phase = "idle";
  private transport: RealtimeTransport | null = null;
  private remoteAudio: RemoteAudioHandle | null = null;
  private outputMuted = false;
  private micStream: MediaStream | null = null;
  private muted = false;
  private tools: ToolDispatcher | null = null;
  private onEvent: (event: AdapterEvent) => void = () => {};
  private signal: AbortSignal | undefined;
  private modelKey: ModelKey = "full";
  private sessionInfo: AdapterSessionInfo | null = null;
  private sessionResponse: RealtimeSessionResponse | null = null;

  // per-response state
  private activeResponseId: string | null = null;
  private assistantSpeaking = false;
  private assistantSpeechStartedAt: number | null = null;
  private userSpeechStartedAt: number | null = null;
  private userAudioStartMs: number | null = null;
  private assistantTranscripts = new Map<string, string>();
  private userTranscripts = new Map<string, string>();
  private greeted = false;
  private pendingToolCalls = 0;
  /** item_id -> function name, from response.output_item.added (fallback when arguments.done lacks `name`). */
  private functionCallNames = new Map<string, string>();

  // timers
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionWarningTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionEndTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionStartedAt: number | null = null;
  private reconnecting = false;

  constructor(options: OpenAIRealtimeAdapterOptions = {}) {
    this.createTransport = options.createTransport ?? (() => new RealtimeWebRTCClient());
    this.fetchJson = options.fetchJson ?? apiFetch;
    this.attachRemoteAudio = options.attachRemoteAudio ?? defaultAttachRemoteAudio;
    this.now = options.now ?? (() => Date.now());
    this.greetOnConnect = options.greetOnConnect ?? true;
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? [1000, 2000, 4000];
    this.disconnectGraceMs = options.disconnectGraceMs ?? 3000;
    this.sessionWarningMs = options.sessionWarningMs ?? 120_000;
  }

  // ---------------------------------------------------------------------------
  // ConversationAdapter
  // ---------------------------------------------------------------------------

  async connect(options: AdapterConnectOptions): Promise<AdapterSessionInfo> {
    if (this.phase !== "idle") throw new Error("Adapter already connected; create a new adapter per session.");
    this.phase = "connecting";
    this.onEvent = options.onEvent;
    this.tools = options.tools;
    this.micStream = options.micStream;
    this.signal = options.signal;
    this.modelKey = options.modelKey;
    setTrackEnabled(this.micStream, !this.muted);

    this.emit({ type: "status", status: "connecting" });
    try {
      const session = await this.mintSession(options.conversationId);
      this.throwIfAborted();
      await this.openTransport(session);
      this.throwIfAborted();
    } catch (error) {
      this.teardownTransport();
      this.phase = "idle";
      if (this.isAbort(error)) {
        this.phase = "closed";
        throw error;
      }
      const mapped = this.describeConnectError(error);
      this.phase = "closed";
      this.emit({ type: "error", code: mapped.code, message: mapped.message, recoverable: false });
      throw error;
    }

    this.phase = "connected";
    this.startSessionTimers();
    this.emit({ type: "status", status: "connected" });
    return this.sessionInfo as AdapterSessionInfo;
  }

  async disconnect(reason = "user_ended"): Promise<void> {
    if (this.phase === "closed") return;
    const wasOpen = this.phase === "connected" || this.phase === "reconnecting";
    this.phase = "closed";
    this.clearTimers();
    if (this.assistantSpeaking) this.finishAssistantSpeech();
    this.teardownTransport();
    if (wasOpen || reason !== "user_ended") this.emit({ type: "ended", reason });
  }

  interrupt(): void {
    if (this.phase !== "connected") return;
    this.sendCancel();
    const responseId = this.activeResponseId;
    this.finishAssistantSpeech();
    this.emit({ type: "interrupted", responseId });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    setTrackEnabled(this.micStream, !muted);
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.phase !== "connected") return;
    if (this.assistantSpeaking) this.interrupt();
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
    });
    this.send({ type: "response.create" });
    this.emit({ type: "transcript", role: "user", itemId: `typed_${this.now()}`, text: trimmed, final: true });
  }

  getRemoteAudioStream(): MediaStream | null {
    return this.transport?.remoteStream ?? null;
  }

  /** Comparison mode: silence this adapter's speaker output without affecting events. */
  setOutputMuted(muted: boolean): void {
    this.outputMuted = muted;
    this.remoteAudio?.setMuted(muted);
  }

  get currentSessionInfo(): AdapterSessionInfo | null {
    return this.sessionInfo;
  }

  // ---------------------------------------------------------------------------
  // Connection plumbing
  // ---------------------------------------------------------------------------

  private async mintSession(continueConversationId?: string): Promise<RealtimeSessionResponse> {
    const session = await this.fetchJson<RealtimeSessionResponse>("/api/realtime/session", {
      method: "POST",
      json: { modelKey: this.modelKey, ...(continueConversationId ? { continueConversationId } : {}) },
      signal: this.signal,
    });
    this.sessionResponse = session;
    this.sessionInfo = {
      mode: "live",
      conversationId: session.conversationId,
      modelKey: session.model.key,
      modelId: session.model.id,
      voiceLabel: session.voice.label,
      voiceId: session.voice.id,
      context: {
        memoryCount: session.context.memoryCount,
        summaryCount: session.context.summaryCount,
        estimatedTokens: session.context.estimatedTokens,
      },
      simulated: false,
      expiresAt: session.expiresAt ?? null,
    };
    return session;
  }

  private async openTransport(session: RealtimeSessionResponse): Promise<void> {
    const transport = this.createTransport();
    this.transport = transport;
    this.resetTurnState();
    await transport.connect({
      clientSecret: session.clientSecret,
      callsUrl: session.callsUrl,
      micStream: this.micStream,
      signal: this.signal,
      onServerEvent: (event) => {
        if (this.transport === transport) this.handleServerEvent(event);
      },
      onRemoteStream: (stream) => {
        if (this.transport !== transport) return;
        this.remoteAudio?.stop();
        this.remoteAudio = this.attachRemoteAudio(stream);
        this.remoteAudio.setMuted(this.outputMuted);
      },
      onConnectionState: (state) => {
        if (this.transport === transport) this.handlePeerState(state);
      },
      onIceConnectionState: (state) => {
        if (this.transport !== transport) return;
        if (state === "failed") this.handlePeerState("failed");
        else if (state === "disconnected") this.handlePeerState("disconnected");
        else if (state === "connected" || state === "completed") this.handlePeerState("connected");
      },
      onDataChannelClose: () => {
        if (this.transport === transport && this.phase === "connected") void this.beginReconnect("data_channel_closed");
      },
    });
    if (this.sessionInfo) this.emit({ type: "session", info: this.sessionInfo });
  }

  private handlePeerState(state: RTCPeerConnectionState): void {
    if (this.phase !== "connected") return;
    if (state === "connected") {
      this.clearDisconnectTimer();
      return;
    }
    if (state === "failed" || state === "closed") {
      void this.beginReconnect(`peer_${state}`);
      return;
    }
    if (state === "disconnected" && !this.disconnectTimer) {
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        if (this.phase === "connected") void this.beginReconnect("peer_disconnected");
      }, this.disconnectGraceMs);
    }
  }

  private async beginReconnect(cause: string): Promise<void> {
    if (this.reconnecting || this.phase !== "connected") return;
    this.reconnecting = true;
    this.phase = "reconnecting";
    this.clearDisconnectTimer();
    if (this.assistantSpeaking) this.finishAssistantSpeech();
    this.teardownTransport();
    this.emit({ type: "status", status: "reconnecting", detail: cause });

    const continueId = this.sessionInfo?.conversationId;
    for (let attempt = 0; attempt < this.reconnectBackoffMs.length; attempt++) {
      await this.sleep(this.reconnectBackoffMs[attempt]);
      if (this.phase !== "reconnecting") return;
      try {
        const session = await this.mintSession(continueId);
        if (this.phase !== "reconnecting") return;
        await this.openTransport(session);
        if (this.phase !== "reconnecting") return;
        this.phase = "connected";
        this.reconnecting = false;
        this.greeted = true; // do not greet again mid-conversation
        this.emit({ type: "status", status: "connected", detail: "reconnected" });
        return;
      } catch (error) {
        this.teardownTransport();
        if (this.isAbort(error) || this.phase !== "reconnecting") return;
        if (error instanceof ApiClientError && error.status === 403) break; // caps/permissions: do not hammer
      }
    }
    if (this.phase !== "reconnecting") return;
    this.reconnecting = false;
    this.phase = "closed";
    this.clearTimers();
    this.emit({
      type: "error",
      code: "reconnect_failed",
      message: "We lost the connection and couldn't get it back. Please check your internet and press Start talking again.",
      recoverable: false,
    });
    this.emit({ type: "ended", reason: "reconnect_failed" });
  }

  private teardownTransport(): void {
    this.remoteAudio?.stop();
    this.remoteAudio = null;
    const transport = this.transport;
    this.transport = null;
    transport?.close();
  }

  private resetTurnState(): void {
    this.activeResponseId = null;
    this.assistantSpeaking = false;
    this.assistantSpeechStartedAt = null;
    this.userSpeechStartedAt = null;
    this.userAudioStartMs = null;
    this.assistantTranscripts.clear();
    this.userTranscripts.clear();
    this.pendingToolCalls = 0;
    this.functionCallNames.clear();
  }

  // ---------------------------------------------------------------------------
  // Session duration
  // ---------------------------------------------------------------------------

  private startSessionTimers(): void {
    const max = this.sessionResponse?.maxSessionSeconds;
    if (!max || max <= 0 || this.sessionStartedAt !== null) return;
    this.sessionStartedAt = this.now();
    const totalMs = max * 1000;
    const warnAt = totalMs - this.sessionWarningMs;
    if (warnAt > 0) {
      this.sessionWarningTimer = setTimeout(() => {
        this.sessionWarningTimer = null;
        if (this.phase === "connected" || this.phase === "reconnecting") {
          this.emit({
            type: "error",
            code: "session_ending_soon",
            message: "We'll need to wrap up in about two minutes.",
            recoverable: true,
          });
        }
      }, warnAt);
    }
    this.sessionEndTimer = setTimeout(() => {
      this.sessionEndTimer = null;
      void this.disconnect("session_limit");
    }, totalMs);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearDisconnectTimer();
    if (this.sessionWarningTimer) clearTimeout(this.sessionWarningTimer);
    if (this.sessionEndTimer) clearTimeout(this.sessionEndTimer);
    this.sessionWarningTimer = null;
    this.sessionEndTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Server event mapping
  // ---------------------------------------------------------------------------

  private handleServerEvent(event: RealtimeServerEvent): void {
    switch (event.type) {
      case "session.created":
        if (this.greetOnConnect && !this.greeted) {
          this.greeted = true;
          this.send({ type: "response.create" });
        }
        return;

      case "input_audio_buffer.speech_started": {
        const e = event as { audio_start_ms?: number };
        this.userSpeechStartedAt = this.now();
        this.userAudioStartMs = typeof e.audio_start_ms === "number" ? e.audio_start_ms : null;
        this.emit({ type: "user_speech_started" });
        if (this.assistantSpeaking) {
          // Barge-in: stop the assistant NOW; do not wait for the server's own truncation.
          const responseId = this.activeResponseId;
          this.sendCancel();
          this.finishAssistantSpeech();
          this.emit({ type: "interrupted", responseId });
        }
        return;
      }

      case "input_audio_buffer.speech_stopped": {
        const e = event as { audio_end_ms?: number };
        let durationMs: number | undefined;
        if (typeof e.audio_end_ms === "number" && this.userAudioStartMs !== null) {
          durationMs = Math.max(0, e.audio_end_ms - this.userAudioStartMs);
        } else if (this.userSpeechStartedAt !== null) {
          durationMs = Math.max(0, this.now() - this.userSpeechStartedAt);
        }
        this.userSpeechStartedAt = null;
        this.userAudioStartMs = null;
        this.emit({ type: "user_speech_stopped", ...(durationMs !== undefined ? { durationMs } : {}) });
        return;
      }

      case "response.created": {
        const e = event as { response?: { id?: string } };
        this.activeResponseId = e.response?.id ?? null;
        this.emit({ type: "response_started", responseId: this.activeResponseId ?? "" });
        return;
      }

      case "output_audio_buffer.started": {
        const e = event as { response_id?: string };
        this.assistantSpeaking = true;
        this.assistantSpeechStartedAt = this.now();
        this.emit({ type: "assistant_speech_started", responseId: e.response_id ?? this.activeResponseId ?? "" });
        return;
      }

      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        const e = event as { response_id?: string };
        this.finishAssistantSpeech(e.response_id);
        return;
      }

      case "response.output_audio_transcript.delta": {
        const e = event as { item_id: string; delta: string };
        const text = (this.assistantTranscripts.get(e.item_id) ?? "") + (e.delta ?? "");
        this.assistantTranscripts.set(e.item_id, text);
        this.emit({ type: "transcript", role: "assistant", itemId: e.item_id, text, final: false });
        return;
      }

      case "response.output_audio_transcript.done": {
        const e = event as { item_id: string; transcript?: string };
        const text = e.transcript ?? this.assistantTranscripts.get(e.item_id) ?? "";
        this.assistantTranscripts.delete(e.item_id);
        this.emit({ type: "transcript", role: "assistant", itemId: e.item_id, text, final: true });
        return;
      }

      case "response.output_text.delta": {
        const e = event as { item_id: string; delta: string };
        const text = (this.assistantTranscripts.get(e.item_id) ?? "") + (e.delta ?? "");
        this.assistantTranscripts.set(e.item_id, text);
        this.emit({ type: "transcript", role: "assistant", itemId: e.item_id, text, final: false });
        return;
      }

      case "response.output_text.done": {
        const e = event as { item_id: string; text?: string };
        const text = e.text ?? this.assistantTranscripts.get(e.item_id) ?? "";
        this.assistantTranscripts.delete(e.item_id);
        this.emit({ type: "transcript", role: "assistant", itemId: e.item_id, text, final: true });
        return;
      }

      case "conversation.item.input_audio_transcription.delta": {
        const e = event as { item_id: string; delta: string };
        const text = (this.userTranscripts.get(e.item_id) ?? "") + (e.delta ?? "");
        this.userTranscripts.set(e.item_id, text);
        this.emit({ type: "transcript", role: "user", itemId: e.item_id, text, final: false });
        return;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const e = event as { item_id: string; transcript?: string };
        const text = (e.transcript ?? this.userTranscripts.get(e.item_id) ?? "").trim();
        this.userTranscripts.delete(e.item_id);
        this.emit({ type: "transcript", role: "user", itemId: e.item_id, text, final: true });
        return;
      }

      case "conversation.item.input_audio_transcription.failed":
        // Transcription is guidance only; the model heard the audio. Nothing to show.
        this.userTranscripts.delete((event as { item_id: string }).item_id);
        return;

      case "response.output_item.added":
      case "response.output_item.done": {
        // Remember the function name per item so a `function_call_arguments.done`
        // without `name` (schema drift) still dispatches the right tool.
        const item = (event as { item?: { id?: unknown; type?: unknown; name?: unknown } }).item;
        if (item?.type === "function_call" && typeof item.id === "string" && typeof item.name === "string") {
          this.functionCallNames.set(item.id, item.name);
        }
        return;
      }

      case "response.function_call_arguments.done": {
        const e = event as { call_id: string; name?: string; arguments: string; item_id?: string };
        const trackedName = e.item_id ? this.functionCallNames.get(e.item_id) : undefined;
        if (e.item_id) this.functionCallNames.delete(e.item_id);
        void this.runToolCall({
          callId: e.call_id,
          name: e.name ?? trackedName ?? "",
          arguments: parseArguments(e.arguments),
        });
        return;
      }

      case "response.done": {
        const e = event as { response?: { id?: string; status?: string; usage?: RealtimeUsage; output?: Array<Record<string, unknown>> } };
        const response = e.response ?? {};
        const responseId = response.id ?? this.activeResponseId ?? "";
        if (this.activeResponseId === responseId) this.activeResponseId = null;
        this.functionCallNames.clear();
        this.emit({
          type: "response_done",
          responseId,
          status: response.status ?? "completed",
          usage: mapRealtimeUsage(response.usage),
        });
        return;
      }

      case "error": {
        const e = event as { error?: { code?: string | null; message?: string; type?: string } };
        const code = e.error?.code ?? e.error?.type ?? "realtime_error";
        const message = e.error?.message ?? "The voice service reported a problem.";
        const recoverable = !UNRECOVERABLE_ERROR.test(`${code} ${message}`);
        this.emit({ type: "error", code, message, recoverable });
        if (!recoverable) void this.disconnect("session_error");
        return;
      }

      case "rate_limits.updated":
      default:
        return;
    }
  }

  private async runToolCall(call: ToolCallRequest): Promise<void> {
    if (!this.tools || !this.sessionInfo) return;
    this.pendingToolCalls += 1;
    this.emit({ type: "tool_call", call });
    let result;
    try {
      result = await this.tools.dispatch(this.sessionInfo.conversationId, call);
    } catch (error) {
      result = { output: JSON.stringify({ error: "tool_failed", message: (error as Error)?.message ?? "failed" }) };
    }
    this.pendingToolCalls = Math.max(0, this.pendingToolCalls - 1);
    if (this.phase !== "connected") return;
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.callId, output: result.output },
    });
    // Ask for the follow-up response (for end_conversation this is the goodbye) once
    // EVERY pending call has its output: parallel tool calls share one response.
    if (this.pendingToolCalls === 0) this.send({ type: "response.create" });
    this.emit({ type: "tool_result", call, result });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private sendCancel(): void {
    this.send({ type: "response.cancel", ...(this.activeResponseId ? { response_id: this.activeResponseId } : {}) });
    this.send({ type: "output_audio_buffer.clear" });
  }

  private finishAssistantSpeech(responseId?: string): void {
    if (!this.assistantSpeaking) return;
    this.assistantSpeaking = false;
    const durationMs = this.assistantSpeechStartedAt !== null ? Math.max(0, this.now() - this.assistantSpeechStartedAt) : undefined;
    this.assistantSpeechStartedAt = null;
    this.emit({
      type: "assistant_speech_stopped",
      responseId: responseId ?? this.activeResponseId ?? "",
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }

  private send(event: RealtimeClientEvent): void {
    this.transport?.send(event);
  }

  private emit(event: AdapterEvent): void {
    try {
      this.onEvent(event);
    } catch {
      /* listeners must not break the adapter */
    }
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) {
      const error = new Error("Connection cancelled.");
      error.name = "AbortError";
      throw error;
    }
  }

  private isAbort(error: unknown): boolean {
    if (this.signal?.aborted) return true;
    const name = (error as { name?: string } | null)?.name;
    const code = (error as { code?: string } | null)?.code;
    return name === "AbortError" || code === "aborted";
  }

  private describeConnectError(error: unknown): { code: string; message: string } {
    if (error instanceof ApiClientError) {
      return { code: error.code, message: SESSION_ERROR_MESSAGES[error.code] ?? error.message };
    }
    if (error instanceof RealtimeConnectError) {
      const message =
        error.code === "timeout"
          ? "The voice connection took too long. Please check your internet and try again."
          : error.code === "network"
            ? "We couldn't reach the voice service. Please check your internet and try again."
            : error.code === "unsupported"
              ? "This browser can't make a voice call. Please try the latest Chrome, Edge, Safari or Firefox."
              : "The voice connection didn't go through. Please try again.";
      return { code: `connect_${error.code}`, message };
    }
    return { code: "connect_failed", message: "We couldn't start the conversation. Please try again." };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
