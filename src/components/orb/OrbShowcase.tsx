"use client";
/**
 * OrbShowcase — dev/preview component. Cycles through orb states with a
 * deterministic fake level generator. Never used for real conversation; every
 * caller labels it as a preview.
 */
import { useEffect, useRef, useState } from "react";
import type { OrbColor, OrbState } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { Orb } from "./Orb";
import { ORB_STATES, shortStateLabel } from "./orbState";

export interface OrbShowcaseProps {
  states?: readonly OrbState[];
  initialState?: OrbState;
  /** Auto-advance through `states`. */
  cycle?: boolean;
  intervalMs?: number;
  size?: number | "fluid";
  showControls?: boolean;
  label?: string;
  color?: OrbColor;
  reducedMotion?: boolean;
  className?: string;
  onStateChange?: (state: OrbState) => void;
}

/** Deterministic, speech-like envelope for previews. */
export function fakeLevel(state: OrbState, seconds: number): { mic: number; output: number } {
  const s = seconds;
  const env = (f1: number, f2: number, f3: number) => {
    const slow = (Math.sin(s * f1) + 1) / 2;
    const syll = Math.max(0, Math.sin(s * f2)) ** 2;
    const jitter = (Math.sin(s * f3) + Math.sin(s * f3 * 1.7)) * 0.08;
    return Math.min(1, Math.max(0, 0.12 + slow * 0.35 + syll * 0.5 + jitter));
  };
  switch (state) {
    case "listening":
      return { mic: env(1.3, 7.5, 23), output: 0 };
    case "speaking":
      return { mic: 0.02, output: env(0.9, 9.2, 31) };
    case "interrupted":
      return { mic: Math.min(1, 0.4 + s * 0.3), output: 0 };
    case "idle":
      return { mic: 0.05 + (Math.sin(s * 0.8) + 1) * 0.03, output: 0 };
    default:
      return { mic: 0, output: 0 };
  }
}

export function OrbShowcase({
  states = ORB_STATES,
  initialState,
  cycle = false,
  intervalMs = 3200,
  size = "fluid",
  showControls = false,
  label,
  color,
  reducedMotion,
  className,
  onStateChange,
}: OrbShowcaseProps) {
  const [state, setState] = useState<OrbState>(initialState ?? states[0] ?? "idle");
  const micRef = useRef(0);
  const outRef = useRef(0);
  const stateRef = useRef(state);
  const stateStartRef = useRef(0);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    stateRef.current = state;
    stateStartRef.current = performance.now();
    onStateChangeRef.current?.(state);
  }, [state]);

  // Fake levels, written to refs so the Orb reads them without re-rendering.
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const seconds = (now - stateStartRef.current) / 1000;
      const { mic, output } = fakeLevel(stateRef.current, seconds);
      micRef.current = mic;
      outRef.current = output;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!cycle || states.length < 2) return;
    const id = window.setInterval(() => {
      setState((current) => {
        const idx = states.indexOf(current);
        return states[(idx + 1) % states.length];
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [cycle, intervalMs, states]);

  return (
    <div data-testid="orb-showcase" className={cn("flex flex-col items-center gap-5", className)}>
      <Orb
        state={state}
        micLevel={0}
        outputLevel={0}
        micLevelRef={micRef}
        outputLevelRef={outRef}
        size={size}
        label={label}
        color={color}
        reducedMotion={reducedMotion}
        className={size === "fluid" ? "aspect-square w-full" : undefined}
      />
      {showControls ? (
        <div role="radiogroup" aria-label="Preview orb state" className="flex flex-wrap justify-center gap-2">
          {states.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === state}
              data-testid={`orb-showcase-${s}`}
              onClick={() => setState(s)}
              className={cn(
                "min-h-12 rounded-full border px-4 text-[0.95rem] font-medium transition-colors",
                s === state ? "border-accent/60 bg-accent-soft text-foreground" : "border-line-strong text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {shortStateLabel(s)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
