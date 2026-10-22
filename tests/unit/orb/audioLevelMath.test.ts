import { describe, expect, it } from "vitest";
import { computeRms, frameScaledCoefficient, rmsToLevel, smoothLevel } from "@/components/orb/audioLevelMath";

describe("computeRms", () => {
  it("is 0 for silence (float and byte buffers)", () => {
    expect(computeRms(new Float32Array(256))).toBe(0);
    expect(computeRms(new Uint8Array(256).fill(128))).toBe(0);
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it("matches the amplitude of a constant signal", () => {
    expect(computeRms(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5);
    expect(computeRms(new Float32Array(64).fill(-0.25))).toBeCloseTo(0.25);
  });

  it("treats byte data as centered on 128", () => {
    const loud = new Uint8Array(64);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 ? 255 : 0;
    expect(computeRms(loud)).toBeGreaterThan(0.99);
    expect(computeRms(loud)).toBeLessThanOrEqual(1);
  });

  it("computes a sine wave's RMS (~0.707 of peak)", () => {
    const n = 1024;
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++) sine[i] = Math.sin((i / n) * Math.PI * 2 * 8);
    expect(computeRms(sine)).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe("rmsToLevel", () => {
  it("returns 0 at or below the noise floor and for non-finite input", () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(0.004)).toBe(0);
    expect(rmsToLevel(0.001)).toBe(0);
    expect(rmsToLevel(Number.NaN)).toBe(0);
    expect(rmsToLevel(-1)).toBe(0);
  });

  it("is monotonic and clamps at 1", () => {
    let prev = 0;
    for (const rms of [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1]) {
      const level = rmsToLevel(rms);
      expect(level).toBeGreaterThanOrEqual(prev);
      expect(level).toBeLessThanOrEqual(1);
      prev = level;
    }
    expect(rmsToLevel(0.9)).toBe(1);
    expect(rmsToLevel(5)).toBe(1);
  });

  it("lifts quiet speech so soft voices still move the orb", () => {
    // ~0.05 RMS is a soft voice on a laptop mic.
    expect(rmsToLevel(0.05)).toBeGreaterThan(0.25);
    expect(rmsToLevel(0.05)).toBeLessThan(0.6);
    // The curve (<1) lifts low values above the linear mapping.
    expect(rmsToLevel(0.05, { curve: 0.65 })).toBeGreaterThan(rmsToLevel(0.05, { curve: 1 }));
  });

  it("respects a custom gain", () => {
    expect(rmsToLevel(0.1, { gain: 2 })).toBeLessThan(rmsToLevel(0.1, { gain: 8 }));
  });
});

describe("smoothLevel", () => {
  it("rises faster than it falls", () => {
    const up = smoothLevel(0, 1);
    const down = 1 - smoothLevel(1, 0);
    expect(up).toBeGreaterThan(down);
    expect(up).toBeCloseTo(0.55);
    expect(down).toBeCloseTo(0.12);
  });

  it("snaps tiny values to 0 and clamps to 1", () => {
    expect(smoothLevel(0.0005, 0)).toBe(0);
    expect(smoothLevel(0.9, 5, { attack: 1 })).toBe(1);
  });

  it("converges toward the target", () => {
    let level = 0;
    for (let i = 0; i < 40; i++) level = smoothLevel(level, 0.8);
    expect(level).toBeCloseTo(0.8, 2);
    for (let i = 0; i < 200; i++) level = smoothLevel(level, 0);
    expect(level).toBe(0);
  });
});

describe("frameScaledCoefficient", () => {
  it("equals the coefficient at 60fps and grows for longer frames", () => {
    expect(frameScaledCoefficient(0.5, 1 / 60)).toBeCloseTo(0.5);
    expect(frameScaledCoefficient(0.5, 2 / 60)).toBeCloseTo(0.75);
    expect(frameScaledCoefficient(0.5, 1)).toBeLessThanOrEqual(1);
    expect(frameScaledCoefficient(0.5, 0)).toBeGreaterThan(0);
  });
});
