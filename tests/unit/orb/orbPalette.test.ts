import { describe, expect, it } from "vitest";
import {
  desaturate,
  ERROR_TINT,
  isOrbColor,
  luma,
  mixPalette,
  mixRgb,
  ORB_COLOR_LIST,
  ORB_PALETTES,
  paletteFor,
  resolveOrbColor,
  rgba,
  STATE_TINTS,
  swatchColor,
  type Rgb,
} from "@/components/orb/orbPalette";
import { ORB_STATES } from "@/components/orb/orbState";

const CHANNELS = ["core", "inner", "outer", "glow", "ring"] as const;

function validRgb(c: Rgb) {
  return c.length === 3 && c.every((v) => Number.isFinite(v) && v >= 0 && v <= 255);
}

describe("orbPalette", () => {
  it("defines a complete palette for every orb color", () => {
    for (const color of ORB_COLOR_LIST) {
      const palette = ORB_PALETTES[color];
      for (const ch of CHANNELS) expect(validRgb(palette[ch]), `${color}.${ch}`).toBe(true);
      // Core is the brightest, outer the darkest — that is what gives the sphere depth.
      expect(luma(palette.core)).toBeGreaterThan(luma(palette.inner));
      expect(luma(palette.inner)).toBeGreaterThan(luma(palette.outer));
    }
  });

  it("has a tint for every orb state and resolves valid colors for each", () => {
    for (const state of ORB_STATES) {
      expect(STATE_TINTS[state]).toBeDefined();
      for (const color of ORB_COLOR_LIST) {
        const palette = paletteFor(color, state);
        for (const ch of CHANNELS) expect(validRgb(palette[ch]), `${color}/${state}.${ch}`).toBe(true);
      }
    }
  });

  it("tints the error state toward amber/red", () => {
    const idle = paletteFor("cyan", "idle");
    const error = paletteFor("cyan", "error");
    // red channel rises, blue channel falls relative to the cyan base
    expect(error.inner[0]).toBeGreaterThan(idle.inner[0]);
    expect(error.inner[2]).toBeLessThan(idle.inner[2]);
    const distanceToTint = (c: Rgb) => Math.hypot(c[0] - ERROR_TINT[0], c[1] - ERROR_TINT[1], c[2] - ERROR_TINT[2]);
    expect(distanceToTint(error.inner)).toBeLessThan(distanceToTint(idle.inner));
  });

  it("desaturates interrupted and dims offline", () => {
    const spread = (c: Rgb) => Math.max(...c) - Math.min(...c);
    const idle = paletteFor("violet", "idle");
    const interrupted = paletteFor("violet", "interrupted");
    const offline = paletteFor("violet", "offline");
    expect(spread(interrupted.inner)).toBeLessThan(spread(idle.inner));
    expect(luma(offline.inner)).toBeLessThan(luma(idle.inner) * 0.6);
    expect(spread(offline.inner)).toBeLessThan(spread(interrupted.inner));
  });

  it("desaturate(…, 0) yields a grey with equal channels", () => {
    const grey = desaturate([200, 50, 10], 0);
    expect(grey[0]).toBeCloseTo(grey[1]);
    expect(grey[1]).toBeCloseTo(grey[2]);
    expect(desaturate([200, 50, 10], 1)).toEqual([200, 50, 10]);
  });

  it("mixes colors and palettes linearly with clamped t", () => {
    expect(mixRgb([0, 0, 0], [255, 255, 255], 0.5)).toEqual([127.5, 127.5, 127.5]);
    expect(mixRgb([0, 0, 0], [255, 255, 255], 2)).toEqual([255, 255, 255]);
    const a = ORB_PALETTES.cyan;
    const b = ORB_PALETTES.amber;
    const mid = mixPalette(a, b, 0.5);
    expect(mid.inner[0]).toBeCloseTo((a.inner[0] + b.inner[0]) / 2);
    expect(mixPalette(a, b, 0)).toEqual(a);
  });

  it("formats rgba() strings with rounded channels and clamped alpha", () => {
    expect(rgba([10.4, 20.6, 30], 0.5)).toBe("rgba(10, 21, 30, 0.500)");
    expect(rgba([0, 0, 0], 2)).toBe("rgba(0, 0, 0, 1.000)");
    expect(rgba([0, 0, 0], -1)).toBe("rgba(0, 0, 0, 0.000)");
    expect(swatchColor("emerald")).toMatch(/^rgba\(\d+, \d+, \d+, 1\.000\)$/);
  });

  it("validates and resolves orb colors from attributes", () => {
    expect(isOrbColor("violet")).toBe(true);
    expect(isOrbColor("magenta")).toBe(false);
    expect(isOrbColor(null)).toBe(false);
    expect(resolveOrbColor("amber")).toBe("amber");
    expect(resolveOrbColor("nope")).toBe("cyan");
    expect(resolveOrbColor(undefined, "white")).toBe("white");
  });
});
