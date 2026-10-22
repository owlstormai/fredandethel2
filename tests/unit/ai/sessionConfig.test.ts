import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRealtimeSessionConfig,
  EAGERNESS_BY_SENSITIVITY,
  getVadMode,
  serverVadFallback,
} from "@/lib/ai/realtime/sessionConfig";
import { companionToolDefinitions } from "@/lib/ai/tools/definitions";
import type { PauseSensitivity } from "@/lib/types";

const base = {
  modelId: "gpt-realtime-2.1",
  voice: "cedar",
  instructions: "You are Fred.",
  tools: companionToolDefinitions({ searchEnabled: false }),
  transcriptionModel: "gpt-realtime-whisper",
};

describe("buildRealtimeSessionConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps pause sensitivity to semantic_vad eagerness", () => {
    const expected: Record<PauseSensitivity, string> = { patient: "low", balanced: "medium", quick: "high" };
    for (const [sensitivity, eagerness] of Object.entries(expected) as Array<[PauseSensitivity, string]>) {
      const config = buildRealtimeSessionConfig({ ...base, pauseSensitivity: sensitivity, vadMode: "semantic" });
      expect(config.audio?.input?.turn_detection).toEqual({
        type: "semantic_vad",
        eagerness,
        create_response: true,
        interrupt_response: true,
      });
      expect(EAGERNESS_BY_SENSITIVITY[sensitivity]).toBe(eagerness);
    }
  });

  it("produces the exact GA session shape for a patient speaker", () => {
    const config = buildRealtimeSessionConfig({ ...base, pauseSensitivity: "patient", vadMode: "semantic" });
    expect(config).toEqual({
      type: "realtime",
      model: "gpt-realtime-2.1",
      instructions: "You are Fred.",
      output_modalities: ["audio"],
      audio: {
        input: {
          turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true },
          transcription: { model: "gpt-realtime-whisper" },
          noise_reduction: { type: "near_field" },
        },
        output: { voice: "cedar" },
      },
      tools: base.tools,
      tool_choice: "auto",
    });
  });

  it("contains no beta-era fields", () => {
    const config = buildRealtimeSessionConfig({ ...base, pauseSensitivity: "balanced" }) as unknown as Record<string, unknown>;
    expect(config).not.toHaveProperty("modalities");
    expect(config).not.toHaveProperty("voice");
    expect(config).not.toHaveProperty("input_audio_format");
    expect(config).not.toHaveProperty("output_audio_format");
    expect(config).not.toHaveProperty("turn_detection");
    expect(config).not.toHaveProperty("input_audio_transcription");
    // Audio format is negotiated by SDP over WebRTC; never pinned here.
    expect((config.audio as { input: Record<string, unknown> }).input).not.toHaveProperty("format");
  });

  it("falls back to server_vad with per-sensitivity silence when COMPANION_VAD_MODE=server", () => {
    vi.stubEnv("COMPANION_VAD_MODE", "server");
    expect(getVadMode()).toBe("server");
    const config = buildRealtimeSessionConfig({ ...base, pauseSensitivity: "patient" });
    expect(config.audio?.input?.turn_detection).toEqual(serverVadFallback("patient"));
    expect(serverVadFallback("patient")).toEqual({
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 1500,
      create_response: true,
      interrupt_response: true,
    });
    expect(serverVadFallback("balanced")).toMatchObject({ silence_duration_ms: 900 });
    expect(serverVadFallback("quick")).toMatchObject({ silence_duration_ms: 500 });
  });

  it("defaults to semantic VAD when the env flag is unset", () => {
    vi.stubEnv("COMPANION_VAD_MODE", "");
    expect(getVadMode()).toBe("semantic");
  });

  it("allows disabling noise reduction explicitly", () => {
    const config = buildRealtimeSessionConfig({ ...base, pauseSensitivity: "quick", noiseReduction: null });
    expect(config.audio?.input?.noise_reduction).toBeNull();
  });
});
