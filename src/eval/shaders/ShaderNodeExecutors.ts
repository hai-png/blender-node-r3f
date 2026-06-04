/**
 * ShaderNodeExecutors — per-node execution functions for every shader node.
 *
 * Registers executors for BSDFs, textures, inputs, colour ops, etc.
 * The ShaderEvaluator delegates to these via dispatchNode().
 *
 * Register with `registerShaderExecutors()` — called by bootstrapBuiltins().
 */

import type { Node } from '../../core/Node';
import type { NodeSocket } from '../../core/NodeSocket';
import type { ValueCache } from '../NodeExecute';
import { registerExecutor } from '../NodeExecute';
import type { Vec3, RGBA } from '../../core/types';
import {
  lerp, clamp01, smooth01, fract, clamp,
  ihash3, valueNoise3, fbm3, voronoiF1F2,
  rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb,
} from '../MathLib';

/* ── Material descriptor ──────────────────────────────────────── */

export interface MaterialDescriptor {
  color: RGBA; metalness: number; roughness: number;
  emissive: Vec3; emissive_strength: number; opacity: number;
  noise_scale?: number;
}

export const MAT_DEFAULT: MaterialDescriptor = {
  color: [0.8, 0.8, 0.8, 1], metalness: 0, roughness: 0.5,
  emissive: [0, 0, 0], emissive_strength: 0, opacity: 1,
};

export function addDesc(a: MaterialDescriptor, b: MaterialDescriptor): MaterialDescriptor {
  return {
    color: [Math.min(1, a.color[0] + b.color[0]), Math.min(1, a.color[1] + b.color[1]),
           Math.min(1, a.color[2] + b.color[2]), Math.max(a.color[3], b.color[3])],
    metalness: Math.max(a.metalness, b.metalness),
    roughness: (a.roughness + b.roughness) / 2,
    emissive: [a.emissive[0] + b.emissive[0], a.emissive[1] + b.emissive[1], a.emissive[2] + b.emissive[2]],
    emissive_strength: a.emissive_strength + b.emissive_strength,
    opacity: Math.max(a.opacity, b.opacity),
  };
}

export function mixDesc(a: MaterialDescriptor, b: MaterialDescriptor, f: number): MaterialDescriptor {
  const m = (x: number, y: number) => x * (1 - f) + y * f;
  const mc = (x: RGBA, y: RGBA): RGBA => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2]), m(x[3], y[3])];
  const mv = (x: Vec3, y: Vec3): Vec3 => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  return {
    color: mc(a.color, b.color), metalness: m(a.metalness, b.metalness),
    roughness: m(a.roughness, b.roughness), emissive: mv(a.emissive, b.emissive),
    emissive_strength: m(a.emissive_strength, b.emissive_strength), opacity: m(a.opacity, b.opacity),
  };
}

/* ── Socket helpers ───────────────────────────────────────────── */

function resolveSocket(s: NodeSocket, cache: ValueCache): unknown {
  if (s.is_linked) {
    for (const l of s.links) { if (!l.is_muted && !l.escapes_zone) { const v = cache.get(l.from_socket.id); if (v !== undefined) return v; } }
  }
  return s.default_value;
}

function inpFile<T>(node: Node, name: string, cache: ValueCache, fb: T): T {
  const sock = node.inputs.find((s) => s.name === name || s.identifier === name);
  if (!sock) return fb;
  const v = resolveSocket(sock, cache);
  return (v !== undefined && v !== null) ? v as T : fb;
}

function outFile(node: Node, name: string, cache: ValueCache, value: unknown): void {
  const sock = node.outputs.find((s) => s.name === name || s.identifier === name);
  if (sock) cache.set(sock.id, value);
}

function nInp(node: Node, name: string, cache: ValueCache, fb = 0): number {
  const v = inpFile(node, name, cache, fb); return typeof v === 'number' ? v : Number(v ?? fb);
}
function vInp(node: Node, name: string, cache: ValueCache, fb: Vec3 = [0, 0, 0]): Vec3 {
  const v = inpFile(node, name, cache, fb); return (Array.isArray(v) && v.length >= 3) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] as Vec3 : fb;
}
function cInp(node: Node, name: string, cache: ValueCache, fb: RGBA = [1, 1, 1, 1]): RGBA {
  const v = inpFile(node, name, cache, fb); return (Array.isArray(v) && v.length >= 3) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1] as RGBA : fb;
}
function dInp(node: Node, name: string, cache: ValueCache): MaterialDescriptor {
  const v = inpFile(node, name, cache, undefined);
  return (v && typeof v === 'object' && 'color' in (v as object)) ? v as MaterialDescriptor : MAT_DEFAULT;
}

/* ── BSDF builder helper ──────────────────────────────────────── */

function bsdfOut(node: Node, cache: ValueCache, overrides: Partial<MaterialDescriptor> = {}): void {
  outFile(node, 'BSDF', cache, { ...MAT_DEFAULT, ...overrides });
}

/* ── Registration ─────────────────────────────────────────────── */

let _registered = false;
export function registerShaderExecutors(): void {
  if (_registered) return; _registered = true;

  // Output nodes (sinks — evaluator reads from them)
  for (const id of ['ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld', 'ShaderNodeOutputLight', 'ShaderNodeOutputAOV']) {
    registerExecutor(id, () => {});
  }

  // ── BSDFs ────────────────────────────────────────────────────
  registerExecutor('ShaderNodeBsdfPrincipled', (node, cache) => {
    const color = cInp(node, 'Base Color', cache);
    const metalness = nInp(node, 'Metallic', cache);
    const roughness = nInp(node, 'Roughness', cache, 0.5);
    const emission = cInp(node, 'Emission', cache);
    const emStr = nInp(node, 'Emission Strength', cache);
    const alpha = nInp(node, 'Alpha', cache, 1);
    bsdfOut(node, cache, {
      color, metalness, roughness,
      emissive: [emission[0] * emStr, emission[1] * emStr, emission[2] * emStr] as Vec3,
      emissive_strength: emStr, opacity: alpha,
    });
  });

  registerExecutor('ShaderNodeBsdfDiffuse', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.8, 0.8, 0.8, 1]), roughness: nInp(node, 'Roughness', cache, 0), metalness: 0 });
  });
  registerExecutor('ShaderNodeBsdfGlossy', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.8, 0.8, 0.8, 1]), roughness: nInp(node, 'Roughness', cache, 0.5), metalness: 0.5 });
  });
  registerExecutor('ShaderNodeBsdfGlass', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [1, 1, 1, 1]), roughness: nInp(node, 'Roughness', cache, 0), opacity: 0.95 });
  });
  registerExecutor('ShaderNodeBsdfRefraction', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [1, 1, 1, 1]), roughness: nInp(node, 'Roughness', cache, 0), opacity: 0.85 });
  });
  registerExecutor('ShaderNodeBsdfTransparent', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [1, 1, 1, 1]), opacity: 0 });
  });
  registerExecutor('ShaderNodeBsdfTranslucent', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.8, 0.8, 0.8, 1]), roughness: 1, metalness: 0 });
  });
  registerExecutor('ShaderNodeBsdfSheen', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.8, 0.8, 0.8, 1]), roughness: nInp(node, 'Roughness', cache, 0.5), metalness: 0 });
  });
  registerExecutor('ShaderNodeBsdfToon', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.8, 0.8, 0.8, 1]), roughness: 1 - nInp(node, 'Smooth', cache, 0), metalness: 0 });
  });
  registerExecutor('ShaderNodeSubsurfaceScattering', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.8, 0.8, 0.8, 1]), roughness: 0.5, metalness: 0 });
  });
  registerExecutor('ShaderNodeBsdfHair', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.5, 0.5, 0.5, 1]), metalness: 0, roughness: 0.5 });
  });
  registerExecutor('ShaderNodeBsdfHairPrincipled', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Color', cache, [0.5, 0.5, 0.5, 1]), metalness: 0, roughness: nInp(node, 'Roughness', cache, 0.5) });
  });
  registerExecutor('ShaderNodeEeveeSpecular', (node, cache) => {
    bsdfOut(node, cache, { color: cInp(node, 'Base Color', cache, [1, 1, 1, 1]), metalness: 0.5, roughness: nInp(node, 'Roughness', cache, 0.5) });
  });

  // ── Emission / Background / Holdout ─────────────────────────
  registerExecutor('ShaderNodeEmission', (node, cache) => {
    const col = cInp(node, 'Color', cache); const str = nInp(node, 'Strength', cache, 1);
    outFile(node, 'Emission', cache, { ...MAT_DEFAULT, color: [0, 0, 0, 1], emissive: [col[0] * str, col[1] * str, col[2] * str] as Vec3, emissive_strength: 1 } as MaterialDescriptor);
  });
  registerExecutor('ShaderNodeBackground', (node, cache) => {
    const col = cInp(node, 'Color', cache, [0.5, 0.5, 0.5, 1]); const str = nInp(node, 'Strength', cache, 1);
    outFile(node, 'Background', cache, { ...MAT_DEFAULT, color: col, emissive: [col[0] * str, col[1] * str, col[2] * str] as Vec3 } as MaterialDescriptor);
  });
  registerExecutor('ShaderNodeHoldout', (node, cache) => {
    outFile(node, 'Holdout', cache, { ...MAT_DEFAULT, color: [0, 0, 0, 0], opacity: 0 } as MaterialDescriptor);
  });

  // ── Mix / Add Shader ────────────────────────────────────────
  registerExecutor('ShaderNodeAddShader', (node, cache) => {
    outFile(node, 'Shader', cache, addDesc(dInp(node, 'Shader', cache), dInp(node, 'Shader_001', cache)));
  });
  registerExecutor('ShaderNodeMixShader', (node, cache) => {
    const fac = clamp01(nInp(node, 'Fac', cache, 0.5));
    outFile(node, 'Shader', cache, mixDesc(dInp(node, 'Shader', cache), dInp(node, 'Shader_001', cache), fac));
  });

  // ── Volume ──────────────────────────────────────────────────
  registerExecutor('ShaderNodeVolumeAbsorption', (node, cache) => {
    const col = cInp(node, 'Color', cache); const d = nInp(node, 'Density', cache, 1);
    outFile(node, 'Volume', cache, { ...MAT_DEFAULT, color: [0, 0, 0, 1], emissive: [col[0] * d * 0.1, col[1] * d * 0.1, col[2] * d * 0.1] as Vec3, opacity: clamp01(1 - d * 0.1) } as MaterialDescriptor);
  });
  registerExecutor('ShaderNodeVolumeScatter', (node, cache) => {
    const col = cInp(node, 'Color', cache); const d = nInp(node, 'Density', cache, 1);
    outFile(node, 'Volume', cache, { ...MAT_DEFAULT, color: col, opacity: clamp01(1 - d * 0.05) } as MaterialDescriptor);
  });
  registerExecutor('ShaderNodeVolumePrincipled', (node, cache) => {
    const col = cInp(node, 'Color', cache, [0.5, 0.5, 0.5, 1]); const d = nInp(node, 'Density', cache, 1);
    outFile(node, 'Volume', cache, { ...MAT_DEFAULT, color: [0, 0, 0, 1], emissive: [col[0] * d * 0.1, col[1] * d * 0.1, col[2] * d * 0.1] as Vec3, emissive_strength: d * 0.1, opacity: clamp01(1 - d * 0.1) } as MaterialDescriptor);
  });

  // ── Noise Texture ───────────────────────────────────────────
  registerExecutor('ShaderNodeTexNoise', (node, cache) => {
    const v = vInp(node, 'Vector', cache);
    const scale = nInp(node, 'Scale', cache, 5);
    const detail = nInp(node, 'Detail', cache, 2);
    const roughness = nInp(node, 'Roughness', cache, 0.5);
    const n = fbm3(v[0] * scale, v[1] * scale, v[2] * scale, detail, roughness);
    const c = clamp01(n * 0.5 + 0.5);
    outFile(node, 'Fac', cache, n);
    outFile(node, 'Color', cache, [c, c, c, 1] as RGBA);
  });

  // ── Other Textures ──────────────────────────────────────────
  registerExecutor('ShaderNodeTexVoronoi', (node, cache) => {
    const v = vInp(node, 'Vector', cache); const s = nInp(node, 'Scale', cache, 5);
    const rnd = nInp(node, 'Randomness', cache, 1);
    const vor = voronoiF1F2(v[0] * s, v[1] * s, v[2] * s, rnd, 0);
    outFile(node, 'Distance', cache, vor.dist);
    outFile(node, 'Color', cache, [vor.color[0], vor.color[1], vor.color[2], 1] as RGBA);
    outFile(node, 'Position', cache, vor.pos as Vec3);
    outFile(node, 'Radius', cache, vor.dist);
  });

  registerExecutor('ShaderNodeTexWave', (node, cache) => {
    const v = vInp(node, 'Vector', cache); const s = nInp(node, 'Scale', cache, 5);
    const wave = clamp01((Math.sin(v[0] * s * Math.PI * 2) * 0.5 + 0.5));
    outFile(node, 'Fac', cache, wave); outFile(node, 'Color', cache, [wave, wave, wave, 1] as RGBA);
  });

  registerExecutor('ShaderNodeTexChecker', (node, cache) => {
    const v = vInp(node, 'Vector', cache); const s = nInp(node, 'Scale', cache, 5);
    const ck = (Math.floor(v[0] * s) + Math.floor(v[1] * s) + Math.floor(v[2] * s)) % 2;
    const c1 = cInp(node, 'Color1', cache, [0.8, 0.8, 0.8, 1]);
    const c2 = cInp(node, 'Color2', cache, [0.2, 0.2, 0.2, 1]);
    outFile(node, 'Color', cache, ck === 0 ? c1 : c2);
    outFile(node, 'Fac', cache, ck === 0 ? 1 : 0);
  });

  registerExecutor('ShaderNodeTexGradient', (node, cache) => {
    const v = vInp(node, 'Vector', cache); const val = clamp01(v[0] * 0.5 + 0.5);
    outFile(node, 'Color', cache, [val, val, val, 1] as RGBA); outFile(node, 'Fac', cache, val);
  });

  registerExecutor('ShaderNodeTexWhiteNoise', (node, cache) => {
    const v = vInp(node, 'Vector', cache);
    const val = ihash3(v[0] | 0, v[1] | 0, v[2] | 0);
    outFile(node, 'Value', cache, val); outFile(node, 'Color', cache, [val, val, val, 1] as RGBA);
  });

  registerExecutor('ShaderNodeTexImage', (node, cache) => {
    const v = vInp(node, 'Vector', cache);
    const ck = (Math.floor(v[0] * 4) + Math.floor(v[1] * 4)) % 2;
    outFile(node, 'Color', cache, [ck === 0 ? 0.2 : 0.8, ck === 0 ? 0.2 : 0.8, ck === 0 ? 0.2 : 0.8, 1] as RGBA);
    outFile(node, 'Alpha', cache, 1);
  });

  registerExecutor('ShaderNodeTexEnvironment', (node, cache) => {
    const v = vInp(node, 'Vector', cache, [0, 0, 1]);
    const l = Math.hypot(v[0], v[1], v[2]) || 1; const val = clamp01((v[1] / l) * 0.5 + 0.5);
    outFile(node, 'Color', cache, [val * 0.8, val * 0.9, val, 1] as RGBA);
  });

  registerExecutor('ShaderNodeTexSky', (node, cache) => {
    const v = vInp(node, 'Vector', cache, [0, 0, 1]);
    const l = Math.hypot(v[0], v[1], v[2]) || 1; const t = clamp01((v[1] / l) * 0.5 + 0.5);
    outFile(node, 'Color', cache, [0.3 + 0.3 * t, 0.5 + 0.3 * t, 0.8 * t + 0.2, 1] as RGBA);
  });

  registerExecutor('ShaderNodeTexPointDensity', (node, cache) => {
    outFile(node, 'Color', cache, [0.5, 0.5, 0.5, 1] as RGBA); outFile(node, 'Density', cache, 0.5);
  });

  // ── Input nodes (CPU stubs) ─────────────────────────────────
  registerExecutor('ShaderNodeUVMap', (node, cache) => { outFile(node, 'UV', cache, [0.5, 0.5, 0] as Vec3); });
  registerExecutor('ShaderNodeAttribute', (node, cache) => {
    outFile(node, 'Color', cache, [1, 1, 1, 1] as RGBA); outFile(node, 'Vector', cache, [0, 0, 0] as Vec3);
    outFile(node, 'Fac', cache, 0); outFile(node, 'Alpha', cache, 1);
  });
  registerExecutor('ShaderNodeFresnel', (node, cache) => {
    const ior = nInp(node, 'IOR', cache, 1.45); const f0 = ((1 - ior) / (1 + ior)) ** 2;
    const cosTheta = Math.abs(vInp(node, 'Normal', cache, [0, 0, 1])[2]);
    outFile(node, 'Fac', cache, clamp01(f0 + (1 - f0) * Math.pow(1 - cosTheta, 5)));
  });
  registerExecutor('ShaderNodeLayerWeight', (node, cache) => {
    const blend = nInp(node, 'Blend', cache, 0.5); const ct = Math.abs(vInp(node, 'Normal', cache, [0, 0, 1])[2]);
    outFile(node, 'Fresnel', cache, clamp01(1 - ct)); outFile(node, 'Facing', cache, clamp01(ct * blend + (1 - blend)));
  });
  registerExecutor('ShaderNodeObjectInfo', (node, cache) => {
    outFile(node, 'Location', cache, [0, 0, 0] as Vec3); outFile(node, 'Color', cache, [1, 1, 1, 1] as RGBA);
    outFile(node, 'Alpha', cache, 1); outFile(node, 'Object Index', cache, 0);
    outFile(node, 'Material Index', cache, 0); outFile(node, 'Random', cache, 0.5);
  });
  registerExecutor('ShaderNodeCameraData', (node, cache) => {
    outFile(node, 'View Vector', cache, [0, 0, 1] as Vec3); outFile(node, 'View Z Depth', cache, 10); outFile(node, 'View Distance', cache, 5);
  });
  registerExecutor('ShaderNodeLightPath', (node, cache) => {
    outFile(node, 'Is Camera Ray', cache, 1); outFile(node, 'Is Shadow Ray', cache, 0);
    outFile(node, 'Is Diffuse Ray', cache, 1); outFile(node, 'Is Glossy Ray', cache, 0);
    outFile(node, 'Is Singular Ray', cache, 0); outFile(node, 'Is Reflection Ray', cache, 0);
    outFile(node, 'Is Transmission Ray', cache, 0); outFile(node, 'Ray Length', cache, 0);
    outFile(node, 'Ray Depth', cache, 0); outFile(node, 'Transparent Depth', cache, 0); outFile(node, 'Transmission Depth', cache, 0);
  });

  // ── Blackbody / Wavelength ──────────────────────────────────
  registerExecutor('ShaderNodeBlackbody', (node, cache) => {
    const t = nInp(node, 'Temperature', cache, 1500) / 1000;
    const r = clamp01(t > 6.6 ? 1 : t > 4 ? 0.5 + (t - 4) * 0.192 : t > 3 ? (t - 3) * 0.5 : 0);
    const g = clamp01(t > 6.6 ? 0.8 - (t - 6.6) * 0.1 : t > 4 ? 0.7 + (t - 4) * 0.038 : t > 3 ? (t - 3) * 0.35 : 0);
    const b = clamp01(t > 6.6 ? 0.75 + (t - 6.6) * 0.02 : t > 4 ? 0.5 + (t - 4) * 0.096 : t > 3 ? (t - 3) * 0.25 : t < 2 ? t - 1 : 0.5);
    outFile(node, 'Color', cache, [r, g, b, 1] as RGBA);
  });
  registerExecutor('ShaderNodeWavelength', (node, cache) => {
    const wl = nInp(node, 'Wavelength', cache, 500);
    let r = 0, g = 0, b = 0;
    if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; }
    else if (wl >= 440 && wl < 490) { g = (wl - 440) / 50; b = 1; }
    else if (wl >= 490 && wl < 510) { g = 1; b = -(wl - 510) / 20; }
    else if (wl >= 510 && wl < 580) { r = (wl - 510) / 70; g = 1; }
    else if (wl >= 580 && wl < 645) { r = 1; g = -(wl - 645) / 65; }
    else if (wl >= 645 && wl <= 780) { r = 1; }
    let factor = 1;
    if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / 40;
    else if (wl > 700 && wl <= 780) factor = 0.3 + 0.7 * (780 - wl) / 80;
    outFile(node, 'Color', cache, [Math.pow(r * factor, 0.8), Math.pow(g * factor, 0.8), Math.pow(b * factor, 0.8), 1] as RGBA);
  });

  // ── Colour ops ──────────────────────────────────────────────
  registerExecutor('ShaderNodeRGBToBW', (node, cache) => {
    const c = cInp(node, 'Color', cache, [0, 0, 0, 1]); outFile(node, 'Val', cache, c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
  });
  registerExecutor('ShaderNodeShaderToRGB', (node, cache) => {
    const s = dInp(node, 'Shader', cache); outFile(node, 'Color', cache, s.color); outFile(node, 'Alpha', cache, s.opacity);
  });
  registerExecutor('ShaderNodeHueSaturation', (node, cache) => {
    const hue = nInp(node, 'Hue', cache, 0.5); const sat = nInp(node, 'Saturation', cache, 1);
    const val = nInp(node, 'Value', cache, 1); const fac = nInp(node, 'Fac', cache, 1);
    const color = cInp(node, 'Color', cache);
    const [h, s, v] = rgbToHsv(color[0], color[1], color[2]);
    const [rr, gg, bb] = hsvToRgb((h + (hue - 0.5) * fac + 10) % 1, clamp01(s * (sat * fac + (1 - fac))), clamp01(v * (val * fac + (1 - fac))));
    outFile(node, 'Color', cache, [rr, gg, bb, color[3]] as RGBA);
  });
  registerExecutor('ShaderNodeBrightContrast', (node, cache) => {
    const bright = nInp(node, 'Bright', cache, 0); const contrast = nInp(node, 'Contrast', cache, 0);
    const color = cInp(node, 'Color', cache); const a = 1 + contrast; const b2 = bright - contrast * 0.5;
    outFile(node, 'Color', cache, [clamp01(a * color[0] + b2), clamp01(a * color[1] + b2), clamp01(a * color[2] + b2), color[3]] as RGBA);
  });
  registerExecutor('ShaderNodeGamma', (node, cache) => {
    const gamma = Math.max(0.001, nInp(node, 'Gamma', cache, 1)); const c = cInp(node, 'Color', cache);
    outFile(node, 'Color', cache, [Math.pow(c[0], 1 / gamma), Math.pow(c[1], 1 / gamma), Math.pow(c[2], 1 / gamma), c[3]] as RGBA);
  });
  registerExecutor('ShaderNodeInvert', (node, cache) => {
    const fac = nInp(node, 'Fac', cache, 1); const c = cInp(node, 'Color', cache);
    outFile(node, 'Color', cache, [lerp(c[0], 1 - c[0], fac), lerp(c[1], 1 - c[1], fac), lerp(c[2], 1 - c[2], fac), c[3]] as RGBA);
  });

  // ── Misc shader ─────────────────────────────────────────────
  registerExecutor('ShaderNodeNormal', (node, cache) => {
    const n = vInp(node, 'Normal', cache, [0, 0, 1]); outFile(node, 'Normal', cache, n); outFile(node, 'Dot', cache, n[2]);
  });
  registerExecutor('ShaderNodeTangent', (node, cache) => { outFile(node, 'Tangent', cache, [1, 0, 0] as Vec3); });
  registerExecutor('ShaderNodeWireframe', (node, cache) => { outFile(node, 'Fac', cache, 0); });
  registerExecutor('ShaderNodeAmbientOcclusion', (node, cache) => {
    outFile(node, 'Color', cache, cInp(node, 'Color', cache)); outFile(node, 'AO', cache, 1);
  });
  registerExecutor('ShaderNodeBevel', (node, cache) => { outFile(node, 'Normal', cache, vInp(node, 'Normal', cache, [0, 0, 1])); });
  registerExecutor('ShaderNodeVectorTransform', (node, cache) => { outFile(node, 'Vector', cache, vInp(node, 'Vector', cache)); });
  registerExecutor('ShaderNodeVertexColor', (node, cache) => {
    outFile(node, 'Color', cache, [1, 1, 1, 1] as RGBA); outFile(node, 'Alpha', cache, 1);
  });
  registerExecutor('ShaderNodeHairInfo', (node, cache) => {
    outFile(node, 'Is Strand', cache, 0); outFile(node, 'Intercept', cache, 0.5);
    outFile(node, 'Strand Normal', cache, [0, 0, 1] as Vec3); outFile(node, 'Random', cache, 0);
  });
  registerExecutor('ShaderNodeParticleInfo', (node, cache) => {
    for (const s of node.outputs) outFile(node, s.name, cache, s.kind === 'VALUE' ? 0 : s.default_value);
  });
  registerExecutor('ShaderNodePointInfo', (node, cache) => {
    for (const s of node.outputs) outFile(node, s.name, cache, s.kind === 'VALUE' ? 0 : s.default_value);
  });
  registerExecutor('ShaderNodeVolumeInfo', (node, cache) => {
    outFile(node, 'Color', cache, 0); outFile(node, 'Density', cache, 0); outFile(node, 'Temperature', cache, 0);
  });
  registerExecutor('ShaderNodeNewGeometry', (node, cache) => {
    const z: Vec3 = [0, 0, 0]; for (const s of node.outputs) outFile(node, s.name, cache, z);
  });
  registerExecutor('ShaderNodeAttributeColor', (node, cache) => {
    outFile(node, 'Color', cache, [1, 1, 1, 1] as RGBA); outFile(node, 'Vector', cache, [1, 1, 1] as Vec3);
    outFile(node, 'Fac', cache, 1); outFile(node, 'Alpha', cache, 1);
  });
  registerExecutor('FunctionNodeFloatToInt', (node, cache) => {
    const v = nInp(node, 'Float', cache, 0); const mode = (node as unknown as { rounding_mode?: string }).rounding_mode ?? 'ROUND';
    outFile(node, 'Integer', cache, mode === 'FLOOR' ? Math.floor(v) : mode === 'CEIL' ? Math.ceil(v) : mode === 'TRUNC' ? Math.trunc(v) : Math.round(v));
  });
  registerExecutor('FunctionNodeAlignEulerToVector', (node, cache) => {
    const e = vInp(node, 'Rotation', cache); const vec = vInp(node, 'Vector', cache, [0, 0, 1]);
    const l = Math.hypot(vec[0], vec[1], vec[2]) || 1;
    outFile(node, 'Rotation', cache, [e[0] + Math.asin(clamp(-vec[0] / l, -1, 1)), e[1], e[2] + Math.atan2(vec[1] / l, vec[2] / l)] as Vec3);
  });
  registerExecutor('FunctionNodeRotateEuler', (node, cache) => {
    const e = vInp(node, 'Rotation', cache); const ax = vInp(node, 'Axis', cache, [0, 0, 1]);
    const a = nInp(node, 'Angle', cache, 0); const l = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const ux = ax[0] / l, uy = ax[1] / l, uz = ax[2] / l;
    const c = Math.cos(a), s = Math.sin(a), ci = 1 - c;
    outFile(node, 'Rotation', cache, [
      e[0] * (c + ux * ux * ci) + e[1] * (ux * uy * ci - uz * s) + e[2] * (ux * uz * ci + uy * s),
      e[0] * (uy * ux * ci + uz * s) + e[1] * (c + uy * uy * ci) + e[2] * (uy * uz * ci - ux * s),
      e[0] * (uz * ux * ci - uy * s) + e[1] * (uz * uy * ci + ux * s) + e[2] * (c + uz * uz * ci),
    ] as Vec3);
  });
  registerExecutor('ShaderNodeScript', (node, cache) => { outFile(node, 'Color', cache, cInp(node, 'Color', cache, [0, 0, 0, 1])); });
}
