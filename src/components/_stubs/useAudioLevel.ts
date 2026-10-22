"use client";
/**
 * TODO(integration): TEMPORARY STUB owned by Agent B. Replace with Agent A's
 * hooks from "@/components/orb/useAudioLevel" (same signatures) by editing
 * src/components/voice/integration.ts.
 *
 * Functional Web Audio analyser so the orb reacts to real microphone and
 * remote audio even before the real implementation lands.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { computeRms, rmsToLevel, smoothLevel } from "@/components/orb/audioLevelMath";

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Continuously analysed 0..1 level, written to a ref (no re-renders). */
export function useAudioLevelRef(stream: MediaStream | null): RefObject<number> {
  const levelRef = useRef(0);
  useEffect(() => {
    levelRef.current = 0;
    if (!stream || stream.getAudioTracks().length === 0) return;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buffer);
        const target = rmsToLevel(computeRms(buffer));
        levelRef.current = smoothLevel(levelRef.current, target);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    } catch {
      /* analyser unavailable: level stays 0 */
    }
    return () => {
      cancelAnimationFrame(raf);
      levelRef.current = 0;
      void ctx?.close().catch(() => {});
    };
  }, [stream]);
  return levelRef;
}

/** Re-rendering variant (~30 Hz) for components that need the number as state. */
export function useAudioLevel(stream: MediaStream | null): number {
  const ref = useAudioLevelRef(stream);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }
    const id = setInterval(() => setLevel((prev) => (Math.abs(prev - ref.current) > 0.01 ? ref.current : prev)), 33);
    return () => clearInterval(id);
  }, [stream, ref]);
  return level;
}
