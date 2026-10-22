/**
 * OrbRenderer — Canvas 2D drawing of the luminous orb. Framework-free so it can
 * be driven from React (Orb.tsx) or anywhere else. One instance per canvas.
 *
 * Visual grammar (see orbState.ts for the per-state targets):
 *  bloom → particle field → rotating rings (+connecting tracer) → listening
 *  ripples → speaking waveform rings → sphere body (gradient, breathing core,
 *  rim, specular) → thinking motes/shimmer → muted bar.
 */
import type { OrbColor, OrbState } from "@/lib/types";
import { frameScaledCoefficient, smoothLevel } from "./audioLevelMath";
import { clamp01, mixPalette, mixRgb, paletteFor, rgba, type OrbPalette } from "./orbPalette";
import { levelSourceFor, ORB_STATE_PARAMS, tweenTimeConstant, type OrbVisualParams } from "./orbState";

interface Particle {
  orbit: number;
  angle: number;
  speed: number;
  size: number;
  twinkleOffset: number;
  twinkleSpeed: number;
}

interface Ripple {
  age: number;
  strength: number;
}

interface RingSpec {
  r: number;
  width: number;
  dir: 1 | -1;
  speed: number;
  /** [startDeg, lengthDeg] */
  arcs: Array<[number, number]>;
}

const RINGS: RingSpec[] = [
  { r: 1.24, width: 1.25, dir: 1, speed: 0.07, arcs: [[0, 200], [230, 70]] },
  { r: 1.4, width: 0.9, dir: -1, speed: 0.045, arcs: [[20, 120], [180, 40], [260, 60]] },
  { r: 1.58, width: 0.7, dir: 1, speed: 0.03, arcs: [[90, 250]] },
];

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const PARTICLE_COUNT = 56;

/** Deterministic PRNG (mulberry32) so the field looks the same on every mount. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARAM_KEYS = Object.keys(ORB_STATE_PARAMS.idle) as Array<keyof OrbVisualParams>;

export class OrbRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private t = 0;
  private lastNow: number | null = null;

  private state: OrbState = "offline";
  private color: OrbColor = "cyan";
  private params: OrbVisualParams = { ...ORB_STATE_PARAMS.offline };
  private target: OrbVisualParams = { ...ORB_STATE_PARAMS.offline };
  private tau = tweenTimeConstant("offline");
  private palette: OrbPalette = paletteFor("cyan", "offline");
  private targetPalette: OrbPalette = paletteFor("cyan", "offline");
  private level = 0;
  private reduced = false;
  private readonly particles: Particle[];
  private ripples: Ripple[] = [];
  private rippleCooldown = 0;

  constructor(private readonly canvas: HTMLCanvasElement, seed = 7) {
    this.ctx = canvas.getContext("2d", { alpha: true });
    const rand = mulberry32(seed);
    this.particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      orbit: 1.12 + rand() * 0.85,
      angle: rand() * TAU,
      speed: (0.05 + rand() * 0.12) * (rand() > 0.5 ? 1 : -1),
      size: 0.6 + rand() * 1.1,
      twinkleOffset: rand() * TAU,
      twinkleSpeed: 0.6 + rand() * 1.6,
    }));
  }

  get isReducedMotion(): boolean {
    return this.reduced;
  }
  get smoothedLevel(): number {
    return this.level;
  }
  get currentState(): OrbState {
    return this.state;
  }

  setState(state: OrbState): void {
    if (state === this.state) return;
    this.state = state;
    this.target = { ...ORB_STATE_PARAMS[state] };
    this.tau = tweenTimeConstant(state);
    this.targetPalette = paletteFor(this.color, state);
    if (state === "interrupted") this.ripples = [];
  }

  setColor(color: OrbColor): void {
    if (color === this.color) return;
    this.color = color;
    this.targetPalette = paletteFor(color, this.state);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) this.ripples = [];
  }

  /** CSS pixel size + device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    this.width = w;
    this.height = h;
    this.dpr = Math.max(1, Math.min(dpr || 1, 2));
    const pw = Math.round(w * this.dpr);
    const ph = Math.round(h * this.dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
  }

  /** Snap all tweens to their targets (used for first paint / reduced motion). */
  settle(): void {
    this.params = { ...this.target };
    this.palette = this.targetPalette;
  }

  /** Render one frame. `mic` and `output` are 0..1. */
  frame(now: number, mic: number, output: number): void {
    const ctx = this.ctx;
    if (!ctx || this.width === 0 || this.height === 0) return;

    const dt = this.lastNow === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const anim = this.reduced ? 0 : 1;
    this.t += dt * anim;

    // --- tween params + palette toward targets -------------------------------
    const k = 1 - Math.exp(-dt / this.tau);
    for (const key of PARAM_KEYS) {
      const cur = this.params[key];
      const tgt = this.target[key];
      this.params[key] = Math.abs(tgt - cur) < 0.0005 ? tgt : cur + (tgt - cur) * k;
    }
    this.palette = mixPalette(this.palette, this.targetPalette, Math.min(1, k * 1.3));
    const p = this.params;
    const pal = this.palette;

    // --- level ---------------------------------------------------------------
    const source = levelSourceFor(this.state);
    let raw = source === "mic" ? clamp01(mic) : source === "output" ? clamp01(output) : 0;
    if (this.state === "idle") raw *= 0.5; // a hint of reactivity, not a VU meter
    this.level = smoothLevel(this.level, raw, {
      attack: frameScaledCoefficient(0.5, dt),
      release: frameScaledCoefficient(0.1, dt),
    });
    const level = this.level;

    // --- geometry ------------------------------------------------------------
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.29;
    const t = this.t;
    const breath = p.breathAmp > 0 ? Math.sin(t * TAU * p.breathSpeed) * p.breathAmp : 0;
    const throb = p.throb > 0 ? Math.sin(t * TAU * 0.45) * p.throb : 0;
    const levelRadius = this.reduced ? 0 : level * p.levelInfluence * 0.16;
    const r = R * (p.radius + breath + throb + levelRadius);
    const bright = Math.min(1.15, p.core + level * p.levelInfluence * 0.5);
    const snapScale = 1 + p.snap * 0.07;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";

    // --- bloom ---------------------------------------------------------------
    ctx.globalCompositeOperation = "lighter";
    {
      const ga = 0.5 * p.glow * (0.75 + 0.35 * bright);
      const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.25);
      g.addColorStop(0, rgba(pal.glow, ga));
      g.addColorStop(0.42, rgba(pal.glow, ga * 0.32));
      g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.25, 0, TAU);
      ctx.fill();
    }

    // --- particle field --------------------------------------------------------
    if (p.particles > 0.01) {
      const speedMul = 0.6 + 0.4 * p.ringSpeed;
      for (const pt of this.particles) {
        pt.angle += pt.speed * dt * anim * speedMul;
        const pr = R * pt.orbit * snapScale;
        const x = cx + Math.cos(pt.angle) * pr;
        const y = cy + Math.sin(pt.angle) * pr * 0.98;
        const tw = anim ? 0.55 + 0.45 * Math.sin(t * pt.twinkleSpeed + pt.twinkleOffset) : 0.75;
        ctx.fillStyle = rgba(pal.ring, p.particles * tw * 0.9);
        ctx.beginPath();
        ctx.arc(x, y, pt.size, 0, TAU);
        ctx.fill();
      }
    }

    // --- rings ---------------------------------------------------------------------
    if (p.rings > 0.01) {
      RINGS.forEach((ring, i) => {
        const rot = t * TAU * ring.speed * ring.dir * p.ringSpeed;
        const pulse = p.sweep > 0.01 && anim ? R * 0.012 * Math.sin(t * TAU * 0.7 + i) * p.sweep : 0;
        const rr = r * ring.r * snapScale + pulse;
        ctx.lineWidth = ring.width;
        ctx.strokeStyle = rgba(pal.ring, p.rings * (0.85 - i * 0.2));
        for (const [a0, len] of ring.arcs) {
          ctx.beginPath();
          ctx.arc(cx, cy, rr, rot + a0 * DEG, rot + (a0 + len) * DEG);
          ctx.stroke();
        }
      });
    }

    // --- connecting tracer -----------------------------------------------------------
    if (p.sweep > 0.01) {
      const rr = r * RINGS[0].r * snapScale;
      const head = anim ? t * TAU * 1.1 : -Math.PI / 3;
      const len = 1.35;
      const segments = 7;
      ctx.lineWidth = 2.4;
      for (let s = 0; s < segments; s++) {
        const a0 = head - len + (s / segments) * len;
        const a1 = head - len + ((s + 1) / segments) * len + 0.02;
        ctx.strokeStyle = rgba(pal.core, p.sweep * ((s + 1) / segments) * 0.9);
        ctx.beginPath();
        ctx.arc(cx, cy, rr, a0, a1);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(pal.core, p.sweep);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(head) * rr, cy + Math.sin(head) * rr, 2.6, 0, TAU);
      ctx.fill();
    }

    // --- listening ripples -------------------------------------------------------------
    this.rippleCooldown -= dt;
    if (p.ripple > 0.05 && anim && level > 0.1 && this.rippleCooldown <= 0) {
      this.ripples.push({ age: 0, strength: level });
      this.rippleCooldown = 0.24 - 0.12 * level;
      if (this.ripples.length > 8) this.ripples.shift();
    }
    if (this.ripples.length > 0) {
      const next: Ripple[] = [];
      for (const rp of this.ripples) {
        rp.age += dt * 1.1 * anim;
        if (rp.age >= 1) continue;
        next.push(rp);
        const rad = r * (1.02 + rp.age * 0.8);
        const alpha = Math.pow(1 - rp.age, 1.5) * 0.55 * p.ripple * (0.4 + 0.6 * rp.strength);
        ctx.lineWidth = 1.6 * (1 - rp.age) + 0.4;
        ctx.strokeStyle = rgba(pal.ring, alpha);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.stroke();
      }
      this.ripples = next;
    }

    // --- speaking waveform rings ----------------------------------------------------------
    if (p.wave > 0.01 && anim) {
      const amp = r * (0.035 + 0.14 * level) * p.wave;
      const draw = (base: number, scale: number, phase: number, alpha: number, width: number) => {
        const N = 150;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const ang = (i / N) * TAU;
          const wobble =
            Math.sin(ang * 5 + t * 6.5 + phase) * 0.55 + Math.sin(ang * 9 - t * 8.3 + phase) * 0.3 + Math.sin(ang * 14 + t * 11 + phase) * 0.15;
          const rad = base + wobble * amp * scale;
          const x = cx + Math.cos(ang) * rad;
          const y = cy + Math.sin(ang) * rad;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.lineWidth = width;
        ctx.strokeStyle = rgba(pal.core, alpha);
        ctx.stroke();
      };
      draw(r * 1.1, 1, 0, p.wave * (0.25 + 0.45 * level), 1.8);
      draw(r * 1.17, 0.6, 1.7, p.wave * (0.12 + 0.25 * level), 1);
    }

    // --- sphere body ------------------------------------------------------------------------
    ctx.globalCompositeOperation = "source-over";
    {
      const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.32, r * 0.05, cx, cy, r * 1.02);
      body.addColorStop(0, rgba(pal.core, 0.96 * Math.min(1, bright + 0.15)));
      body.addColorStop(0.28, rgba(mixRgb(pal.core, pal.inner, 0.55), 0.95));
      body.addColorStop(0.7, rgba(pal.inner, 0.92));
      body.addColorStop(1, rgba(pal.outer, 0.96));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // breathing core
      const breathe = anim ? 0.65 + 0.35 * Math.sin(t * TAU * Math.max(p.breathSpeed, 0.08) + 1) : 0.8;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.95);
      core.addColorStop(0, rgba(pal.core, 0.6 * bright * breathe));
      core.addColorStop(0.5, rgba(pal.inner, 0.18 * bright));
      core.addColorStop(1, rgba(pal.inner, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // edge depth
      const edge = ctx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r);
      edge.addColorStop(0, "rgba(0,0,0,0)");
      edge.addColorStop(1, rgba(mixRgb(pal.outer, [0, 0, 0], 0.55), 0.5));
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // specular highlight
      const spec = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, 0, cx - r * 0.38, cy - r * 0.42, r * 0.5);
      spec.addColorStop(0, `rgba(255,255,255,${(0.26 * Math.min(1, bright + 0.2)).toFixed(3)})`);
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // rim
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = rgba(pal.ring, 0.3 + 0.25 * bright);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }

    // --- thinking motes + shimmer -------------------------------------------------------------
    ctx.globalCompositeOperation = "lighter";
    if (p.motes > 0.01) {
      const tilt = 0.5 + 0.3 * Math.sin(t * 0.6);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      for (let m = 0; m < 4; m++) {
        const dir = m % 2 ? 1 : -1;
        const a = t * TAU * (0.35 + m * 0.08) * dir + m * 1.9;
        const rx = r * (0.42 + m * 0.08);
        const ry = rx * 0.42;
        const lx = Math.cos(a) * rx;
        const ly = Math.sin(a) * ry;
        const x = cx + lx * ct - ly * st;
        const y = cy + lx * st + ly * ct;
        const depth = (Math.sin(a) + 1) / 2;
        const alpha = p.motes * (0.35 + 0.65 * depth);
        const size = 1.6 + 2 * depth;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 3.2);
        halo.addColorStop(0, rgba(pal.core, alpha * 0.4));
        halo.addColorStop(1, rgba(pal.core, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, size * 3.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(pal.core, alpha);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
    }
    if (p.shimmer > 0.01) {
      for (let i = 0; i < 2; i++) {
        const a0 = t * TAU * 0.25 * (i ? -1 : 1) + i * Math.PI;
        const alpha = p.shimmer * (0.12 + 0.1 * Math.sin(t * 3 + i));
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(pal.core, alpha);
        ctx.beginPath();
        ctx.arc(cx, cy, r * (0.74 + 0.1 * i), a0, a0 + 1.1);
        ctx.stroke();
      }
    }

    // --- muted bar -----------------------------------------------------------------------------
    ctx.globalCompositeOperation = "source-over";
    if (p.bar > 0.01) {
      const bw = r * 1.25;
      const bh = Math.max(3, r * 0.07);
      ctx.fillStyle = `rgba(235,240,250,${(0.85 * p.bar).toFixed(3)})`;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, bh / 2);
      else ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.fill();
    }
  }
}
