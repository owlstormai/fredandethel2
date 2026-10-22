/**
 * Orb palette — colors per OrbColor plus per-state tints.
 * Pure data + math; safe to import in tests and on the server.
 */
import type { OrbColor, OrbState } from "@/lib/types";

export type Rgb = readonly [number, number, number];

export interface OrbPalette {
  /** Brightest center of the sphere (tinted near-white). */
  core: Rgb;
  /** Main body of the sphere. */
  inner: Rgb;
  /** Darker edge of the sphere. */
  outer: Rgb;
  /** Bloom / glow around the sphere. */
  glow: Rgb;
  /** Rings, particles, ripples. */
  ring: Rgb;
}

export const ORB_PALETTES: Record<OrbColor, OrbPalette> = {
  cyan: {
    core: [236, 252, 255],
    inner: [94, 225, 255],
    outer: [10, 92, 140],
    glow: [56, 200, 255],
    ring: [150, 232, 255],
  },
  violet: {
    core: [246, 240, 255],
    inner: [185, 160, 255],
    outer: [70, 40, 150],
    glow: [160, 125, 255],
    ring: [205, 185, 255],
  },
  emerald: {
    core: [236, 255, 246],
    inner: [111, 231, 183],
    outer: [10, 110, 80],
    glow: [60, 215, 150],
    ring: [160, 240, 205],
  },
  amber: {
    core: [255, 249, 236],
    inner: [255, 201, 113],
    outer: [150, 85, 15],
    glow: [250, 180, 70],
    ring: [255, 220, 160],
  },
  white: {
    core: [255, 255, 255],
    inner: [225, 232, 245],
    outer: [95, 110, 140],
    glow: [205, 215, 235],
    ring: [235, 240, 250],
  },
};

/** Tint applied per state: `mix` toward `toward`, and saturation 0..1. */
export interface StateTint {
  toward: Rgb | null;
  mix: number;
  saturation: number;
  /** Overall brightness multiplier for the resolved palette. */
  brightness: number;
}

export const ERROR_TINT: Rgb = [255, 130, 80];

export const STATE_TINTS: Record<OrbState, StateTint> = {
  idle: { toward: null, mix: 0, saturation: 1, brightness: 1 },
  connecting: { toward: null, mix: 0, saturation: 0.9, brightness: 0.95 },
  listening: { toward: null, mix: 0, saturation: 1, brightness: 1.05 },
  thinking: { toward: null, mix: 0, saturation: 1, brightness: 1 },
  speaking: { toward: null, mix: 0, saturation: 1, brightness: 1.08 },
  interrupted: { toward: null, mix: 0, saturation: 0.3, brightness: 0.9 },
  muted: { toward: null, mix: 0, saturation: 0.55, brightness: 0.75 },
  error: { toward: ERROR_TINT, mix: 0.75, saturation: 1, brightness: 0.95 },
  offline: { toward: null, mix: 0, saturation: 0.15, brightness: 0.45 },
};

export const ORB_COLOR_LIST: readonly OrbColor[] = ["cyan", "violet", "emerald", "amber", "white"];

export function isOrbColor(value: unknown): value is OrbColor {
  return typeof value === "string" && (ORB_COLOR_LIST as readonly string[]).includes(value);
}

/** Resolve a (possibly missing/invalid) attribute value to a valid OrbColor. */
export function resolveOrbColor(value: string | null | undefined, fallback: OrbColor = "cyan"): OrbColor {
  return isOrbColor(value) ? value : fallback;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

/** Rec. 601 luma — good enough for desaturation. */
export function luma(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

export function desaturate(rgb: Rgb, saturation: number): Rgb {
  const l = luma(rgb);
  const s = clamp01(saturation);
  return [lerp(l, rgb[0], s), lerp(l, rgb[1], s), lerp(l, rgb[2], s)];
}

export function scaleRgb(rgb: Rgb, k: number): Rgb {
  return [Math.min(255, rgb[0] * k), Math.min(255, rgb[1] * k), Math.min(255, rgb[2] * k)];
}

export function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp01(alpha).toFixed(3)})`;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Apply a tint (mix + saturation + brightness) to every channel of a palette. */
export function tintPalette(palette: OrbPalette, tint: StateTint): OrbPalette {
  const apply = (c: Rgb, keepCoreLight = false): Rgb => {
    let out: Rgb = c;
    if (tint.toward && tint.mix > 0) out = mixRgb(out, tint.toward, keepCoreLight ? tint.mix * 0.35 : tint.mix);
    out = desaturate(out, tint.saturation);
    return scaleRgb(out, tint.brightness);
  };
  return {
    core: apply(palette.core, true),
    inner: apply(palette.inner),
    outer: apply(palette.outer),
    glow: apply(palette.glow),
    ring: apply(palette.ring),
  };
}

/** Interpolate two palettes (used for smooth state/color transitions). */
export function mixPalette(a: OrbPalette, b: OrbPalette, t: number): OrbPalette {
  return {
    core: mixRgb(a.core, b.core, t),
    inner: mixRgb(a.inner, b.inner, t),
    outer: mixRgb(a.outer, b.outer, t),
    glow: mixRgb(a.glow, b.glow, t),
    ring: mixRgb(a.ring, b.ring, t),
  };
}

/** The fully resolved palette for a color in a state. */
export function paletteFor(color: OrbColor, state: OrbState): OrbPalette {
  return tintPalette(ORB_PALETTES[color], STATE_TINTS[state]);
}

/** CSS color string for the accent swatch of a color (settings UI). */
export function swatchColor(color: OrbColor): string {
  return rgba(ORB_PALETTES[color].inner, 1);
}
