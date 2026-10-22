import { describe, expect, it } from "vitest";
import type { OrbState } from "@/lib/types";
import { describeOrbState, levelSourceFor, ORB_STATE_PARAMS, ORB_STATES, shortStateLabel, tweenTimeConstant } from "@/components/orb/orbState";

const ALL_STATES: OrbState[] = ["idle", "connecting", "listening", "thinking", "speaking", "interrupted", "muted", "error", "offline"];

describe("describeOrbState", () => {
  it("uses the companion's name where it matters", () => {
    expect(describeOrbState("speaking", "Fred")).toBe("Fred is speaking");
    expect(describeOrbState("thinking", "Ethel")).toBe("Ethel is thinking");
    expect(describeOrbState("interrupted", "Fred")).toBe("Fred stopped so you can speak");
  });

  it("falls back to a neutral phrase without a label", () => {
    expect(describeOrbState("speaking")).toBe("Your companion is speaking");
    expect(describeOrbState("thinking", "   ")).toBe("Your companion is thinking");
  });

  it("describes every state in plain words", () => {
    expect(describeOrbState("listening")).toBe("Listening");
    expect(describeOrbState("muted")).toBe("Microphone is muted");
    expect(describeOrbState("error")).toBe("Something went wrong");
    expect(describeOrbState("offline")).toBe("Not connected");
    expect(describeOrbState("connecting")).toBe("Connecting…");
    expect(describeOrbState("idle")).toMatch(/Ready/);
    for (const state of ALL_STATES) {
      expect(describeOrbState(state, "Fred").length).toBeGreaterThan(0);
      expect(shortStateLabel(state).length).toBeGreaterThan(0);
    }
  });
});

describe("ORB_STATE_PARAMS", () => {
  it("covers every OrbState with bounded parameters", () => {
    expect([...ORB_STATES].sort()).toEqual([...ALL_STATES].sort());
    for (const state of ALL_STATES) {
      const p = ORB_STATE_PARAMS[state];
      expect(p.radius).toBeGreaterThan(0.5);
      expect(p.radius).toBeLessThan(1.5);
      for (const key of ["core", "glow", "rings", "sweep", "particles", "ripple", "motes", "shimmer", "wave", "bar", "levelInfluence", "snap"] as const) {
        expect(p[key], `${state}.${key}`).toBeGreaterThanOrEqual(0);
        expect(p[key], `${state}.${key}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("encodes the visual grammar per state", () => {
    expect(ORB_STATE_PARAMS.listening.ripple).toBe(1);
    expect(ORB_STATE_PARAMS.listening.levelInfluence).toBe(1);
    expect(ORB_STATE_PARAMS.speaking.wave).toBe(1);
    expect(ORB_STATE_PARAMS.thinking.motes).toBe(1);
    expect(ORB_STATE_PARAMS.thinking.radius).toBeLessThan(ORB_STATE_PARAMS.idle.radius);
    expect(ORB_STATE_PARAMS.connecting.sweep).toBe(1);
    expect(ORB_STATE_PARAMS.muted.bar).toBe(1);
    expect(ORB_STATE_PARAMS.interrupted.snap).toBe(1);
    expect(ORB_STATE_PARAMS.error.throb).toBeGreaterThan(0);
    expect(ORB_STATE_PARAMS.offline.core).toBeLessThan(ORB_STATE_PARAMS.idle.core);
    expect(ORB_STATE_PARAMS.offline.ringSpeed).toBe(0);
    expect(ORB_STATE_PARAMS.idle.breathAmp).toBeGreaterThan(0);
  });

  it("maps levels and tween speeds sensibly", () => {
    expect(levelSourceFor("listening")).toBe("mic");
    expect(levelSourceFor("speaking")).toBe("output");
    expect(levelSourceFor("thinking")).toBe("none");
    expect(levelSourceFor("offline")).toBe("none");
    expect(tweenTimeConstant("interrupted")).toBeLessThan(tweenTimeConstant("idle"));
    expect(tweenTimeConstant("error")).toBeGreaterThan(tweenTimeConstant("listening"));
  });
});
