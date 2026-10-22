import { describe, expect, it } from "vitest";
import {
  buildInstructions,
  buildInstructionsWithoutMemory,
  estimateTokens,
  MEMORY_OFF_BLOCK,
  type BuildInstructionsInput,
} from "@/lib/ai/instructions";
import type { HumorLevel, OnboardingStage } from "@/lib/types";

const base: BuildInstructionsInput = {
  companionVoice: "fred",
  preferredName: null,
  humorLevel: "gentle",
  onboardingStage: "new",
  memoryEnabled: false,
  sensitiveMemoryEnabled: false,
  searchEnabled: false,
  memoryBlock: "",
  mode: "live",
  now: new Date("2026-10-22T15:30:00Z"),
  timezone: "America/New_York",
};

describe("buildInstructions", () => {
  it("states identity, AI honesty and the selected companion name", () => {
    const fred = buildInstructions(base);
    expect(fred).toContain("You are Fred, a voice companion made by Companion.");
    expect(fred).toContain("You are an AI");
    expect(fred).toContain("never claim to be human");
    const ethel = buildInstructions({ ...base, companionVoice: "ethel" });
    expect(ethel).toContain("You are Ethel");
    expect(ethel).not.toContain("You are Fred");
  });

  it("renders the humor section per level and omits the other levels' rules", () => {
    const off = buildInstructions({ ...base, humorLevel: "off" });
    expect(off).toContain("# Humor: off");
    expect(off).toContain("No jokes, wordplay or teasing");
    expect(off).not.toContain("Occasional light humor");
    expect(off).not.toContain("Be freer and more spontaneous");

    const gentle = buildInstructions({ ...base, humorLevel: "gentle" });
    expect(gentle).toContain("# Humor: gentle");
    expect(gentle).toContain("Occasional light humor");
    expect(gentle).not.toContain("Be freer and more spontaneous");

    const playful = buildInstructions({ ...base, humorLevel: "playful" });
    expect(playful).toContain("# Humor: playful");
    expect(playful).toContain("Be freer and more spontaneous");
    expect(playful).toContain("Still not every turn");
  });

  it("always includes the serious-topic rules and the no-jokes-about list", () => {
    for (const level of ["off", "gentle", "playful"] as HumorLevel[]) {
      const text = buildInstructions({ ...base, humorLevel: level });
      expect(text).toContain("Drop humor immediately when things turn serious");
      expect(text).toContain("grief");
      expect(text).toContain("cognitive decline");
      expect(text).toContain("set_humor_level");
    }
  });

  it("uses the memory-off block when memory is disabled", () => {
    const text = buildInstructions({ ...base, memoryEnabled: false, memoryBlock: "SHOULD NOT APPEAR" });
    expect(text.endsWith(MEMORY_OFF_BLOCK)).toBe(true);
    expect(text).not.toContain("SHOULD NOT APPEAR");
    expect(text).toContain("Memory is currently off");
    expect(text).toContain("request_memory_consent");
    expect(text).not.toContain("- remember:");
  });

  it("appends the memory block and the remember tool when memory is enabled", () => {
    const text = buildInstructions({ ...base, memoryEnabled: true, memoryBlock: "- Her cat is called Biscuit (confirmed)" });
    expect(text).toContain("MEMORY (the only things you know about them from before):\n- Her cat is called Biscuit");
    expect(text).toContain("- remember:");
    expect(text).toContain("Want me to remember that?");
    expect(text).not.toContain(MEMORY_OFF_BLOCK);
  });

  it("explains the sensitive-memory gap when only general memory is enabled", () => {
    const text = buildInstructions({ ...base, memoryEnabled: true, sensitiveMemoryEnabled: false, memoryBlock: "x" });
    expect(text).toContain("not to keeping sensitive things");
    const both = buildInstructions({ ...base, memoryEnabled: true, sensitiveMemoryEnabled: true, memoryBlock: "x" });
    expect(both).not.toContain("not to keeping sensitive things");
  });

  it("includes the memory honesty rule verbatim in spirit", () => {
    const text = buildInstructions(base);
    expect(text).toContain("You only know what is in the MEMORY section below. Never claim to remember anything else.");
    expect(text).toContain("mentioned, not confirmed");
  });

  it("renders onboarding guidance per stage", () => {
    const stages: Record<OnboardingStage, string> = {
      new: "ask what they would like to be called",
      named: "Do not ask for it again",
      interests: "Do not ask for those again",
      memory_decided: "Do not ask again unless they bring it up",
      complete: "Do not ask onboarding questions",
    };
    for (const [stage, marker] of Object.entries(stages) as Array<[OnboardingStage, string]>) {
      const text = buildInstructions({ ...base, onboardingStage: stage, preferredName: stage === "new" ? null : "Margaret" });
      expect(text).toContain(`stage: ${stage}`);
      expect(text).toContain(marker);
    }
    const named = buildInstructions({ ...base, onboardingStage: "named", preferredName: "Margaret" });
    expect(named).toContain("call them Margaret");
    expect(named).toContain("You are talking with Margaret");
    const done = buildInstructions({ ...base, onboardingStage: "complete" });
    expect(done).not.toContain("ask plainly whether they would like you to remember");
  });

  it("switches the search tool guidance on searchEnabled", () => {
    const on = buildInstructions({ ...base, searchEnabled: true });
    expect(on).toContain("- search_web:");
    expect(on).toContain("never their name, memories or personal details");
    const off = buildInstructions({ ...base, searchEnabled: false });
    expect(off).not.toContain("- search_web:");
    expect(off).toContain("cannot look things up online right now");
    expect(off).toContain("offer to talk about it anyway");
  });

  it("includes date/time in the user's timezone and tolerates a bad timezone", () => {
    const text = buildInstructions(base);
    expect(text).toContain("Thursday, October 22, 2026");
    expect(text).toMatch(/11:30\s?AM/);
    const bad = buildInstructions({ ...base, timezone: "Not/AZone" });
    expect(bad).toContain("October 22, 2026");
  });

  it("covers safety, voice style and independent thought", () => {
    const text = buildInstructions(base);
    expect(text).toContain("911 in the US");
    expect(text).toContain("not a therapist, a doctor or an emergency service");
    expect(text).toContain("One question at a time");
    expect(text).toContain("Do not reflexively agree");
    expect(text).toContain("No artificial intimacy");
    expect(text).toContain("Never fabricate a personal memory");
  });

  it("labels demo mode honestly and live mode plainly", () => {
    expect(buildInstructions({ ...base, mode: "demo" })).toContain("Mode: demo. This session is simulated");
    expect(buildInstructions(base)).toContain("Mode: live.");
  });

  it("stays under the ~1,800 token budget without the memory block for every combination", () => {
    let worst = 0;
    for (const humorLevel of ["off", "gentle", "playful"] as HumorLevel[]) {
      for (const onboardingStage of ["new", "named", "interests", "memory_decided", "complete"] as OnboardingStage[]) {
        for (const memoryEnabled of [true, false]) {
          for (const searchEnabled of [true, false]) {
            const text = buildInstructionsWithoutMemory({
              ...base,
              humorLevel,
              onboardingStage,
              memoryEnabled,
              sensitiveMemoryEnabled: false,
              searchEnabled,
              preferredName: "Margaret",
            });
            worst = Math.max(worst, estimateTokens(text));
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1800);
    expect(worst).toBeGreaterThan(800); // sanity: the prompt is substantive
  });

  it("estimateTokens is chars/4 rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
