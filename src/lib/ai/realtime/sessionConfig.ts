/**
 * Build the GA Realtime session object (API_VERIFICATION.md §3). This object is
 * sent as `session` when minting a client secret, so the browser never has to
 * know instructions, tools or the model.
 *
 * Audio formats are intentionally omitted: over WebRTC they are negotiated in
 * the SDP. No beta fields (`modalities`, `voice` at top level, `OpenAI-Beta`).
 */
import type { FunctionToolDefinition, RealtimeSessionConfig, SemanticVadEagerness, TurnDetection } from "@/lib/ai/realtime/events";
import type { PauseSensitivity } from "@/lib/types";

export type VadMode = "semantic" | "server";

export interface BuildSessionConfigInput {
  modelId: string;
  /** OpenAI voice id, e.g. "cedar" / "marin". */
  voice: string;
  instructions: string;
  pauseSensitivity: PauseSensitivity;
  tools: FunctionToolDefinition[];
  transcriptionModel: string;
  /** Defaults to env COMPANION_VAD_MODE ("server" -> server_vad), else semantic. */
  vadMode?: VadMode;
  /** Defaults to near_field (typical tablet/laptop use close to the mic). */
  noiseReduction?: "near_field" | "far_field" | null;
}

/** Decision: patient speakers get the model's lowest eagerness (8s max timeout). */
export const EAGERNESS_BY_SENSITIVITY: Record<PauseSensitivity, SemanticVadEagerness> = {
  patient: "low",
  balanced: "medium",
  quick: "high",
};

export const SERVER_VAD_SILENCE_MS: Record<PauseSensitivity, number> = {
  patient: 1500,
  balanced: 900,
  quick: 500,
};

export function getVadMode(): VadMode {
  return process.env.COMPANION_VAD_MODE === "server" ? "server" : "semantic";
}

export function semanticVad(pauseSensitivity: PauseSensitivity): TurnDetection {
  return {
    type: "semantic_vad",
    eagerness: EAGERNESS_BY_SENSITIVITY[pauseSensitivity],
    create_response: true,
    interrupt_response: true,
  };
}

/** Fallback for COMPANION_VAD_MODE=server (documented defaults: threshold 0.5, prefix 300ms). */
export function serverVadFallback(pauseSensitivity: PauseSensitivity): TurnDetection {
  return {
    type: "server_vad",
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: SERVER_VAD_SILENCE_MS[pauseSensitivity],
    create_response: true,
    interrupt_response: true,
  };
}

export function buildRealtimeSessionConfig(input: BuildSessionConfigInput): RealtimeSessionConfig {
  const vadMode = input.vadMode ?? getVadMode();
  const turnDetection = vadMode === "server" ? serverVadFallback(input.pauseSensitivity) : semanticVad(input.pauseSensitivity);
  const noise = input.noiseReduction === undefined ? "near_field" : input.noiseReduction;

  return {
    type: "realtime",
    model: input.modelId,
    instructions: input.instructions,
    output_modalities: ["audio"],
    audio: {
      input: {
        turn_detection: turnDetection,
        transcription: { model: input.transcriptionModel },
        noise_reduction: noise === null ? null : { type: noise },
      },
      output: { voice: input.voice },
    },
    tools: input.tools,
    tool_choice: "auto",
  };
}
