/**
 * MathLib — shared math / colour / noise utilities consumed by all evaluators.
 *
 * Previously duplicated across GeometryEvaluator, ShaderEvaluator, and
 * CommonExecutors. Centralised here to eliminate copy-paste drift.
 *
 * All functions are pure and side-effect free.
 */

import type { Vec3, RGBA } from '../core/types';

/* ──────────────────────────────────────────── Common helpers ─── */

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export const smooth01 = (t: number): number => t * t * (3 - 2 * t);

export const fract = (x: number): number => x - Math.floor(x);

/** Safe 1/sqrt(x). Returns 0 when x ≤ 0. */
export const rsqrt = (x: number): number => (x > 1e-15 ? 1 / Math.sqrt(x) : 0);

/** Normalize a Vec3 in-place-ish: returns [0,0,0] for zero-length vectors. */
export const normalize3 = (v: Vec3): Vec3 => {
  const l = rsqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] * l, v[1] * l, v[2] * l];
};

/* ──────────────────────────────────────────── Stable hashing ─── */

/**
 * 32-bit integer hash (PCG / Wang-style). Deterministic uniform float in [0,1).
 * Replaces the legacy `sin(x*127.1)*43758.5` ShaderToy hash which produced
 * visible banding/repetition.
 */
export function ihash2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = Math.floor((x - xi) * 0xffffff);
  const yf = Math.floor((y - yi) * 0xffffff);
  let h = (xi * 0x27d4eb2d) ^ (yi * 0x165667b1) ^ (xf * 0x9e3779b1) ^ (yf * 0x85ebca6b);
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h >>> 0) / 0x100000000;
}

export function ihash3(x: number, y: number, z: number): number {
  let h = ((x | 0) * 0x27d4eb2d) ^ ((y | 0) * 0x165667b1) ^ ((z | 0) * 0x9e3779b1);
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h >>> 0) / 0x100000000;
}

/* ──────────────────────────────────────────── Noise ───────────── */

/** Smooth value noise 2D. */
export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = smooth01(xf), sy = smooth01(yf);
  const a = ihash2(xi, yi);
  const b = ihash2(xi + 1, yi);
  const c = ihash2(xi, yi + 1);
  const d = ihash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/** Smooth value noise 3D (two 2D planes averaged). */
export function valueNoise3(x: number, y: number, z: number): number {
  return (valueNoise2(x + z * 0.37, y + z * 0.61)
        + valueNoise2(y + x * 0.19, z + x * 0.53)) * 0.5;
}

/**
 * Multi-octave fBm (Blender Noise Texture: octaves = detail + 1,
 * falloff = roughness).
 */
export function fbm3(
  x: number, y: number, z: number,
  detail: number, roughness: number,
): number {
  const octaves = Math.min(8, Math.max(1, Math.round(detail) + 1));
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= roughness;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/* ──────────────────────────────────────────── Voronoi ─────────── */

export interface VoronoiResult {
  dist: number;
  color: Vec3;
  pos: Vec3;
  dist2: number;   // F2 distance (second closest)
  cell: Vec3;      // cell position of F1
}

export function voronoiF1F2(
  x: number, y: number, z: number, randomness: number, metric: number,
): VoronoiResult {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  let best = Infinity, best2 = Infinity;
  let bcol: Vec3 = [0, 0, 0];
  let bpos: Vec3 = [0, 0, 0];
  let bcell: Vec3 = [0, 0, 0];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx, iy = cy + dy, iz = cz + dz;
        const jx = ix + (ihash3(ix, iy, iz) - 0.5) * randomness + 0.5;
        const jy = iy + (ihash3(iy, iz, ix) - 0.5) * randomness + 0.5;
        const jz = iz + (ihash3(iz, ix, iy) - 0.5) * randomness + 0.5;
        const ddx = jx - x, ddy = jy - y, ddz = jz - z;
        const d =
          metric === 1 ? Math.abs(ddx) + Math.abs(ddy) + Math.abs(ddz)
          : metric === 2 ? Math.max(Math.abs(ddx), Math.abs(ddy), Math.abs(ddz))
          : metric === 3 ? ddx * ddx + ddy * ddy + (ddz * ddz) * 0.25
          : ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < best) {
          best2 = best;
          best = d;
          bpos = [jx, jy, jz];
          bcol = [ihash3(ix, iy, iz), ihash3(iy, iz, ix), ihash3(iz, ix, iy)];
          bcell = [ix, iy, iz];
        } else if (d < best2) {
          best2 = d;
        }
      }
    }
  }
  return { dist: Math.sqrt(best), color: bcol, pos: bpos, dist2: Math.sqrt(best2), cell: bcell };
}

/* ──────────────────────────────────────────── Colour spaces ───── */

/** RGB → HSV. All channels in [0, 1]. Returns [hue, saturation, value]. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360 / 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** HSV → RGB. All channels in [0, 1]. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b2 = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b2 = x; }
  else if (hp < 4) { g = x; b2 = c; }
  else if (hp < 5) { r = x; b2 = c; }
  else { r = c; b2 = x; }
  return [r + m, g + m, b2 + m];
}

/** RGB → HSL. All channels in [0, 1]. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

/** HSL → RGB helper. */
export function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** HSL → RGB. All channels in [0, 1]. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1 / 3),
  ];
}

/* ──────────────────────────────────────────── BSDF helpers ────── */

/** Schlick Fresnel approximation. */
export const schlickFresnel = (cosTheta: number, f0: number): number =>
  f0 + (1 - f0) * Math.pow(1 - cosTheta, 5);

/** GGX distribution term. */
export const ggxDistrib = (nDotH: number, roughness: number): number => {
  const a = roughness * roughness;
  const a2 = a * a;
  const denom = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (Math.PI * denom * denom);
};

/** Smith geometry term. */
export const smithG = (nDotV: number, nDotL: number, roughness: number): number => {
  const k = (roughness + 1) * (roughness + 1) / 8;
  return (nDotV / (nDotV * (1 - k) + k)) * (nDotL / (nDotL * (1 - k) + k));
};

/* ──────────────────────────────────────────── Misc ─────────────── */

/** Safe division: returns fallback when denominator is near zero. */
export const safeDiv = (a: number, b: number, fallback = 0): number =>
  Math.abs(b) < 1e-15 ? fallback : a / b;

/** Clamp a value to [lo, hi]. */
export const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

/** Linear remap: from range [inLo, inHi] to [outLo, outHi]. */
export const remap = (x: number, inLo: number, inHi: number, outLo: number, outHi: number): number =>
  outLo + ((x - inLo) / (inHi - inLo || 1)) * (outHi - outLo);

/** 4x4 identity matrix (column-major). */
export const IDENTITY_4X4: readonly number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];