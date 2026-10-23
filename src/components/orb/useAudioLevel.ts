"use client";
/**
 * Web Audio → 0..1 level. `useAudioLevelRef` updates a ref every animation
 * frame (for the Orb loop); `useAudioLevel` additionally mirrors it into React
 * state at ~30fps for components that need to re-render (meters, captions).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { computeRms, frameScaledCoefficient, rmsToLevel, smoothLevel } from "./audioLevelMath";

export interface AudioLevelOptions {
  /** Release smoothing 0..1 (higher = slower fall). Default 0.85. */
  smoothing?: number;
  /** AnalyserNode fftSize (power of two, 32..32768). Default 1024. */
  fftSize?: number;
  /** Linear gain before the perceptual curve. Default 4. */
  gain?: number;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

const GESTURE_EVENTS: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];

export function useAudioLevelRef(stream: MediaStream | null, options: AudioLevelOptions = {}): RefObject<number> {
  const { smoothing = 0.85, fftSize = 1024, gain = 4 } = options;
  const levelRef = useRef(0);

  useEffect(() => {
    levelRef.current = 0;
    if (!stream || stream.getAudioTracks().length === 0) return;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    const floatBuf = new Float32Array(analyser.fftSize);
    const byteBuf = new Uint8Array(analyser.fftSize);
    const hasFloat = typeof analyser.getFloatTimeDomainData === "function";
    const release = 1 - Math.min(0.99, Math.max(0, smoothing));

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      let rms = 0;
      if (hasFloat) {
        analyser.getFloatTimeDomainData(floatBuf);
        rms = computeRms(floatBuf);
      } else {
        analyser.getByteTimeDomainData(byteBuf);
        rms = computeRms(byteBuf);
      }
      const target = rmsToLevel(rms, { gain });
      levelRef.current = smoothLevel(levelRef.current, target, {
        attack: frameScaledCoefficient(0.6, dt),
        release: frameScaledCoefficient(release, dt),
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Autoplay policy: contexts may start suspended until a user gesture.
    const resume = () => {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    resume();
    GESTURE_EVENTS.forEach((e) => window.addEventListener(e, resume, { passive: true }));
    const onVisibility = () => {
      if (!document.hidden) resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      GESTURE_EVENTS.forEach((e) => window.removeEventListener(e, resume));
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* already disconnected */
      }
      void ctx.close().catch(() => {});
      levelRef.current = 0;
    };
  }, [stream, smoothing, fftSize, gain]);

  return levelRef;
}

const STATE_FPS = 30;

export function useAudioLevel(stream: MediaStream | null, options: AudioLevelOptions = {}): number {
  const ref = useAudioLevelRef(stream, options);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    let lastPublished = -1;
    const id = window.setInterval(() => {
      const next = Math.round(ref.current * 100) / 100;
      if (next !== lastPublished) {
        lastPublished = next;
        setLevel(next);
      }
    }, 1000 / STATE_FPS);
    return () => window.clearInterval(id);
  }, [ref, stream]);

  return stream ? level : 0;
}
