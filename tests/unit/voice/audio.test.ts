// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MIC_CONSTRAINTS, acquireMicrophone, mapMediaError, setTrackEnabled } from "@/lib/ai/realtime/audio";

function domError(name: string) {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe("acquireMicrophone", () => {
  it("requests echo cancellation, noise suppression, AGC and mono", async () => {
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    const result = await acquireMicrophone({ mediaDevices: { getUserMedia }, isSecureContext: true });
    expect(result).toEqual({ stream });
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(MIC_CONSTRAINTS.audio).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
  });

  it("maps browser errors to plain-language codes", async () => {
    const cases: Array<[string, string]> = [
      ["NotAllowedError", "denied"],
      ["PermissionDeniedError", "denied"],
      ["SecurityError", "denied"],
      ["NotFoundError", "not_found"],
      ["NotReadableError", "in_use"],
      ["AbortError", "in_use"],
      ["SomethingElse", "unknown"],
    ];
    for (const [name, code] of cases) {
      const result = await acquireMicrophone({ mediaDevices: { getUserMedia: async () => Promise.reject(domError(name)) }, isSecureContext: true });
      expect("error" in result && result.error.code).toBe(code);
      expect("error" in result && result.error.message.length).toBeGreaterThan(20);
    }
    expect(mapMediaError(null).code).toBe("unknown");
  });

  it("retries with plain audio when the constraints are rejected", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi
      .fn<(c: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(domError("OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    const result = await acquireMicrophone({ mediaDevices: { getUserMedia }, isSecureContext: true });
    expect(result).toEqual({ stream });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: true, video: false });
  });

  it("reports insecure contexts and missing APIs without calling getUserMedia", async () => {
    expect(await acquireMicrophone({ isSecureContext: false, mediaDevices: { getUserMedia: vi.fn() } })).toMatchObject({ error: { code: "insecure_context" } });
    expect(await acquireMicrophone({ isSecureContext: true, mediaDevices: null })).toMatchObject({ error: { code: "unsupported" } });
  });
});

describe("setTrackEnabled", () => {
  it("toggles every audio track and tolerates null", () => {
    const tracks = [{ enabled: true }, { enabled: true }];
    const stream = { getAudioTracks: () => tracks } as unknown as MediaStream;
    setTrackEnabled(stream, false);
    expect(tracks.every((t) => !t.enabled)).toBe(true);
    setTrackEnabled(null, true);
  });
});
