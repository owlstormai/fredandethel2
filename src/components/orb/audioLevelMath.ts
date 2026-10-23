/**
 * Pure math for turning audio samples into a 0..1 "level". Kept free of Web
 * Audio so it can be unit-tested in Node.
 */

export interface LevelOptions {
  /** Linear gain before the curve. Speech RMS is small (~0.02–0.3). Default 4. */
  gain?: number;
  /** RMS below this is treated as silence (mic hiss). Default 0.004. */
  floor?: number;
  /** Exponent < 1 lifts quiet speech so the orb reacts to soft voices. Default 0.65. */
  curve?: number;
}

export interface SmoothingOptions {
  /** 0..1 fraction of the gap closed per step when rising. Default 0.55. */
  attack?: number;
  /** 0..1 fraction of the gap closed per step when falling. Default 0.12. */
  release?: number;
}

/** RMS of time-domain samples. Float32 (-1..1) or Uint8 (centered at 128). */
export function computeRms(data: Float32Array | Uint8Array): number {
  const n = data.length;
  if (n === 0) return 0;
  let sum = 0;
  if (data instanceof Uint8Array) {
    for (let i = 0; i < n; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const v = data[i];
      sum += v * v;
    }
  }
  return Math.sqrt(sum / n);
}

/** Map an RMS value to a perceptual 0..1 level with a noise floor and gentle gain. */
export function rmsToLevel(rms: number, options: LevelOptions = {}): number {
  const { gain = 4, floor = 0.004, curve = 0.65 } = options;
  if (!Number.isFinite(rms) || rms <= floor) return 0;
  const lifted = (rms - floor) * gain;
  const clamped = lifted > 1 ? 1 : lifted < 0 ? 0 : lifted;
  return Math.pow(clamped, curve);
}

/** Asymmetric smoothing: fast attack, slow release (feels like a VU meter). */
export function smoothLevel(previous: number, target: number, options: SmoothingOptions = {}): number {
  const { attack = 0.55, release = 0.12 } = options;
  const k = target > previous ? attack : release;
  const next = previous + (target - previous) * k;
  if (next < 0.001) return 0;
  return next > 1 ? 1 : next;
}

/** Scale a per-frame smoothing coefficient to a variable frame time (60fps reference). */
export function frameScaledCoefficient(coefficient: number, dtSeconds: number): number {
  const frames = Math.max(0.25, Math.min(6, dtSeconds * 60));
  return 1 - Math.pow(1 - coefficient, frames);
}
