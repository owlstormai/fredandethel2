/**
 * OpenAI Realtime API (GA, session type "realtime") event types — the subset
 * Companion uses. Shapes follow the public docs; anything we do not model is
 * kept as `unknown` so a schema drift fails loudly in one place instead of
 * silently everywhere. See docs/API_VERIFICATION.md for the verified source.
 */

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

export type SemanticVadEagerness = "low" | "medium" | "high" | "auto";

export type TurnDetection =
  | {
      type: "semantic_vad";
      eagerness?: SemanticVadEagerness;
      create_response?: boolean;
      interrupt_response?: boolean;
    }
  | {
      type: "server_vad";
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
      idle_timeout_ms?: number;
      create_response?: boolean;
      interrupt_response?: boolean;
    }
  | null;

export interface FunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface RealtimeSessionConfig {
  type: "realtime";
  model?: string;
  instructions?: string;
  output_modalities?: Array<"audio" | "text">;
  max_output_tokens?: number | "inf";
  tools?: FunctionToolDefinition[];
  tool_choice?: "auto" | "none" | "required";
  audio?: {
    input?: {
      format?: { type: "audio/pcm"; rate: 24000 } | { type: "audio/pcmu" } | { type: "audio/pcma" };
      turn_detection?: TurnDetection;
      transcription?: { model: string; language?: string; prompt?: string } | null;
      noise_reduction?: { type: "near_field" | "far_field" } | null;
    };
    output?: {
      format?: { type: "audio/pcm"; rate: 24000 } | { type: "audio/pcmu" } | { type: "audio/pcma" };
      voice?: string;
      speed?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Client -> server events
// ---------------------------------------------------------------------------

export type RealtimeClientEvent =
  | { type: "session.update"; event_id?: string; session: Partial<RealtimeSessionConfig> & { type: "realtime" } }
  | { type: "input_audio_buffer.clear"; event_id?: string }
  | { type: "input_audio_buffer.commit"; event_id?: string }
  | {
      type: "conversation.item.create";
      event_id?: string;
      previous_item_id?: string | null;
      item:
        | {
            type: "message";
            role: "user" | "assistant" | "system";
            content: Array<{ type: "input_text"; text: string } | { type: "output_text"; text: string }>;
          }
        | { type: "function_call_output"; call_id: string; output: string };
    }
  | { type: "conversation.item.truncate"; event_id?: string; item_id: string; content_index: number; audio_end_ms: number }
  | { type: "conversation.item.delete"; event_id?: string; item_id: string }
  | {
      type: "response.create";
      event_id?: string;
      response?: {
        instructions?: string;
        output_modalities?: Array<"audio" | "text">;
        conversation?: "auto" | "none";
        metadata?: Record<string, string>;
      };
    }
  | { type: "response.cancel"; event_id?: string; response_id?: string }
  | { type: "output_audio_buffer.clear"; event_id?: string };

// ---------------------------------------------------------------------------
// Server -> client events
// ---------------------------------------------------------------------------

export interface RealtimeUsage {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: { text_tokens?: number; audio_tokens?: number };
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

export interface RealtimeResponse {
  id: string;
  status: "completed" | "cancelled" | "failed" | "incomplete" | "in_progress";
  status_details?: unknown;
  output?: RealtimeOutputItem[];
  usage?: RealtimeUsage;
  metadata?: Record<string, string>;
}

export type RealtimeOutputItem =
  | {
      id: string;
      type: "message";
      role: "assistant";
      status?: string;
      content?: Array<{ type: "output_audio" | "output_text"; transcript?: string; text?: string }>;
    }
  | {
      id: string;
      type: "function_call";
      status?: string;
      name: string;
      call_id: string;
      arguments: string;
    }
  | { id: string; type: string; [key: string]: unknown };

export interface RealtimeErrorBody {
  type: string;
  code?: string | null;
  message: string;
  param?: string | null;
  event_id?: string | null;
}

export type RealtimeServerEvent =
  | { type: "session.created"; event_id: string; session: Record<string, unknown> }
  | { type: "session.updated"; event_id: string; session: Record<string, unknown> }
  | { type: "error"; event_id: string; error: RealtimeErrorBody }
  | { type: "rate_limits.updated"; event_id: string; rate_limits: Array<{ name: string; limit: number; remaining: number; reset_seconds: number }> }
  | { type: "input_audio_buffer.speech_started"; event_id: string; item_id: string; audio_start_ms: number }
  | { type: "input_audio_buffer.speech_stopped"; event_id: string; item_id: string; audio_end_ms: number }
  | { type: "input_audio_buffer.committed"; event_id: string; item_id: string; previous_item_id?: string | null }
  | { type: "input_audio_buffer.cleared"; event_id: string }
  | { type: "input_audio_buffer.timeout_triggered"; event_id: string; item_id: string; audio_start_ms: number; audio_end_ms: number }
  | { type: "conversation.item.added"; event_id: string; item: Record<string, unknown>; previous_item_id?: string | null }
  | { type: "conversation.item.done"; event_id: string; item: Record<string, unknown>; previous_item_id?: string | null }
  | { type: "conversation.item.created"; event_id: string; item: Record<string, unknown>; previous_item_id?: string | null }
  | { type: "conversation.item.truncated"; event_id: string; item_id: string; content_index: number; audio_end_ms: number }
  | { type: "conversation.item.deleted"; event_id: string; item_id: string }
  | { type: "conversation.item.input_audio_transcription.delta"; event_id: string; item_id: string; content_index: number; delta: string }
  | { type: "conversation.item.input_audio_transcription.completed"; event_id: string; item_id: string; content_index: number; transcript: string; usage?: unknown }
  | { type: "conversation.item.input_audio_transcription.failed"; event_id: string; item_id: string; content_index: number; error: RealtimeErrorBody }
  | { type: "response.created"; event_id: string; response: RealtimeResponse }
  | { type: "response.done"; event_id: string; response: RealtimeResponse }
  | { type: "response.output_item.added"; event_id: string; response_id: string; output_index: number; item: RealtimeOutputItem }
  | { type: "response.output_item.done"; event_id: string; response_id: string; output_index: number; item: RealtimeOutputItem }
  | { type: "response.content_part.added"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number; part: Record<string, unknown> }
  | { type: "response.content_part.done"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number; part: Record<string, unknown> }
  | { type: "response.output_audio_transcript.delta"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number; delta: string }
  | { type: "response.output_audio_transcript.done"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number; transcript: string }
  | { type: "response.output_text.delta"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number; delta: string }
  | { type: "response.output_text.done"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number; text: string }
  | { type: "response.output_audio.done"; event_id: string; response_id: string; item_id: string; output_index: number; content_index: number }
  | { type: "response.function_call_arguments.delta"; event_id: string; response_id: string; item_id: string; output_index: number; call_id: string; delta: string }
  | { type: "response.function_call_arguments.done"; event_id: string; response_id: string; item_id: string; output_index: number; call_id: string; name?: string; arguments: string }
  | { type: "output_audio_buffer.started"; event_id: string; response_id: string }
  | { type: "output_audio_buffer.stopped"; event_id: string; response_id: string }
  | { type: "output_audio_buffer.cleared"; event_id: string; response_id: string }
  | { type: string; event_id?: string; [key: string]: unknown }; // forward-compatible catch-all

/** Narrow a raw data-channel payload to a server event (never throws). */
export function parseServerEvent(raw: string): RealtimeServerEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") {
      return parsed as RealtimeServerEvent;
    }
    return null;
  } catch {
    return null;
  }
}
