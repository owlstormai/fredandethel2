"use client";
/**
 * useConversation — wires an adapter, the pure reducer, telemetry and timers
 * into one hook the voice UI consumes. One hook instance == one logical
 * conversation (which may span several provider sessions via model switch or
 * reconnect continuation).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createAdapter as defaultCreateAdapter, isOutputMutable, type AdapterFactoryOptions } from "@/lib/ai/adapters";
import type { AdapterEvent, ConversationAdapter, ToolCallRequest, ToolDispatcher } from "@/lib/ai/adapters/types";
import { acquireMicrophone as defaultAcquireMicrophone, setTrackEnabled, stopStream, type MicError } from "@/lib/ai/realtime/audio";
import {
  conversationReducer,
  initialConversationState,
  type ConversationState,
} from "@/lib/ai/realtime/conversationState";
import { clientToolDispatcher, type UiAction } from "@/lib/ai/tools/clientDispatcher";
import { apiFetch } from "@/lib/api/client";
import type { EndConversationResponse } from "@/lib/api/contracts";
import type { AppMode, CompanionVoice, ModelKey, PauseSensitivity } from "@/lib/types";
import { createTelemetryMapper, TelemetryBatcher, type TelemetryBatcherOptions } from "./telemetry";

export const MODEL_LABELS: Record<ModelKey, string> = { full: "Full quality", mini: "Lower cost" };
const TICK_MS = 250;
const END_AFTER_GOODBYE_FALLBACK_MS = 12_000;
const END_AFTER_RESPONSE_DONE_MS = 2500;

export interface UseConversationOptions {
  mode: AppMode;
  modelKey: ModelKey;
  companionVoice: CompanionVoice;
  pauseSensitivity: PauseSensitivity;
  /** Silence this adapter's speaker output (developer comparison secondary). */
  outputMuted?: boolean;
  /** Record telemetry to /api/conversations/:id/events. Default true. */
  telemetry?: boolean;
  onUiAction?: (action: UiAction, call: ToolCallRequest) => void;
  onEnded?: (summary: EndConversationResponse | null, reason: string) => void;
  // --- injection points for tests ---
  createAdapter?: (mode: AppMode, options: AdapterFactoryOptions) => ConversationAdapter;
  tools?: ToolDispatcher;
  acquireMic?: typeof defaultAcquireMicrophone;
  telemetryOptions?: Partial<Omit<TelemetryBatcherOptions, "conversationId">>;
  endConversation?: (conversationId: string) => Promise<EndConversationResponse | null>;
  now?: () => number;
}

export interface StartOptions {
  /** Use a caller-owned microphone stream (shared between adapters in comparison mode). */
  micStream?: MediaStream | null;
  /** Skip the microphone entirely (typing only). */
  skipMic?: boolean;
}

export interface UseConversationResult {
  state: ConversationState;
  micStream: MediaStream | null;
  remoteStream: MediaStream | null;
  modelKey: ModelKey;
  starting: boolean;
  ending: boolean;
  summary: EndConversationResponse | null;
  switchNote: string | null;
  /** Acquire the mic (unless provided/skipped) and connect. Safe to call twice. */
  start(options?: StartOptions): Promise<void>;
  /** End: disconnect, flush telemetry, POST /end, expose `summary`. Idempotent. */
  end(reason?: string): Promise<EndConversationResponse | null>;
  interrupt(): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  sendText(text: string): void;
  /** Disconnect and reconnect with continueConversationId so app-owned context is rehydrated. */
  switchModel(modelKey: ModelKey): Promise<void>;
  clearSwitchNote(): void;
  /** Back to the idle "Start talking" screen (clears summary + transcript). */
  reset(): void;
}

const defaultEndConversation = async (conversationId: string): Promise<EndConversationResponse | null> => {
  try {
    return await apiFetch<EndConversationResponse>(`/api/conversations/${encodeURIComponent(conversationId)}/end`, {
      method: "POST",
    });
  } catch {
    return null;
  }
};

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const [state, dispatch] = useReducer(conversationReducer, 0, initialConversationState);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [modelKey, setModelKey] = useState<ModelKey>(options.modelKey);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<EndConversationResponse | null>(null);
  const [switchNote, setSwitchNote] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const now = useCallback(() => optionsRef.current.now?.() ?? Date.now(), []);

  const adapterRef = useRef<ConversationAdapter | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ownMicRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  const modelKeyRef = useRef<ModelKey>(options.modelKey);
  const conversationIdRef = useRef<string | null>(null);
  const telemetryRef = useRef<TelemetryBatcher | null>(null);
  const mapperRef = useRef(createTelemetryMapper(now));
  const startingRef = useRef(false);
  const endingRef = useRef<Promise<EndConversationResponse | null> | null>(null);
  const switchingRef = useRef(false);
  const pendingEndRef = useRef(false);
  const pendingEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantSpeakingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatchAt = useCallback(
    (event: AdapterEvent | { type: "mic"; status: "idle" | "requesting" | "granted" | "denied" | "skipped"; error?: MicError | null }) => {
      dispatch({ ...event, at: now() });
    },
    [now],
  );

  // --- telemetry per conversation id -----------------------------------------
  const rotateTelemetry = useCallback(
    (conversationId: string) => {
      const previous = telemetryRef.current;
      if (previous && previous.conversationId === conversationId) return;
      if (previous) void previous.stop();
      if (optionsRef.current.telemetry === false) {
        telemetryRef.current = null;
        return;
      }
      const batcher = new TelemetryBatcher({ conversationId, now, ...optionsRef.current.telemetryOptions });
      batcher.start();
      telemetryRef.current = batcher;
    },
    [now],
  );

  const clearPendingEndTimer = () => {
    if (pendingEndTimer.current) clearTimeout(pendingEndTimer.current);
    pendingEndTimer.current = null;
  };

  // --- end flow ----------------------------------------------------------------
  const finalizeEnd = useCallback(
    async (reason: string): Promise<EndConversationResponse | null> => {
      clearPendingEndTimer();
      pendingEndRef.current = false;
      const telemetry = telemetryRef.current;
      telemetryRef.current = null;
      if (telemetry) await telemetry.stop();
      const conversationId = conversationIdRef.current;
      let result: EndConversationResponse | null = null;
      if (conversationId) {
        const ender = optionsRef.current.endConversation ?? defaultEndConversation;
        result = await ender(conversationId);
      }
      if (ownMicRef.current) {
        stopStream(ownMicRef.current);
        ownMicRef.current = null;
      }
      micRef.current = null;
      setMicStream(null);
      setRemoteStream(null);
      setSummary(result);
      optionsRef.current.onEnded?.(result, reason);
      return result;
    },
    [],
  );

  const end = useCallback(
    (reason = "user_ended"): Promise<EndConversationResponse | null> => {
      if (endingRef.current) return endingRef.current;
      setEnding(true);
      const run = (async () => {
        abortRef.current?.abort();
        abortRef.current = null;
        const adapter = adapterRef.current;
        adapterRef.current = null;
        const wasActive = stateRef.current.connection !== "disconnected" && stateRef.current.connection !== "ended";
        if (adapter) {
          try {
            await adapter.disconnect(reason);
          } catch {
            /* ignore */
          }
        }
        if (wasActive && stateRef.current.connection !== "ended") dispatchAt({ type: "ended", reason });
        const result = await finalizeEnd(reason);
        return result;
      })().finally(() => {
        endingRef.current = null;
        setEnding(false);
      });
      endingRef.current = run;
      return run;
    },
    [dispatchAt, finalizeEnd],
  );

  // --- adapter event handling ----------------------------------------------------
  const handleAdapterEvent = useCallback(
    (event: AdapterEvent) => {
      dispatchAt(event);
      const telemetry = telemetryRef.current;
      if (telemetry) telemetry.pushAll(mapperRef.current(event));

      switch (event.type) {
        case "session": {
          const previousId = conversationIdRef.current;
          conversationIdRef.current = event.info.conversationId;
          if (previousId && previousId !== event.info.conversationId && !switchingRef.current) {
            // Reconnect continuation: the earlier record is done; mark it ended in the background.
            void (optionsRef.current.endConversation ?? defaultEndConversation)(previousId);
          }
          rotateTelemetry(event.info.conversationId);
          setRemoteStream(adapterRef.current?.getRemoteAudioStream() ?? null);
          break;
        }
        case "assistant_speech_started":
          assistantSpeakingRef.current = true;
          break;
        case "assistant_speech_stopped":
          assistantSpeakingRef.current = false;
          if (pendingEndRef.current) void end("assistant_ended");
          break;
        case "response_done":
          if (pendingEndRef.current && !assistantSpeakingRef.current && !pendingEndTimer.current) {
            pendingEndTimer.current = setTimeout(() => {
              pendingEndTimer.current = null;
              if (pendingEndRef.current) void end("assistant_ended");
            }, END_AFTER_RESPONSE_DONE_MS);
          }
          break;
        case "tool_result": {
          const action = event.result.uiAction;
          if (!action) break;
          if (action.type === "end_conversation" && !pendingEndRef.current) {
            pendingEndRef.current = true;
            clearPendingEndTimer();
            pendingEndTimer.current = setTimeout(() => {
              pendingEndTimer.current = null;
              if (pendingEndRef.current) void end("assistant_ended");
            }, END_AFTER_GOODBYE_FALLBACK_MS);
          }
          optionsRef.current.onUiAction?.(action, event.call);
          break;
        }
        case "ended":
          if (switchingRef.current) break; // model switch: a new session follows
          if (!endingRef.current) void end(event.reason);
          break;
        default:
          break;
      }
    },
    [dispatchAt, end, rotateTelemetry],
  );

  // --- connect ---------------------------------------------------------------------
  const connectAdapter = useCallback(
    async (continueConversationId: string | undefined, micStreamForAdapter: MediaStream | null) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const opts = optionsRef.current;
      const factory = opts.createAdapter ?? defaultCreateAdapter;
      const adapter = factory(opts.mode, { companionVoice: opts.companionVoice, pauseSensitivity: opts.pauseSensitivity });
      adapterRef.current = adapter;
      if (isOutputMutable(adapter)) adapter.setOutputMuted(Boolean(opts.outputMuted));
      adapter.setMuted(mutedRef.current);
      try {
        await adapter.connect({
          modelKey: modelKeyRef.current,
          ...(continueConversationId ? { conversationId: continueConversationId } : {}),
          micStream: micStreamForAdapter,
          tools: opts.tools ?? clientToolDispatcher,
          onEvent: handleAdapterEvent,
          signal: controller.signal,
        });
        if (adapterRef.current === adapter) setRemoteStream(adapter.getRemoteAudioStream());
      } catch {
        // The adapter already emitted a user-facing `error` event (or we aborted on purpose).
        if (adapterRef.current === adapter) adapterRef.current = null;
        if (controller.signal.aborted && stateRef.current.connection !== "ended" && !endingRef.current) {
          dispatchAt({ type: "status", status: "disconnected" });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [dispatchAt, handleAdapterEvent],
  );

  const start = useCallback(
    async (startOptions: StartOptions = {}) => {
      if (startingRef.current || adapterRef.current || endingRef.current) return; // double-click guard
      startingRef.current = true;
      setStarting(true);
      setSummary(null);
      setSwitchNote(null);
      conversationIdRef.current = null;
      pendingEndRef.current = false;
      mapperRef.current = createTelemetryMapper(now);
      dispatch({ type: "reset", at: now() });
      try {
        let stream: MediaStream | null = null;
        if (startOptions.micStream !== undefined) {
          stream = startOptions.micStream;
        } else if (!startOptions.skipMic) {
          dispatchAt({ type: "mic", status: "requesting" });
          const result = await (optionsRef.current.acquireMic ?? defaultAcquireMicrophone)();
          if ("error" in result) {
            dispatchAt({ type: "mic", status: "denied", error: result.error });
            return;
          }
          stream = result.stream;
          ownMicRef.current = stream;
          dispatchAt({ type: "mic", status: "granted" });
        } else {
          dispatchAt({ type: "mic", status: "skipped" });
        }
        micRef.current = stream;
        setTrackEnabled(stream, !mutedRef.current);
        setMicStream(stream);
        if (endingRef.current) return; // End pressed while asking for the mic
        await connectAdapter(undefined, stream);
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [connectAdapter, dispatchAt, now],
  );

  const switchModel = useCallback(
    async (next: ModelKey) => {
      setModelKey(next);
      const previous = modelKeyRef.current;
      modelKeyRef.current = next;
      const adapter = adapterRef.current;
      if (!adapter || previous === next || switchingRef.current) return;
      const continueId = conversationIdRef.current ?? undefined;
      switchingRef.current = true;
      try {
        adapterRef.current = null;
        abortRef.current?.abort();
        const telemetry = telemetryRef.current;
        telemetryRef.current = null;
        if (telemetry) void telemetry.stop();
        try {
          await adapter.disconnect("model_switch");
        } catch {
          /* ignore */
        }
        if (continueId) void (optionsRef.current.endConversation ?? defaultEndConversation)(continueId);
        dispatchAt({ type: "status", status: "connecting", detail: "model_switch" });
        await connectAdapter(continueId, micRef.current);
        setSwitchNote(
          `Switched to ${MODEL_LABELS[next]}. Your memories and this conversation carry over; the model's own short-term state does not.`,
        );
      } finally {
        switchingRef.current = false;
      }
    },
    [connectAdapter, dispatchAt],
  );

  const interrupt = useCallback(() => adapterRef.current?.interrupt(), []);

  const setMuted = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted;
      dispatch({ type: "set_muted", muted, at: now() });
      setTrackEnabled(micRef.current, !muted);
      adapterRef.current?.setMuted(muted);
    },
    [now],
  );
  const toggleMute = useCallback(() => setMuted(!mutedRef.current), [setMuted]);

  const sendText = useCallback((text: string) => {
    adapterRef.current?.sendText(text);
  }, []);

  const reset = useCallback(() => {
    if (adapterRef.current || endingRef.current) return;
    setSummary(null);
    setSwitchNote(null);
    conversationIdRef.current = null;
    dispatch({ type: "reset", at: now() });
  }, [now]);

  const clearSwitchNote = useCallback(() => setSwitchNote(null), []);

  // --- output mute follows the option ----------------------------------------------
  useEffect(() => {
    const adapter = adapterRef.current;
    if (adapter && isOutputMutable(adapter)) adapter.setOutputMuted(Boolean(options.outputMuted));
  }, [options.outputMuted]);

  // --- clock ticks while active (interrupted hold, connected seconds) ------------
  const active = state.connection !== "disconnected" && state.connection !== "ended";
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => dispatch({ type: "tick", now: now() }), TICK_MS);
    return () => clearInterval(id);
  }, [active, now]);

  // --- page hide / unload: beacon the last telemetry batch --------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => telemetryRef.current?.flushWithBeacon();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // --- unmount: tear everything down -----------------------------------------------------
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const adapter = adapterRef.current;
      adapterRef.current = null;
      void adapter?.disconnect("unmount");
      telemetryRef.current?.flushWithBeacon();
      telemetryRef.current = null;
      if (ownMicRef.current) stopStream(ownMicRef.current);
      clearPendingEndTimer();
    };
  }, []);

  return useMemo(
    () => ({
      state,
      micStream,
      remoteStream,
      modelKey,
      starting,
      ending,
      summary,
      switchNote,
      start,
      end,
      interrupt,
      setMuted,
      toggleMute,
      sendText,
      switchModel,
      clearSwitchNote,
      reset,
    }),
    [state, micStream, remoteStream, modelKey, starting, ending, summary, switchNote, start, end, interrupt, setMuted, toggleMute, sendText, switchModel, clearSwitchNote, reset],
  );
}
