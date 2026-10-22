"use client";
/**
 * TODO(integration): TEMPORARY STUB owned by Agent B. Replace with Agent A's
 * `Orb` from "@/components/orb/Orb" (same props) by editing
 * src/components/voice/integration.ts. Minimal CSS orb so the voice flow can be
 * exercised before the real renderer lands.
 */
import type { OrbColor, OrbState } from "@/lib/types";

export interface OrbProps {
  state: OrbState;
  micLevel: number;
  outputLevel: number;
  color?: OrbColor;
  size?: number | "fluid";
  reducedMotion?: boolean;
  label?: string;
}

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  interrupted: "Interrupted",
  muted: "Microphone off",
  error: "Error",
  offline: "Not connected",
};

export function Orb({ state, micLevel, outputLevel, size = 240, reducedMotion, label }: OrbProps) {
  const level = state === "listening" ? micLevel : state === "speaking" ? outputLevel : 0;
  const scale = 1 + (reducedMotion ? 0 : Math.min(1, Math.max(0, level)) * 0.18);
  const dim = state === "offline" || state === "error" || state === "muted";
  const px = size === "fluid" ? "min(60vw, 42vh, 360px)" : `${size}px`;
  return (
    <div
      role="img"
      aria-label={label ?? STATE_LABEL[state]}
      data-testid="orb"
      data-orb-state={state}
      className="relative flex items-center justify-center"
      style={{ width: px, height: px }}
    >
      <div
        className="absolute inset-0 rounded-full blur-2xl transition-opacity duration-300"
        style={{ background: "var(--accent-glow)", opacity: dim ? 0.15 : 0.35 + level * 0.4 }}
      />
      <div
        className="relative rounded-full transition-transform duration-100 ease-out"
        style={{
          width: "70%",
          height: "70%",
          transform: `scale(${scale})`,
          background: `radial-gradient(circle at 35% 35%, var(--accent), var(--accent-strong) 60%, #0b1120 100%)`,
          opacity: dim ? 0.45 : 1,
          boxShadow: state === "error" ? "0 0 0 4px var(--danger)" : state === "interrupted" ? "0 0 0 4px var(--line-strong)" : undefined,
        }}
      />
    </div>
  );
}
