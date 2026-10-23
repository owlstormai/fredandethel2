import { afterEach, describe, expect, it, vi } from "vitest";
import { getVerificationSummary } from "@/lib/ai/verification";

describe("getVerificationSummary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports current defaults with no warnings and no secrets", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const summary = getVerificationSummary();
    expect(summary.verifiedOn).toBe("2026-10-22");
    expect(summary.liveConfigured).toBe(false);
    expect(summary.warnings).toEqual([]);
    expect(summary.modelsInUse.map((m) => m.id)).toEqual(["gpt-realtime-2.1", "gpt-realtime-2.1-mini", "gpt-realtime-whisper", "gpt-6-luna", "gpt-6-luna"]);
    expect(summary.facts.realtimeHasBuiltInWebSearch).toBe(false);
    expect(summary.facts.webSearchToolType).toBe("web_search");
    expect(JSON.stringify(summary)).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("flags env overrides that point at deprecated models", () => {
    vi.stubEnv("COMPANION_REALTIME_FULL_MODEL", "gpt-realtime");
    vi.stubEnv("COMPANION_TRANSCRIPTION_MODEL", "whisper-1");
    const summary = getVerificationSummary();
    const full = summary.modelsInUse.find((m) => m.role === "realtime_full")!;
    expect(full.overridden).toBe(true);
    expect(full.deprecation?.replacement).toBe("gpt-realtime-2.1");
    expect(summary.warnings).toHaveLength(2);
    expect(summary.warnings[0]).toContain("gpt-realtime is deprecated (shutdown 2027-01-20)");
  });
});
