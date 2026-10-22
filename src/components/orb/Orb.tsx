"use client";
/**
 * <Orb /> — the face of Companion. Canvas 2D, DPR-aware, rAF loop that pauses
 * when the tab is hidden. State changes tween smoothly; audio levels modulate
 * radius/brightness (brightness only under reduced motion).
 *
 * Levels can be passed as numbers (React state) or as refs (`micLevelRef`,
 * `outputLevelRef`) that the rAF loop reads directly without re-rendering —
 * pair with `useAudioLevelRef` for the cheapest path.
 */
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import type { OrbColor, OrbState } from "@/lib/types";
import { useReducedMotion } from "@/components/providers/useReducedMotion";
import { cn } from "@/components/ui/cn";
import { clamp01 } from "./orbPalette";
import { OrbRenderer } from "./orbRenderer";
import { describeOrbState } from "./orbState";
import { useDocumentOrbColor } from "./useDocumentOrbColor";

export interface OrbProps {
  state: OrbState;
  /** Microphone level 0..1. */
  micLevel: number;
  /** Assistant output level 0..1. */
  outputLevel: number;
  /** Defaults to the live <html data-orb-color> attribute. */
  color?: OrbColor;
  /** Pixel size (square) or "fluid" to fill the parent. Default "fluid". */
  size?: number | "fluid";
  /** Defaults to the effective motion preference (in-app + OS). */
  reducedMotion?: boolean;
  /** Companion name used in the status text ("Fred is speaking"). */
  label?: string;
  /** Optional ref-based levels read in the animation loop (no re-render). */
  micLevelRef?: RefObject<number>;
  outputLevelRef?: RefObject<number>;
  className?: string;
  style?: CSSProperties;
}

interface LatestInputs {
  micLevel: number;
  outputLevel: number;
  micLevelRef?: RefObject<number>;
  outputLevelRef?: RefObject<number>;
}

const REDUCED_FRAME_INTERVAL_MS = 1000 / 15;
const ATTR_INTERVAL_MS = 100;

export function Orb({ state, micLevel, outputLevel, color, size = "fluid", reducedMotion, label, micLevelRef, outputLevelRef, className, style }: OrbProps) {
  const documentColor = useDocumentOrbColor();
  const effectiveReduced = useReducedMotion();
  const resolvedColor = color ?? documentColor;
  const reduced = reducedMotion ?? effectiveReduced;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OrbRenderer | null>(null);
  const latest = useRef<LatestInputs>({ micLevel: 0, outputLevel: 0 });

  useEffect(() => {
    latest.current = { micLevel, outputLevel, micLevelRef, outputLevelRef };
  }, [micLevel, outputLevel, micLevelRef, outputLevelRef]);

  // Renderer + animation loop (mount once).
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    console.log("[orb-debug] mount effect", { canvas: !!canvas, wrapper: !!wrapper });
    if (!canvas || !wrapper) return;

    const renderer = new OrbRenderer(canvas);
    rendererRef.current = renderer;

    const readLevels = () => {
      const l = latest.current;
      const mic = clamp01(l.micLevelRef?.current ?? l.micLevel);
      const output = clamp01(l.outputLevelRef?.current ?? l.outputLevel);
      return { mic, output };
    };

    let raf = 0;
    let lastFrame = -Infinity;
    let lastAttr = -Infinity;

    let frames = 0;
    const loop = (now: number) => {
      raf = 0;
      if (frames++ < 3) console.log("[orb-debug] loop", frames, now, wrapper.getBoundingClientRect().width, canvas.width);
      const { mic, output } = readLevels();
      const minInterval = renderer.isReducedMotion ? REDUCED_FRAME_INTERVAL_MS : 0;
      if (now - lastFrame >= minInterval) {
        renderer.frame(now, mic, output);
        lastFrame = now;
      }
      if (now - lastAttr >= ATTR_INTERVAL_MS) {
        wrapper.dataset.micLevel = mic.toFixed(2);
        wrapper.dataset.outputLevel = output.toFixed(2);
        lastAttr = now;
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const measure = () => {
      const rect = wrapper.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    measure();
    console.log("[orb-debug] measured", wrapper.getBoundingClientRect().width, canvas.width, canvas.height);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            measure();
    console.log("[orb-debug] measured", wrapper.getBoundingClientRect().width, canvas.width, canvas.height);
            if (document.hidden) {
              const { mic, output } = readLevels();
              renderer.frame(performance.now(), mic, output);
            }
          })
        : null;
    observer?.observe(wrapper);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      console.log("[orb-debug] cleanup");
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setState(state);
  }, [state]);
  useEffect(() => {
    rendererRef.current?.setColor(resolvedColor);
  }, [resolvedColor]);
  useEffect(() => {
    rendererRef.current?.setReducedMotion(reduced);
  }, [reduced]);

  const sizeStyle: CSSProperties = size === "fluid" ? { width: "100%", height: "100%" } : { width: size, height: size };
  const status = describeOrbState(state, label);

  return (
    <div
      ref={wrapperRef}
      data-testid="orb"
      data-state={state}
      data-color={resolvedColor}
      data-reduced-motion={reduced ? "true" : "false"}
      data-mic-level="0.00"
      data-output-level="0.00"
      role="img"
      aria-label={status}
      className={cn("relative block select-none", size === "fluid" && "min-h-40 min-w-40", className)}
      style={{ ...sizeStyle, ...style }}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="orb-status">
        {status}
      </span>
    </div>
  );
}
