/**
 * Orb visual grammar — one set of target parameters per OrbState, tweened by
 * the renderer so states never "pop". Also the plain-language description used
 * for the aria-live status. Pure; safe for tests.
 */
import type { OrbState } from "@/lib/types";

export interface OrbVisualParams {
  /** Sphere radius multiplier. */
  radius: number;
  /** Core brightness 0..1. */
  core: number;
  /** Bloom intensity 0..1. */
  glow: number;
  /** Breathing amplitude (fraction of radius). */
  breathAmp: number;
  /** Breathing cycles per second. */
  breathSpeed: number;
  /** Ring opacity 0..1. */
  rings: number;
  /** Ring rotation speed multiplier. */
  ringSpeed: number;
  /** Connecting tracer sweep 0..1. */
  sweep: number;
  /** Particle field opacity 0..1. */
  particles: number;
  /** Listening ripple emission 0..1. */
  ripple: number;
  /** Thinking inner motes 0..1. */
  motes: number;
  /** Thinking shimmer 0..1. */
  shimmer: number;
  /** Speaking waveform arcs 0..1. */
  wave: number;
  /** Muted bar 0..1. */
  bar: number;
  /** How strongly the audio level drives radius + brightness. */
  levelInfluence: number;
  /** Slow throb amplitude (error). */
  throb: number;
  /** Ring snap outward (interrupted). */
  snap: number;
}

export const ORB_STATE_PARAMS: Record<OrbState, OrbVisualParams> = {
  idle: {
    radius: 1,
    core: 0.62,
    glow: 0.5,
    breathAmp: 0.028,
    breathSpeed: 0.16,
    rings: 0.32,
    ringSpeed: 0.6,
    sweep: 0,
    particles: 0.5,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 0,
    levelInfluence: 0.25,
    throb: 0,
    snap: 0,
  },
  connecting: {
    radius: 0.94,
    core: 0.5,
    glow: 0.42,
    breathAmp: 0.02,
    breathSpeed: 0.7,
    rings: 0.7,
    ringSpeed: 1.8,
    sweep: 1,
    particles: 0.35,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 0,
    levelInfluence: 0,
    throb: 0,
    snap: 0,
  },
  listening: {
    radius: 1.04,
    core: 0.78,
    glow: 0.72,
    breathAmp: 0.012,
    breathSpeed: 0.25,
    rings: 0.55,
    ringSpeed: 1,
    sweep: 0,
    particles: 0.7,
    ripple: 1,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 0,
    levelInfluence: 1,
    throb: 0,
    snap: 0,
  },
  thinking: {
    radius: 0.93,
    core: 0.7,
    glow: 0.55,
    breathAmp: 0.015,
    breathSpeed: 0.5,
    rings: 0.45,
    ringSpeed: 1.4,
    sweep: 0,
    particles: 0.6,
    ripple: 0,
    motes: 1,
    shimmer: 1,
    wave: 0,
    bar: 0,
    levelInfluence: 0,
    throb: 0,
    snap: 0,
  },
  speaking: {
    radius: 1.02,
    core: 0.85,
    glow: 0.8,
    breathAmp: 0.01,
    breathSpeed: 0.3,
    rings: 0.5,
    ringSpeed: 0.9,
    sweep: 0,
    particles: 0.75,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 1,
    bar: 0,
    levelInfluence: 1,
    throb: 0,
    snap: 0,
  },
  interrupted: {
    radius: 0.96,
    core: 0.45,
    glow: 0.35,
    breathAmp: 0,
    breathSpeed: 0,
    rings: 0.9,
    ringSpeed: 0.2,
    sweep: 0,
    particles: 0.3,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 0,
    levelInfluence: 0.4,
    throb: 0,
    snap: 1,
  },
  muted: {
    radius: 0.95,
    core: 0.35,
    glow: 0.25,
    breathAmp: 0.012,
    breathSpeed: 0.12,
    rings: 0.22,
    ringSpeed: 0.3,
    sweep: 0,
    particles: 0.25,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 1,
    levelInfluence: 0,
    throb: 0,
    snap: 0,
  },
  error: {
    radius: 0.97,
    core: 0.55,
    glow: 0.5,
    breathAmp: 0,
    breathSpeed: 0,
    rings: 0.4,
    ringSpeed: 0.15,
    sweep: 0,
    particles: 0.2,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 0,
    levelInfluence: 0,
    throb: 0.035,
    snap: 0,
  },
  offline: {
    radius: 0.9,
    core: 0.22,
    glow: 0.12,
    breathAmp: 0,
    breathSpeed: 0,
    rings: 0.15,
    ringSpeed: 0,
    sweep: 0,
    particles: 0.1,
    ripple: 0,
    motes: 0,
    shimmer: 0,
    wave: 0,
    bar: 0,
    levelInfluence: 0,
    throb: 0,
    snap: 0,
  },
};

export const ORB_STATES: readonly OrbState[] = [
  "offline",
  "connecting",
  "idle",
  "listening",
  "thinking",
  "speaking",
  "interrupted",
  "muted",
  "error",
];

/** Tween time constant (seconds) when entering a state. Interrupted snaps fast. */
export function tweenTimeConstant(state: OrbState): number {
  switch (state) {
    case "interrupted":
      return 0.08;
    case "listening":
    case "speaking":
      return 0.22;
    case "error":
      return 0.5;
    default:
      return 0.35;
  }
}

/** Which level drives the orb in each state. */
export function levelSourceFor(state: OrbState): "mic" | "output" | "none" {
  switch (state) {
    case "listening":
    case "interrupted":
    case "idle":
      return "mic";
    case "speaking":
      return "output";
    default:
      return "none";
  }
}

/**
 * Plain words for the aria-live status. `label` is the companion's name
 * ("Fred", "Ethel"); defaults to a neutral phrase.
 */
export function describeOrbState(state: OrbState, label?: string): string {
  const name = label && label.trim() ? label.trim() : "Your companion";
  switch (state) {
    case "idle":
      return "Ready. Speak whenever you like.";
    case "connecting":
      return "Connecting…";
    case "listening":
      return "Listening";
    case "thinking":
      return `${name} is thinking`;
    case "speaking":
      return `${name} is speaking`;
    case "interrupted":
      return `${name} stopped so you can speak`;
    case "muted":
      return "Microphone is muted";
    case "error":
      return "Something went wrong";
    case "offline":
      return "Not connected";
  }
}

/** Short title-case label for chips and the showcase controls. */
export function shortStateLabel(state: OrbState): string {
  switch (state) {
    case "idle":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "interrupted":
      return "Interrupted";
    case "muted":
      return "Muted";
    case "error":
      return "Error";
    case "offline":
      return "Offline";
  }
}
