"use client";
/**
 * Client -> server conversation telemetry. Adapter events are mapped to the
 * `conversationEventSchema` union and batched to
 * POST /api/conversations/:id/events every 5s, on end, and on page hide
 * (navigator.sendBeacon fallback so the last batch survives tab close).
 *
 * Event shapes sent (see src/lib/api/contracts.ts):
 *   message   { role, content, itemId?, sources? }   — on FINAL transcripts (non-empty)
 *   usage     { responseId?, ...TokenUsage }          — on response_done with usage
 *   speech    { speaker, seconds }                    — on user/assistant speech stop (per segment)
 *   connected { seconds }                             — DELTA seconds since the previous
 *                                                       `connected` event (every 30s and at end);
 *                                                       the server should SUM these
 *   client_error { code, message }                    — on adapter `error` events
 */
import type { z } from "zod";
import type { AdapterEvent } from "@/lib/ai/adapters/types";
import { apiFetch } from "@/lib/api/client";
import type { conversationEventSchema } from "@/lib/api/contracts";
import type { SearchSource } from "@/lib/types";

export type ConversationTelemetryEvent = z.infer<typeof conversationEventSchema>;

export const TELEMETRY_FLUSH_MS = 5000;
export const TELEMETRY_CONNECTED_MS = 30_000;
const MAX_BATCH = 200;
const MAX_QUEUE = 1000;

/**
 * Stateful mapper: adapter events -> telemetry events. Holds the small amount of
 * context needed (speech start times, pending search sources).
 */
export function createTelemetryMapper(now: () => number = () => Date.now()) {
  let userStartedAt: number | null = null;
  let assistantStartedAt: number | null = null;
  let pendingSources: SearchSource[] | null = null;

  return function map(event: AdapterEvent): ConversationTelemetryEvent[] {
    switch (event.type) {
      case "transcript": {
        if (!event.final) return [];
        const content = event.text.trim();
        if (!content) return [];
        const out: ConversationTelemetryEvent = {
          type: "message",
          role: event.role,
          content: content.slice(0, 20_000),
          itemId: event.itemId.slice(0, 128),
        };
        if (event.role === "assistant" && pendingSources?.length) {
          out.sources = pendingSources.slice(0, 20);
          pendingSources = null;
        }
        return [out];
      }
      case "response_done":
        if (!event.usage) return [];
        return [
          {
            type: "usage",
            ...(event.responseId ? { responseId: event.responseId.slice(0, 128) } : {}),
            inputTextTokens: event.usage.inputTextTokens,
            inputAudioTokens: event.usage.inputAudioTokens,
            cachedTextTokens: event.usage.cachedTextTokens,
            cachedAudioTokens: event.usage.cachedAudioTokens,
            outputTextTokens: event.usage.outputTextTokens,
            outputAudioTokens: event.usage.outputAudioTokens,
          },
        ];
      case "user_speech_started":
        userStartedAt = now();
        return [];
      case "user_speech_stopped": {
        const seconds =
          event.durationMs !== undefined
            ? event.durationMs / 1000
            : userStartedAt !== null
              ? Math.max(0, now() - userStartedAt) / 1000
              : 0;
        userStartedAt = null;
        if (seconds <= 0) return [];
        return [{ type: "speech", speaker: "user", seconds: Math.min(3600, round3(seconds)) }];
      }
      case "assistant_speech_started":
        assistantStartedAt = now();
        return [];
      case "assistant_speech_stopped": {
        const seconds =
          event.durationMs !== undefined
            ? event.durationMs / 1000
            : assistantStartedAt !== null
              ? Math.max(0, now() - assistantStartedAt) / 1000
              : 0;
        assistantStartedAt = null;
        if (seconds <= 0) return [];
        return [{ type: "speech", speaker: "assistant", seconds: Math.min(3600, round3(seconds)) }];
      }
      case "tool_result":
        if (event.result.sources?.length) pendingSources = event.result.sources;
        return [];
      case "error":
        return [{ type: "client_error", code: event.code.slice(0, 64), message: event.message.slice(0, 500) }];
      default:
        return [];
    }
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type TelemetryPost = (conversationId: string, events: ConversationTelemetryEvent[]) => Promise<void>;
export type TelemetryBeacon = (conversationId: string, events: ConversationTelemetryEvent[]) => boolean;

export interface TelemetryBatcherOptions {
  conversationId: string;
  flushIntervalMs?: number;
  connectedIntervalMs?: number;
  post?: TelemetryPost;
  beacon?: TelemetryBeacon;
  now?: () => number;
}

export const defaultTelemetryPost: TelemetryPost = async (conversationId, events) => {
  await apiFetch<{ ok: true }>(`/api/conversations/${encodeURIComponent(conversationId)}/events`, {
    method: "POST",
    json: { events },
    keepalive: true,
  });
};

export const defaultTelemetryBeacon: TelemetryBeacon = (conversationId, events) => {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  try {
    const body = new Blob([JSON.stringify({ events })], { type: "application/json" });
    return navigator.sendBeacon(`/api/conversations/${encodeURIComponent(conversationId)}/events`, body);
  } catch {
    return false;
  }
};

/**
 * Queues telemetry for ONE conversation id. Create a new batcher when the
 * conversation id changes (model switch / reconnect continuation).
 */
export class TelemetryBatcher {
  readonly conversationId: string;
  private queue: ConversationTelemetryEvent[] = [];
  private readonly post: TelemetryPost;
  private readonly beacon: TelemetryBeacon;
  private readonly now: () => number;
  private readonly flushIntervalMs: number;
  private readonly connectedIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private connectedTimer: ReturnType<typeof setInterval> | null = null;
  private lastConnectedMark: number | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private failures = 0;

  constructor(options: TelemetryBatcherOptions) {
    this.conversationId = options.conversationId;
    this.post = options.post ?? defaultTelemetryPost;
    this.beacon = options.beacon ?? defaultTelemetryBeacon;
    this.now = options.now ?? (() => Date.now());
    this.flushIntervalMs = options.flushIntervalMs ?? TELEMETRY_FLUSH_MS;
    this.connectedIntervalMs = options.connectedIntervalMs ?? TELEMETRY_CONNECTED_MS;
  }

  /** Begin periodic flushing and connected-time accounting. */
  start(): void {
    if (this.stopped) return;
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    }
    if (this.lastConnectedMark === null) this.lastConnectedMark = this.now();
    if (!this.connectedTimer) {
      this.connectedTimer = setInterval(() => this.markConnected(), this.connectedIntervalMs);
    }
  }

  push(event: ConversationTelemetryEvent): void {
    if (this.stopped) return;
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
  }

  pushAll(events: ConversationTelemetryEvent[]): void {
    for (const e of events) this.push(e);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Emit a `connected` delta since the previous mark. */
  markConnected(): void {
    if (this.lastConnectedMark === null) return;
    const now = this.now();
    const seconds = Math.max(0, (now - this.lastConnectedMark) / 1000);
    this.lastConnectedMark = now;
    if (seconds >= 1) this.push({ type: "connected", seconds: Math.min(7200, Math.round(seconds)) });
  }

  /** Send everything queued, 200 at a time (sequential; failures are re-queued, bounded). */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.queue.length === 0) return Promise.resolve();
    const run = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, MAX_BATCH);
        try {
          await this.post(this.conversationId, batch);
          this.failures = 0;
        } catch {
          this.failures += 1;
          // Give up after repeated failures so the queue never grows unbounded.
          if (this.failures <= 5) this.queue.unshift(...batch);
          break;
        }
      }
    })().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /** Synchronous best-effort send for pagehide/unload. */
  flushWithBeacon(): boolean {
    this.markConnected();
    if (this.queue.length === 0) return true;
    const batch = this.queue.splice(0, MAX_BATCH);
    const ok = this.beacon(this.conversationId, batch);
    if (!ok) {
      this.queue.unshift(...batch);
      void this.flush();
    }
    return ok;
  }

  /** Final connected mark + flush; then no more events are accepted. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.markConnected();
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.connectedTimer) clearInterval(this.connectedTimer);
    this.flushTimer = null;
    this.connectedTimer = null;
    await this.flush();
    this.stopped = true;
  }
}
