/**
 * ShaderEvaluator — walks a ShaderNodeTree backwards from Material Output
 * and produces a `THREE.MeshStandardMaterial`-shaped descriptor.
 *
 * In M0 we emit a **plain descriptor** (POJO) rather than direct TSL nodes,
 * so the demo can build a regular MeshStandardMaterial without requiring
 * three/webgpu. The Viewport then maps the descriptor → material.
 *
 * Upgrade path: replace `emit()` returns with TSL nodes (color()/uv()/etc.)
 * and assign them to MeshStandardNodeMaterial slot props. The graph traversal
 * code stays the same.
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';
import type { SystemEvaluator, EvaluationResult } from './Depsgraph';
import type { RGBA, Vec3 } from '../core/types';
// Reusable helper for Add Shader.
function addDesc(a: MaterialDescriptorMaybe, b: MaterialDescriptorMaybe): MaterialDescriptorMaybe {
  return {
    color: [
      Math.min(1, a.color[0] + b.color[0]),
      Math.min(1, a.color[1] + b.color[1]),
      Math.min(1, a.color[2] + b.color[2]),
      Math.max(a.color[3], b.color[3]),
    ],
    metalness: Math.max(a.metalness, b.metalness),
    roughness: (a.roughness + b.roughness) / 2,
    emissive: [a.emissive[0] + b.emissive[0], a.emissive[1] + b.emissive[1], a.emissive[2] + b.emissive[2]],
    emissive_strength: a.emissive_strength + b.emissive_strength,
    opacity: Math.max(a.opacity, b.opacity),
  };
}
type MaterialDescriptorMaybe = {
  color: RGBA; metalness: number; roughness: number; emissive: Vec3;
  emissive_strength: number; opacity: number;
};
import {
  ShaderNodeOutputMaterial,
  ShaderNodeOutputWorld,
  ShaderNodeOutputLight,
  ShaderNodeBsdfPrincipled,
  ShaderNodeEmission,
  ShaderNodeTexNoise,
  ShaderNodeMixShader,
} from '../nodes/shader/Shaders';
import {
  ShaderNodeBsdfDiffuse, ShaderNodeBsdfGlossy, ShaderNodeBsdfRefraction, ShaderNodeBsdfGlass,
  ShaderNodeBsdfTransparent, ShaderNodeBsdfTranslucent, ShaderNodeBsdfSheen, ShaderNodeBsdfToon,
  ShaderNodeSubsurfaceScattering, ShaderNodeBackground, ShaderNodeHoldout, ShaderNodeAddShader,
  ShaderNodeVolumeAbsorption, ShaderNodeVolumeScatter,
} from '../nodes/shader/BSDFs';
import { ValueNode, RGBNode, VectorNode } from '../nodes/common/Value';
import { MathNode } from '../nodes/common/Math';
import { VectorMathNode } from '../nodes/common/VectorMath';
import { MixNode } from '../nodes/common/MixColor';
import { MapRangeNode } from '../nodes/common/MapRange';
import { ClampNode } from '../nodes/common/Clamp';
import { ColorRampNode } from '../nodes/common/ColorRamp';
import {
  ShaderNodeFloatCurve, ShaderNodeVectorCurve, ShaderNodeRGBCurve,
  type CurveMappingCurve,
} from '../nodes/common/Curves';
import {
  CombineXYZNode, SeparateXYZNode, CombineColorNode, SeparateColorNode,
} from '../nodes/common/CombineSeparate';
import { BooleanMathNode, CompareNode, RandomValueNode, SwitchNode } from '../nodes/common/Logic';
import { RerouteNode, NodeGroupInput, NodeGroupOutput } from '../nodes/common';
import { NodeGroupBase } from '../nodes/common/Group';
import {
  ShaderNodeTexImage, ShaderNodeTexEnvironment, ShaderNodeTexVoronoi,
  ShaderNodeTexWave, ShaderNodeTexChecker, ShaderNodeTexBrick,
  ShaderNodeTexGradient, ShaderNodeTexMagic, ShaderNodeTexWhiteNoise,
} from '../nodes/shader/Textures';
import {
  ShaderNodeUVMap, ShaderNodeAttribute, ShaderNodeFresnel, ShaderNodeLayerWeight,
  ShaderNodeObjectInfo, ShaderNodeCameraData, ShaderNodeLightPath,
} from '../nodes/shader/Inputs';

export interface MaterialDescriptor {
  color: RGBA;
  metalness: number;
  roughness: number;
  emissive: Vec3;
  emissive_strength: number;
  opacity: number;
  // Procedural noise factor mixed into base color, for the demo
  noise_scale?: number;
}

const DEFAULT: MaterialDescriptor = {
  color: [0.8, 0.8, 0.8, 1],
  metalness: 0,
  roughness: 0.5,
  emissive: [0, 0, 0],
  emissive_strength: 0,
  opacity: 1,
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth01 = (t: number): number => t * t * (3 - 2 * t);
const fract = (x: number): number => x - Math.floor(x);
// Integer hash (Wang/PCG-style) — deterministic uniform in [0,1).
function ihash3(x: number, y: number, z: number): number {
  let h = (x | 0) * 0x27d4eb2d ^ (y | 0) * 0x165667b1 ^ (z | 0) * 0x9e3779b1;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h >>> 0) / 0x100000000;
}
function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth01(x - xi), yf = smooth01(y - yi), zf = smooth01(z - zi);
  const n = (i: number, j: number, k: number): number => ihash3(xi + i, yi + j, zi + k);
  const c000 = n(0, 0, 0), c100 = n(1, 0, 0), c010 = n(0, 1, 0), c110 = n(1, 1, 0);
  const c001 = n(0, 0, 1), c101 = n(1, 0, 1), c011 = n(0, 1, 1), c111 = n(1, 1, 1);
  const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf);
  const x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}
function fbm3(x: number, y: number, z: number, detail: number, roughness: number): number {
  const octaves = Math.min(8, Math.max(1, Math.round(detail) + 1));
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3(x * freq, y * freq, z * freq) * amp;
    norm += amp; amp *= roughness; freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}
function voronoiSampleF1(x: number, y: number, z: number, randomness: number): { dist: number; color: Vec3; pos: Vec3 } {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  let best = Infinity;
  let bcol: Vec3 = [0, 0, 0];
  let bpos: Vec3 = [0, 0, 0];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx, iy = cy + dy, iz = cz + dz;
        const jx = ix + (ihash3(ix, iy, iz) - 0.5) * randomness + 0.5;
        const jy = iy + (ihash3(iy, iz, ix) - 0.5) * randomness + 0.5;
        const jz = iz + (ihash3(iz, ix, iy) - 0.5) * randomness + 0.5;
        const ddx = jx - x, ddy = jy - y, ddz = jz - z;
        const d = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < best) {
          best = d; bpos = [jx, jy, jz];
          bcol = [ihash3(ix, iy, iz), ihash3(iy, iz, ix), ihash3(iz, ix, iy)];
        }
      }
    }
  }
  return { dist: Math.sqrt(best), color: bcol, pos: bpos };
}
function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
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
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1 / 3),
  ];
}

export class ShaderEvaluator implements SystemEvaluator {
  /**
   * Persistent output from the last complete evaluation.
   * If the dirty set is empty AND tree hasn't changed, return this directly.
   */
  private _lastOutput: MaterialDescriptor | null = null;
  private _lastTreeId: string | null = null;

  /** Wipe cached output (called by Depsgraph on topology changes). */
  clearPersistentCache(): void {
    this._lastOutput = null;
    this._lastTreeId = null;
  }

  evaluate(tree: NodeTree, dirty: ReadonlySet<Node>): EvaluationResult {
    const start = performance.now();

    // Fast path: nothing changed AND same tree — return the previous result.
    if (this._lastOutput !== null && dirty.size === 0 && this._lastTreeId === tree.id) {
      return {
        output: this._lastOutput,
        duration_ms: 0,
        node_timings: new Map(),
        errors: new Map(),
      };
    }
    this._lastTreeId = tree.id;

    const cache = new Map<string, unknown>();
    const timings = new Map<string, number>();
    const errors = new Map<string, string>();

    const order = tree.topoOrder();
    for (const node of order) {
      const t0 = performance.now();
      try {
        if (node.mute) this.passthroughMuted(node, cache);
        else this.executeNode(node, cache);
      } catch (e) {
        errors.set(node.id, (e as Error).message);
      }
      timings.set(node.id, performance.now() - t0);
    }

    const output = (order.find((n) => n instanceof ShaderNodeOutputMaterial)
      ?? order.find((n) => n instanceof ShaderNodeOutputWorld)
      ?? order.find((n) => n instanceof ShaderNodeOutputLight)) as ShaderNodeOutputMaterial | undefined;
    let desc: MaterialDescriptor = { ...DEFAULT };
    if (output) {
      const surface = output.inputs[0]!;
      const closure = this.socketValue(surface, cache) as MaterialDescriptor | undefined;
      if (closure) desc = closure;
    }

    this._lastOutput = desc;
    return {
      output: desc,
      duration_ms: performance.now() - start,
      node_timings: timings,
      errors,
    };
  }

  private socketValue(socket: NodeSocket, cache: Map<string, unknown>): unknown {
    if (socket.is_output) return cache.get(socket.id);
    if (socket.is_linked) {
      const link = socket.links[0];
      if (link && link.is_valid && !link.is_muted) {
        const upstream = cache.get(link.from_socket.id);
        if (upstream !== undefined) {
          link.from_socket.value = upstream;
          if (socket.kind === 'SHADER') return upstream;
          return socket.coerceFrom(link.from_socket);
        }
      }
    }
    return socket.default_value;
  }

  private passthroughMuted(node: Node, cache: Map<string, unknown>): void {
    const links = node.computeInternalLinks();
    for (const out of node.outputs) {
      const inSock = links.get(out.id);
      cache.set(out.id, inSock ? this.socketValue(inSock, cache) : out.default_value);
    }
  }

  private executeGroup(node: NodeGroupBase, cache: Map<string, unknown>, depth: number): void {
    const child = node.resolvedTree;
    if (!child || depth > 64) {
      for (const out of node.outputs) cache.set(out.id, out.default_value);
      return;
    }
    const giInput = child.nodes.find((n) => n instanceof NodeGroupInput) as NodeGroupInput | undefined;
    const giOutput = child.nodes.find((n) => n instanceof NodeGroupOutput) as NodeGroupOutput | undefined;
    if (giInput) {
      for (const o of giInput.outputs) {
        const containerIn = node.inputs.find((sk) => sk.identifier === o.identifier);
        cache.set(o.id, containerIn ? this.socketValue(containerIn, cache) : o.default_value);
      }
    }
    for (const inner of child.topoOrder()) {
      if (inner === giInput) continue;
      try {
        if (inner.mute) this.passthroughMuted(inner, cache);
        else if (inner instanceof NodeGroupBase) this.executeGroup(inner, cache, depth + 1);
        else this.executeNode(inner, cache);
      } catch { /* keep flowing */ }
    }
    for (const out of node.outputs) {
      let v: unknown;
      if (giOutput) {
        const innerIn = giOutput.inputs.find((sk) => sk.identifier === out.identifier);
        v = innerIn ? this.socketValue(innerIn, cache) : undefined;
      }
      cache.set(out.id, v !== undefined ? v : out.default_value);
    }
  }

  private executeNode(node: Node, cache: Map<string, unknown>): void {
    if (node instanceof ValueNode) {
      cache.set(node.outputs[0]!.id, node.value);
      return;
    }
    if (node instanceof RGBNode) {
      cache.set(node.outputs[0]!.id, [...node.rgb]);
      return;
    }
    if (node instanceof VectorNode) {
      cache.set(node.outputs[0]!.id, [...node.vector]);
      return;
    }
    if (node instanceof RerouteNode) {
      cache.set(node.outputs[0]!.id, this.socketValue(node.inputs[0]!, cache));
      return;
    }
    if (node instanceof NodeGroupInput) { return; }
    if (node instanceof NodeGroupOutput) { return; }
    if (node instanceof NodeGroupBase) { this.executeGroup(node, cache, 0); return; }
    if (node instanceof MathNode) {
      const a = this.socketValue(node.inputs[0]!, cache) as number;
      const b = this.socketValue(node.inputs[1]!, cache) as number;
      const c = this.socketValue(node.inputs[2]!, cache) as number;
      cache.set(node.outputs[0]!.id, MathNode.compute(node.operation, a, b, c, node.use_clamp));
      return;
    }
    if (node instanceof VectorMathNode) {
      const a = this.socketValue(node.inputs[0]!, cache) as Vec3;
      const b = this.socketValue(node.inputs[1]!, cache) as Vec3;
      const c = this.socketValue(node.inputs[2]!, cache) as Vec3;
      const s = this.socketValue(node.inputs[3]!, cache) as number;
      const { vec, val } = VectorMathNode.compute(node.operation, a, b, c, s);
      cache.set(node.outputs[0]!.id, vec);
      cache.set(node.outputs[1]!.id, val);
      return;
    }
    if (node instanceof MixNode) {
      const f = this.socketValue(node.inputs[0]!, cache) as number;
      if (node.data_type === 'FLOAT') {
        const a = this.socketValue(node.inputs[1]!, cache) as number;
        const b = this.socketValue(node.inputs[2]!, cache) as number;
        cache.set(node.outputs[0]!.id, MixNode.mixFloat(a, b, f));
      } else if (node.data_type === 'VECTOR') {
        const a = this.socketValue(node.inputs[3]!, cache) as Vec3;
        const b = this.socketValue(node.inputs[4]!, cache) as Vec3;
        cache.set(node.outputs[1]!.id, MixNode.mixVec(a, b, f));
      } else {
        const a = this.socketValue(node.inputs[5]!, cache) as RGBA;
        const b = this.socketValue(node.inputs[6]!, cache) as RGBA;
        cache.set(node.outputs[2]!.id, MixNode.mixColor(a, b, f, node.blend_type));
      }
      return;
    }
    if (node instanceof MapRangeNode) {
      const v = this.socketValue(node.inputs[0]!, cache) as number;
      const fmn = this.socketValue(node.inputs[1]!, cache) as number;
      const fmx = this.socketValue(node.inputs[2]!, cache) as number;
      const tmn = this.socketValue(node.inputs[3]!, cache) as number;
      const tmx = this.socketValue(node.inputs[4]!, cache) as number;
      const steps = this.socketValue(node.inputs[5]!, cache) as number;
      cache.set(node.outputs[0]!.id, MapRangeNode.computeFloat(v, fmn, fmx, tmn, tmx, steps, node.interpolation_type, node.clamp));
      return;
    }
    if (node instanceof ClampNode) {
      const v = this.socketValue(node.inputs[0]!, cache) as number;
      const mn = this.socketValue(node.inputs[1]!, cache) as number;
      const mx = this.socketValue(node.inputs[2]!, cache) as number;
      cache.set(node.outputs[0]!.id, ClampNode.compute(v, mn, mx, node.clamp_type));
      return;
    }
    if (node instanceof ColorRampNode) {
      const t = this.socketValue(node.inputs[0]!, cache) as number;
      const c = ColorRampNode.sample(node.stops, node.interpolation, t);
      cache.set(node.outputs[0]!.id, c);
      cache.set(node.outputs[1]!.id, c[3]);
      return;
    }
    if (node instanceof CombineXYZNode) {
      const x = this.socketValue(node.inputs[0]!, cache) as number;
      const y = this.socketValue(node.inputs[1]!, cache) as number;
      const z = this.socketValue(node.inputs[2]!, cache) as number;
      cache.set(node.outputs[0]!.id, [x, y, z] as Vec3);
      return;
    }
    if (node instanceof SeparateXYZNode) {
      const v = this.socketValue(node.inputs[0]!, cache) as Vec3;
      cache.set(node.outputs[0]!.id, v[0]);
      cache.set(node.outputs[1]!.id, v[1]);
      cache.set(node.outputs[2]!.id, v[2]);
      return;
    }
    if (node instanceof CombineColorNode) {
      const a = this.socketValue(node.inputs[0]!, cache) as number;
      const b = this.socketValue(node.inputs[1]!, cache) as number;
      const c = this.socketValue(node.inputs[2]!, cache) as number;
      let out: RGBA;
      switch (node.mode) {
        case 'HSV': {
          const [r, g, bb] = hsv2rgb(clamp01(a), clamp01(b), clamp01(c));
          out = [r, g, bb, 1];
          break;
        }
        case 'HSL': {
          const [r, g, bb] = hsl2rgb(clamp01(a), clamp01(b), clamp01(c));
          out = [r, g, bb, 1];
          break;
        }
        default:
          out = [a, b, c, 1];
      }
      cache.set(node.outputs[0]!.id, out);
      return;
    }
    if (node instanceof SeparateColorNode) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      let a = c[0], b = c[1], d = c[2];
      if (node.mode === 'HSV') [a, b, d] = rgb2hsv(c[0], c[1], c[2]);
      else if (node.mode === 'HSL') [a, b, d] = rgb2hsl(c[0], c[1], c[2]);
      cache.set(node.outputs[0]!.id, a);
      cache.set(node.outputs[1]!.id, b);
      cache.set(node.outputs[2]!.id, d);
      return;
    }
    if (node instanceof BooleanMathNode) {
      const a = !!(this.socketValue(node.inputs[0]!, cache) as boolean);
      const b = !!(this.socketValue(node.inputs[1]!, cache) as boolean);
      cache.set(node.outputs[0]!.id, BooleanMathNode.compute(node.operation, a, b));
      return;
    }
    if (node instanceof CompareNode) {
      const sa = node.inputs.find((s) => s.name === 'A');
      const sb = node.inputs.find((s) => s.name === 'B');
      const se = node.inputs.find((s) => s.name === 'Epsilon');
      const eps = se ? (this.socketValue(se, cache) as number) : 0;
      let r = false;
      if (node.data_type === 'VECTOR') {
        const a = (sa ? this.socketValue(sa, cache) : [0, 0, 0]) as Vec3;
        const b = (sb ? this.socketValue(sb, cache) : [0, 0, 0]) as Vec3;
        r = CompareNode.computeVec(node.operation, a, b, eps);
      } else if (node.data_type === 'RGBA') {
        const a = (sa ? this.socketValue(sa, cache) : [0, 0, 0, 1]) as RGBA;
        const b = (sb ? this.socketValue(sb, cache) : [0, 0, 0, 1]) as RGBA;
        r = CompareNode.computeColor(node.operation, a, b, eps);
      } else {
        const a = (sa ? this.socketValue(sa, cache) : 0) as number;
        const b = (sb ? this.socketValue(sb, cache) : 0) as number;
        r = CompareNode.compute(node.operation, a, b, eps);
      }
      cache.set(node.outputs[0]!.id, r);
      return;
    }
    if (node instanceof SwitchNode) {
      const cond = !!(this.socketValue(node.inputs[0]!, cache) as boolean);
      const falseSock = node.inputs.find((s) => s.name === 'False');
      const trueSock = node.inputs.find((s) => s.name === 'True');
      const v = cond
        ? (trueSock ? this.socketValue(trueSock, cache) : undefined)
        : (falseSock ? this.socketValue(falseSock, cache) : undefined);
      cache.set(node.outputs[0]!.id, v);
      return;
    }
    if (node instanceof RandomValueNode) {
      const id = (this.socketValue(node.inputs[7]!, cache) as number) | 0;
      const seed = (this.socketValue(node.inputs[8]!, cache) as number) | 0;
      const r0 = RandomValueNode.hash(id, seed);
      const r1 = RandomValueNode.hash(id + 101, seed + 17);
      const r2 = RandomValueNode.hash(id + 211, seed + 37);
      const minV = this.socketValue(node.inputs[0]!, cache) as Vec3;
      const maxV = this.socketValue(node.inputs[1]!, cache) as Vec3;
      const minF = this.socketValue(node.inputs[2]!, cache) as number;
      const maxF = this.socketValue(node.inputs[3]!, cache) as number;
      const minI = this.socketValue(node.inputs[4]!, cache) as number;
      const maxI = this.socketValue(node.inputs[5]!, cache) as number;
      const prob = this.socketValue(node.inputs[6]!, cache) as number;
      cache.set(node.outputs[0]!.id, [
        lerp(minV[0], maxV[0], r0),
        lerp(minV[1], maxV[1], r1),
        lerp(minV[2], maxV[2], r2),
      ] as Vec3);
      cache.set(node.outputs[1]!.id, lerp(minF, maxF, r0));
      cache.set(node.outputs[2]!.id, Math.floor(lerp(minI, maxI + 1, r0)));
      cache.set(node.outputs[3]!.id, r0 <= prob);
      return;
    }
    if (node instanceof ShaderNodeTexNoise) {
      // Real procedural value-noise fBm at the supplied vector. Inputs:
      //   [0] Vector  [1] Scale  [2] Detail  [3] Roughness  [4] Distortion (unused here)
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const scale = (this.socketValue(node.inputs[1]!, cache) as number) ?? 5;
      const detail = (this.socketValue(node.inputs[2]!, cache) as number) ?? 2;
      const rough = (this.socketValue(node.inputs[3]!, cache) as number) ?? 0.5;
      const x = v[0] * scale, y = v[1] * scale, z = v[2] * scale;
      const f = fbm3(x, y, z, detail, rough);
      const fx = fbm3(x + 17.3, y, z, detail, rough);
      const fy = fbm3(x, y + 23.7, z, detail, rough);
      cache.set(node.outputs[0]!.id, f);
      cache.set(node.outputs[1]!.id, [fx, fy, f, 1] as RGBA);
      (cache as Map<string, unknown>).set(`__noise_scale_${node.id}`, scale);
      return;
    }
    if (node instanceof ShaderNodeBsdfPrincipled) {
      // Resolve by socket name so the full Blender 4.x input set maps correctly.
      const sv = <T>(name: string, fallback: T): T => {
        const s = node.inputs.find((x) => x.name === name || x.identifier === name);
        return s ? (this.socketValue(s, cache) as T) : fallback;
      };
      const baseColor = sv<RGBA>('Base Color', [0.8, 0.8, 0.8, 1]);
      const metallic = sv<number>('Metallic', 0);
      const roughness = sv<number>('Roughness', 0.5);
      const alpha = sv<number>('Alpha', 1);
      const emissiveColor = sv<RGBA>('Emission Color', [0, 0, 0, 1]);
      const emissiveStrength = sv<number>('Emission Strength', 0);
      const desc: MaterialDescriptor = {
        color: baseColor,
        metalness: metallic,
        roughness,
        emissive: [emissiveColor[0], emissiveColor[1], emissiveColor[2]],
        emissive_strength: emissiveStrength,
        opacity: alpha,
      };
      cache.set(node.outputs[0]!.id, desc);
      return;
    }
    if (node instanceof ShaderNodeEmission) {
      const color = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const strength = this.socketValue(node.inputs[1]!, cache) as number;
      const desc: MaterialDescriptor = {
        ...DEFAULT,
        color: [0, 0, 0, 1],
        emissive: [color[0], color[1], color[2]],
        emissive_strength: strength,
      };
      cache.set(node.outputs[0]!.id, desc);
      return;
    }
    if (node instanceof ShaderNodeBsdfDiffuse) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: 0.8 });
      return;
    }
    if (node instanceof ShaderNodeBsdfGlossy) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const r = this.socketValue(node.inputs[1]!, cache) as number;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 1, roughness: r });
      return;
    }
    if (node instanceof ShaderNodeBsdfRefraction) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const r = this.socketValue(node.inputs[1]!, cache) as number;
      // Standard material has no true refraction slot; approximate with a
      // transparent, low-metalness dielectric descriptor.
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: r, opacity: 0.35 });
      return;
    }
    if (node instanceof ShaderNodeBsdfGlass) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const r = this.socketValue(node.inputs[1]!, cache) as number;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: r, opacity: 0.5 });
      return;
    }
    if (node instanceof ShaderNodeBsdfTransparent) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, opacity: 0 });
      return;
    }
    if (node instanceof ShaderNodeBsdfTranslucent) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, roughness: 1, opacity: 0.6 });
      return;
    }
    if (node instanceof ShaderNodeBsdfSheen) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const r = this.socketValue(node.inputs[1]!, cache) as number;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: Math.max(r, 0.7) });
      return;
    }
    if (node instanceof ShaderNodeBsdfToon) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const smooth = this.socketValue(node.inputs[2]!, cache) as number;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: 1 - Math.min(1, Math.max(0, smooth)) * 0.5 });
      return;
    }
    if (node instanceof ShaderNodeSubsurfaceScattering) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const r = this.socketValue(node.inputs[4]!, cache) as number;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: Math.max(r, 0.8), opacity: 0.9 });
      return;
    }
    if (node instanceof ShaderNodeBackground) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const s = this.socketValue(node.inputs[1]!, cache) as number;
      cache.set(node.outputs[0]!.id, {
        ...DEFAULT, color: [0, 0, 0, 1], emissive: [c[0], c[1], c[2]], emissive_strength: s,
      });
      return;
    }
    if (node instanceof ShaderNodeHoldout) {
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: [0, 0, 0, 1], opacity: 0 });
      return;
    }
    if (node instanceof ShaderNodeVolumeAbsorption || node instanceof ShaderNodeVolumeScatter) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const density = this.socketValue(node.inputs[1]!, cache) as number;
      cache.set(node.outputs[0]!.id, {
        ...DEFAULT,
        color: [0, 0, 0, 1],
        emissive: [c[0], c[1], c[2]],
        emissive_strength: Math.max(0, density) * 0.15,
        opacity: Math.max(0, Math.min(1, 1 - density * 0.1)),
      });
      return;
    }
    if (node instanceof ShaderNodeAddShader) {
      const a = this.socketValue(node.inputs[0]!, cache) as MaterialDescriptor | undefined;
      const b = this.socketValue(node.inputs[1]!, cache) as MaterialDescriptor | undefined;
      cache.set(node.outputs[0]!.id, addDesc(a ?? DEFAULT, b ?? DEFAULT));
      return;
    }
    if (node instanceof ShaderNodeMixShader) {
      const fac = this.socketValue(node.inputs[0]!, cache) as number;
      const a = this.socketValue(node.inputs[1]!, cache) as MaterialDescriptor | undefined;
      const b = this.socketValue(node.inputs[2]!, cache) as MaterialDescriptor | undefined;
      cache.set(node.outputs[0]!.id, mixDesc(a ?? DEFAULT, b ?? DEFAULT, fac));
      return;
    }
    if (node instanceof ShaderNodeOutputMaterial || node instanceof ShaderNodeOutputWorld || node instanceof ShaderNodeOutputLight) {
      return;
    }
    // ----------------------------------------------------------------
    //  Texture nodes — procedural samplers (CPU approximations)
    // ----------------------------------------------------------------
    if (node instanceof ShaderNodeTexVoronoi) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const scale = (this.socketValue(node.inputs[1]!, cache) as number) ?? 5;
      const rnd = (this.socketValue(node.inputs[4]!, cache) as number) ?? 1;
      const s = voronoiSampleF1(v[0] * scale, v[1] * scale, v[2] * scale, Math.max(0, Math.min(1, rnd)));
      cache.set(node.outputs[0]!.id, s.dist);
      cache.set(node.outputs[1]!.id, s.dist);
      cache.set(node.outputs[2]!.id, [s.color[0], s.color[1], s.color[2], 1] as RGBA);
      return;
    }
    if (node instanceof ShaderNodeTexWave) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const scale = (this.socketValue(node.inputs[1]!, cache) as number) ?? 5;
      const dist = (this.socketValue(node.inputs[2]!, cache) as number) ?? 0;
      const det = (this.socketValue(node.inputs[3]!, cache) as number) ?? 2;
      const rough = (this.socketValue(node.inputs[4]!, cache) as number) ?? 0.5;
      const phase = (v[0] + v[1] + v[2]) * scale + dist * fbm3(v[0] * scale, v[1] * scale, v[2] * scale, det, rough);
      const w = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
      cache.set(node.outputs[0]!.id, [w, w, w, 1] as RGBA);
      cache.set(node.outputs[1]!.id, w);
      return;
    }
    if (node instanceof ShaderNodeTexChecker) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const c1 = (this.socketValue(node.inputs[1]!, cache) as RGBA) ?? [1, 1, 1, 1];
      const c2 = (this.socketValue(node.inputs[2]!, cache) as RGBA) ?? [0.2, 0.2, 0.2, 1];
      const scale = (this.socketValue(node.inputs[3]!, cache) as number) ?? 5;
      const sx = Math.floor(v[0] * scale), sy = Math.floor(v[1] * scale), sz = Math.floor(v[2] * scale);
      const which = ((sx + sy + sz) & 1) === 0;
      cache.set(node.outputs[0]!.id, (which ? c1 : c2));
      cache.set(node.outputs[1]!.id, which ? 1 : 0);
      return;
    }
    if (node instanceof ShaderNodeTexBrick) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const c1 = (this.socketValue(node.inputs[1]!, cache) as RGBA) ?? [0.6, 0.3, 0.2, 1];
      const c2 = (this.socketValue(node.inputs[2]!, cache) as RGBA) ?? [0.5, 0.25, 0.15, 1];
      const mortar = (this.socketValue(node.inputs[3]!, cache) as RGBA) ?? [0.1, 0.1, 0.1, 1];
      const scale = (this.socketValue(node.inputs[4]!, cache) as number) ?? 5;
      const mortarSize = (this.socketValue(node.inputs[5]!, cache) as number) ?? 0.02;
      // Half-offset every other row.
      const row = Math.floor(v[1] * scale);
      const offset = (row & 1) ? 0.5 : 0;
      const u = fract(v[0] * scale + offset);
      const vt = fract(v[1] * scale);
      const inMortar = u < mortarSize || u > 1 - mortarSize || vt < mortarSize || vt > 1 - mortarSize;
      const tint = (ihash3(Math.floor(v[0] * scale + offset), row, 0) > 0.5) ? c1 : c2;
      cache.set(node.outputs[0]!.id, inMortar ? mortar : tint);
      cache.set(node.outputs[1]!.id, inMortar ? 0 : 1);
      return;
    }
    if (node instanceof ShaderNodeTexGradient) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const mode = (node as unknown as { gradient_type?: string }).gradient_type ?? 'LINEAR';
      let t = 0;
      switch (mode) {
        case 'QUADRATIC': t = v[0] * v[0]; break;
        case 'EASING':    t = smooth01(clamp01(v[0])); break;
        case 'DIAGONAL':  t = (v[0] + v[1]) * 0.5; break;
        case 'SPHERICAL': t = Math.max(0, 1 - Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])); break;
        case 'QUADRATIC_SPHERE': { const r = Math.max(0, 1 - Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])); t = r * r; break; }
        case 'RADIAL': t = Math.atan2(v[1], v[0]) / (2 * Math.PI) + 0.5; break;
        case 'LINEAR':
        default: t = v[0];
      }
      t = clamp01(t);
      cache.set(node.outputs[0]!.id, [t, t, t, 1] as RGBA);
      cache.set(node.outputs[1]!.id, t);
      return;
    }
    if (node instanceof ShaderNodeTexMagic) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const scale = (this.socketValue(node.inputs[1]!, cache) as number) ?? 5;
      const dist = (this.socketValue(node.inputs[2]!, cache) as number) ?? 1;
      let x = v[0] * scale, y = v[1] * scale, z = v[2] * scale;
      for (let i = 0; i < 5; i++) {
        const sx = Math.sin(x + dist * Math.cos(y));
        const sy = Math.sin(y + dist * Math.cos(z));
        const sz = Math.sin(z + dist * Math.cos(x));
        x = sx; y = sy; z = sz;
      }
      const rgb: RGBA = [0.5 + 0.5 * x, 0.5 + 0.5 * y, 0.5 + 0.5 * z, 1];
      cache.set(node.outputs[0]!.id, rgb);
      cache.set(node.outputs[1]!.id, (rgb[0] + rgb[1] + rgb[2]) / 3);
      return;
    }
    if (node instanceof ShaderNodeTexWhiteNoise) {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 0];
      const w = (this.socketValue(node.inputs[1]!, cache) as number) ?? 0;
      const f = ihash3(Math.floor(v[0] * 1024), Math.floor(v[1] * 1024 + w * 17), Math.floor(v[2] * 1024));
      cache.set(node.outputs[0]!.id, f);
      cache.set(node.outputs[1]!.id, [
        ihash3(Math.floor(v[0] * 1024 + 11), Math.floor(v[1] * 1024 + w * 17), Math.floor(v[2] * 1024)),
        ihash3(Math.floor(v[0] * 1024), Math.floor(v[1] * 1024 + w * 17 + 7), Math.floor(v[2] * 1024)),
        ihash3(Math.floor(v[0] * 1024), Math.floor(v[1] * 1024 + w * 17), Math.floor(v[2] * 1024 + 13)),
        1,
      ] as RGBA);
      return;
    }
    if (node instanceof ShaderNodeTexImage) {
      /* LEGACY PATH PLACEHOLDER: image node without resolver returns white */
      cache.set(node.outputs[0]!.id, [1, 1, 1, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 1);
      return;
    }
    if (node instanceof ShaderNodeTexEnvironment) {
      /* LEGACY PATH PLACEHOLDER */
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      return;
    }
    // ----------------------------------------------------------------
    //  Input nodes — geometry/scene data (CPU stubs)
    // ----------------------------------------------------------------
    if (node instanceof ShaderNodeUVMap) {
      cache.set(node.outputs[0]!.id, [0, 0, 0] as Vec3);
      return;
    }
    if (node instanceof ShaderNodeAttribute) {
      /* LEGACY PATH PLACEHOLDER: return default color/value for unknown attributes */
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      cache.set(node.outputs[1]!.id, [0.5, 0.5, 0.5] as Vec3);
      cache.set(node.outputs[2]!.id, 0.5);
      cache.set(node.outputs[3]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeFresnel) {
      /* LEGACY PATH PLACEHOLDER: mid-factor */
      cache.set(node.outputs[0]!.id, 0.05);
      return;
    }
    if (node instanceof ShaderNodeLayerWeight) {
      /* LEGACY PATH PLACEHOLDER */
      cache.set(node.outputs[0]!.id, 0.5);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeObjectInfo) {
      /* LEGACY PATH PLACEHOLDER: zeros */
      cache.set(node.outputs[0]!.id, [0, 0, 0] as Vec3);
      cache.set(node.outputs[1]!.id, [0, 0, 0] as Vec3);
      cache.set(node.outputs[2]!.id, [0.8, 0.8, 0.8, 1] as RGBA);
      cache.set(node.outputs[3]!.id, 0);
      cache.set(node.outputs[4]!.id, 0);
      cache.set(node.outputs[5]!.id, 0);
      return;
    }
    if (node instanceof ShaderNodeCameraData) {
      /* LEGACY PATH PLACEHOLDER */
      cache.set(node.outputs[0]!.id, [0, 0, 1] as Vec3);
      cache.set(node.outputs[1]!.id, 1);
      cache.set(node.outputs[2]!.id, 45);
      return;
    }
    if (node instanceof ShaderNodeLightPath) {
      /* LEGACY PATH PLACEHOLDER: camera ray context */
      const defaults = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < node.outputs.length; i++) {
        cache.set(node.outputs[i]!.id, defaults[i] ?? 0);
      }
      return;
    }
    if (node.bl_idname === 'ShaderNodeHueSaturation') {
      // Real Hue/Saturation/Value transformation. Inputs: [0]=Hue [1]=Sat
      // [2]=Value [3]=Fac [4]=Color.
      const h  = (this.socketValue(node.inputs[0]!, cache) as number) ?? 0.5;
      const s  = (this.socketValue(node.inputs[1]!, cache) as number) ?? 1;
      const v  = (this.socketValue(node.inputs[2]!, cache) as number) ?? 1;
      const fac = (this.socketValue(node.inputs[3]!, cache) as number) ?? 1;
      const c  = (this.socketValue(node.inputs[4]!, cache) as RGBA) ?? [0.5, 0.5, 0.5, 1];
      const [ch, cs, cv] = rgb2hsv(c[0], c[1], c[2]);
      // Blender's Hue input shifts by hue-0.5 (so 0.5 is no-op).
      let nh = ch + (h - 0.5);
      nh = nh - Math.floor(nh);
      const ns = clamp01(cs * s);
      const nv = cv * v;
      const [rr, gg, bb] = hsv2rgb(nh, ns, nv);
      const t = clamp01(fac);
      cache.set(node.outputs[0]!.id, [
        lerp(c[0], rr, t),
        lerp(c[1], gg, t),
        lerp(c[2], bb, t),
        c[3],
      ] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeBrightContrast') {
      /* LEGACY PATH PLACEHOLDER: approximate brightness/contrast */
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0, 0, 0, 1];
      const bright = (this.socketValue(node.inputs[1]!, cache) as number) ?? 0;
      const contrast = (this.socketValue(node.inputs[2]!, cache) as number) ?? 0;
      const apply = (x: number) => Math.max(0, Math.min(1, x * (1 + contrast / 100) + bright / 100 + 0.5 * (1 - (1 + contrast / 100))));
      cache.set(node.outputs[0]!.id, [apply(c[0]), apply(c[1]), apply(c[2]), c[3]] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeInvert') {
      /* LEGACY PATH PLACEHOLDER */
      const fac = (this.socketValue(node.inputs[0]!, cache) as number) ?? 1;
      const c = this.socketValue(node.inputs[1]!, cache) as RGBA ?? [0, 0, 0, 1];
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      cache.set(node.outputs[0]!.id, [
        lerp(c[0], 1 - c[0], fac),
        lerp(c[1], 1 - c[1], fac),
        lerp(c[2], 1 - c[2], fac),
        c[3],
      ] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeGamma') {
      /* LEGACY PATH PLACEHOLDER */
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0, 0, 0, 1];
      const g = (this.socketValue(node.inputs[1]!, cache) as number) ?? 1;
      const safe = (x: number) => Math.max(0, x) ** g;
      cache.set(node.outputs[0]!.id, [safe(c[0]), safe(c[1]), safe(c[2]), c[3]] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeMixRGB') {
      /* LEGACY PATH PLACEHOLDER: legacy MixRGB node */
      const fac = (this.socketValue(node.inputs[0]!, cache) as number) ?? 0.5;
      const a = this.socketValue(node.inputs[1]!, cache) as RGBA ?? [0, 0, 0, 1];
      const b = this.socketValue(node.inputs[2]!, cache) as RGBA ?? [0, 0, 0, 1];
      const t = Math.max(0, Math.min(1, fac));
      cache.set(node.outputs[0]!.id, [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeValToRGB') {
      /* ColorRamp — use common ColorRampNode if available else linear b/w */
      const t = (this.socketValue(node.inputs[0]!, cache) as number) ?? 0;
      const stops = (node as unknown as { stops?: { position: number; color: number[] }[] }).stops;
      const interp = ((node as unknown as { interpolation?: string }).interpolation ?? 'LINEAR') as 'LINEAR' | 'CONSTANT' | 'EASE' | 'B_SPLINE' | 'CARDINAL';
      let out: RGBA;
      if (stops && stops.length) {
        out = ColorRampNode.sample(stops as import('../nodes/common/ColorRamp').ColorRampStop[], interp, t);
      } else {
        out = [t, t, t, 1];
      }
      cache.set(node.outputs[0]!.id, out);
      cache.set(node.outputs[1]!.id, out[3]);
      return;
    }
    // ----------------------------------------------------------------
    //  Curves — RGB/Vector/Float (Phase 2C). Real CPU evaluator using
    //  the shared `sampleCurve()` helper in nodes/common/Curves.ts.
    // ----------------------------------------------------------------
    if (node instanceof ShaderNodeFloatCurve) {
      const fac = (this.socketValue(node.inputs[0]!, cache) as number) ?? 1;
      const v = (this.socketValue(node.inputs[1]!, cache) as number) ?? 0;
      cache.set(node.outputs[0]!.id, ShaderNodeFloatCurve.compute(node.curve, v, fac));
      return;
    }
    if (node instanceof ShaderNodeVectorCurve) {
      const fac = (this.socketValue(node.inputs[0]!, cache) as number) ?? 1;
      const v = (this.socketValue(node.inputs[1]!, cache) as Vec3) ?? [0, 0, 0];
      cache.set(node.outputs[0]!.id, ShaderNodeVectorCurve.compute(node.curves, v, fac));
      return;
    }
    if (node instanceof ShaderNodeRGBCurve) {
      const fac = (this.socketValue(node.inputs[0]!, cache) as number) ?? 1;
      const c = (this.socketValue(node.inputs[1]!, cache) as RGBA) ?? [0.5, 0.5, 0.5, 1];
      cache.set(node.outputs[0]!.id, ShaderNodeRGBCurve.compute(node.curves, c, fac));
      return;
    }
    void ({} as CurveMappingCurve); // keep type import for d.ts
    // ----------------------------------------------------------------
    //  TexCoord — geometry-based coordinate outputs (CPU stubs)
    // ----------------------------------------------------------------
    if (node.bl_idname === 'ShaderNodeTexCoord') {
      const zero3: Vec3 = [0, 0, 0];
      cache.set(node.outputs[0]?.id ?? '', zero3); // Generated
      cache.set(node.outputs[1]?.id ?? '', zero3); // Normal
      cache.set(node.outputs[2]?.id ?? '', zero3); // UV
      cache.set(node.outputs[3]?.id ?? '', zero3); // Object
      cache.set(node.outputs[4]?.id ?? '', zero3); // Camera
      cache.set(node.outputs[5]?.id ?? '', zero3); // Window
      cache.set(node.outputs[6]?.id ?? '', zero3); // Reflection
      return;
    }
    if (node.bl_idname === 'ShaderNodeGeometry') {
      const zero3: Vec3 = [0, 0, 0];
      for (const out of node.outputs) cache.set(out.id, zero3);
      return;
    }
    // ----------------------------------------------------------------
    //  Vector ops — Mapping, Displacement, NormalMap (CPU stubs)
    // ----------------------------------------------------------------
    if (node.bl_idname === 'ShaderNodeMapping') {
      const v = this.socketValue(node.inputs[0]!, cache) as Vec3 ?? [0, 0, 0];
      cache.set(node.outputs[0]!.id, v);
      return;
    }
    if (node.bl_idname === 'ShaderNodeNormalMap') {
      const c = this.socketValue(node.inputs[2]!, cache) as Vec3 ?? [0, 0, 0];
      cache.set(node.outputs[0]!.id, c);
      return;
    }
    if (node.bl_idname === 'ShaderNodeBump') {
      cache.set(node.outputs[0]!.id, [0, 0, 1] as Vec3);
      return;
    }
    if (node.bl_idname === 'ShaderNodeDisplacement' || node.bl_idname === 'ShaderNodeVectorDisplacement') {
      const h = (this.socketValue(node.inputs[0]!, cache) as number) ?? 0;
      cache.set(node.outputs[0]!.id, [0, h, 0] as Vec3);
      return;
    }
    if (node.bl_idname === 'ShaderNodeVectorRotate') {
      const v = this.socketValue(node.inputs[0]!, cache) as Vec3 ?? [0, 0, 0];
      cache.set(node.outputs[0]!.id, v);
      return;
    }
    // ----------------------------------------------------------------
    //  Additional shader nodes (Phase 4: filling remaining gaps)
    // ----------------------------------------------------------------
    if (node.bl_idname === 'ShaderNodeBlackbody') {
      const temp = (this.socketValue(node.inputs[0]!, cache) as number) ?? 1500;
      // CIE 1931 blackbody approximation (Tanner Helland's algorithm)
      const t = temp / 100;
      let r: number, g: number, b: number;
      if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
      else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
      if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
      const srgb = (v: number) => { v = Math.max(0, Math.min(255, v)) / 255; return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
      cache.set(node.outputs[0]!.id, [srgb(r), srgb(g), srgb(b), 1] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeWavelength') {
      const wl = (this.socketValue(node.inputs[0]!, cache) as number) ?? 500;
      // Visible spectrum to sRGB approximation
      let r = 0, g = 0, b = 0;
      if (wl >= 380 && wl < 440) { r = -(wl - 440) / (440 - 380); b = 1; }
      else if (wl >= 440 && wl < 490) { g = (wl - 440) / (490 - 440); b = 1; }
      else if (wl >= 490 && wl < 510) { g = 1; b = -(wl - 510) / (510 - 490); }
      else if (wl >= 510 && wl < 580) { r = (wl - 510) / (580 - 510); g = 1; }
      else if (wl >= 580 && wl < 645) { r = 1; g = -(wl - 645) / (645 - 580); }
      else if (wl >= 645 && wl <= 780) { r = 1; }
      // Intensity falloff at edges
      let factor = 1;
      if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / (420 - 380);
      else if (wl > 700 && wl <= 780) factor = 0.3 + 0.7 * (780 - wl) / (780 - 700);
      const gamma = 0.8;
      cache.set(node.outputs[0]!.id, [
        Math.pow(r * factor, gamma), Math.pow(g * factor, gamma), Math.pow(b * factor, gamma), 1
      ] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeRGBToBW') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0, 0, 0, 1];
      // ITU-R BT.709 luminance coefficients
      cache.set(node.outputs[0]!.id, c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
      return;
    }
    if (node.bl_idname === 'ShaderNodeShaderToRGB') {
      // Pass through the shader descriptor's color as the color output
      const shader = this.socketValue(node.inputs[0]!, cache) as MaterialDescriptor | undefined;
      cache.set(node.outputs[0]!.id, shader?.color ?? [0, 0, 0, 1] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeNormal') {
      const normal = this.socketValue(node.inputs[0]!, cache) as Vec3 ?? [0, 0, 1];
      cache.set(node.outputs[0]!.id, normal);
      cache.set(node.outputs[1]!.id, normal);
      return;
    }
    if (node.bl_idname === 'ShaderNodeTangent') {
      cache.set(node.outputs[0]!.id, [1, 0, 0] as Vec3);
      return;
    }
    if (node.bl_idname === 'ShaderNodeWireframe') {
      // CPU stub: return 0 (no wireframe in flat descriptor mode)
      cache.set(node.outputs[0]!.id, 0);
      return;
    }
    if (node.bl_idname === 'ShaderNodeAmbientOcclusion') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [1, 1, 1, 1];
      // CPU stub: approximate AO as 1.0 (no occlusion)
      cache.set(node.outputs[0]!.id, c);
      cache.set(node.outputs[1]!.id, 1);
      return;
    }
    if (node.bl_idname === 'ShaderNodeBevel') {
      const v = this.socketValue(node.inputs[1]!, cache) as Vec3 ?? [0, 0, 1];
      cache.set(node.outputs[0]!.id, v);
      return;
    }
    if (node.bl_idname === 'ShaderNodeVectorTransform') {
      const v = this.socketValue(node.inputs[0]!, cache) as Vec3 ?? [0, 0, 0];
      // CPU stub: pass-through (no actual transform conversion)
      cache.set(node.outputs[0]!.id, v);
      return;
    }
    if (node.bl_idname === 'ShaderNodeVolumePrincipled') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0.5, 0.5, 0.5, 1];
      const density = (this.socketValue(node.inputs[1]!, cache) as number) ?? 1;
      cache.set(node.outputs[0]!.id, {
        ...DEFAULT,
        color: [0, 0, 0, 1],
        emissive: [c[0] * density * 0.1, c[1] * density * 0.1, c[2] * density * 0.1],
        emissive_strength: density * 0.1,
        opacity: Math.max(0, Math.min(1, 1 - density * 0.1)),
      } as MaterialDescriptor);
      return;
    }
    if (node.bl_idname === 'ShaderNodeVertexColor') {
      // CPU stub: return default white
      cache.set(node.outputs[0]!.id, [1, 1, 1, 1] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeHairInfo') {
      // CPU stub: return sensible defaults for hair info
      cache.set(node.outputs[0]!.id, 0);       // Is Strand
      cache.set(node.outputs[1]!.id, 0.5);     // Intercept
      cache.set(node.outputs[2]!.id, [0, 0, 1] as Vec3); // Strand Normal
      cache.set(node.outputs[3]!.id, 0);       // Random
      return;
    }
    if (node.bl_idname === 'ShaderNodeParticleInfo') {
      // CPU stub: zeros for all particle info outputs
      for (const out of node.outputs) cache.set(out.id, out.kind === 'VALUE' ? 0 : out.default_value);
      return;
    }
    if (node.bl_idname === 'ShaderNodePointInfo') {
      // CPU stub: zeros for all point info outputs
      for (const out of node.outputs) cache.set(out.id, out.kind === 'VALUE' ? 0 : out.default_value);
      return;
    }
    if (node.bl_idname === 'ShaderNodeVolumeInfo') {
      // CPU stub
      cache.set(node.outputs[0]!.id, 0);       // Color
      cache.set(node.outputs[1]!.id, 0);       // Density
      cache.set(node.outputs[2]!.id, 0);       // Temperature
      return;
    }
    if (node.bl_idname === 'ShaderNodeOutputAOV') {
      // AOV output — just pass through the color input
      return;
    }
    if (node.bl_idname === 'ShaderNodeNewGeometry') {
      // Same as ShaderNodeGeometry — return zeros
      const zero3: Vec3 = [0, 0, 0];
      for (const out of node.outputs) cache.set(out.id, zero3);
      return;
    }
    // ----------------------------------------------------------------
    //  Phase 7: Remaining shader nodes
    // ----------------------------------------------------------------
    if (node.bl_idname === 'ShaderNodeBsdfHair') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0.5, 0.5, 0.5, 1];
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: 0.5 });
      return;
    }
    if (node.bl_idname === 'ShaderNodeBsdfHairPrincipled') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0.5, 0.5, 0.5, 1];
      const r = (this.socketValue(node.inputs[1]!, cache) as number) ?? 0.5;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0, roughness: r });
      return;
    }
    if (node.bl_idname === 'ShaderNodeEeveeSpecular') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [1, 1, 1, 1];
      const r = (this.socketValue(node.inputs[1]!, cache) as number) ?? 0.5;
      cache.set(node.outputs[0]!.id, { ...DEFAULT, color: c, metalness: 0.5, roughness: r });
      return;
    }
    if (node.bl_idname === 'ShaderNodeTexSky') {
      const v = (this.socketValue(node.inputs[0]!, cache) as Vec3) ?? [0, 0, 1];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      const ny = v[1] / l;
      const t = Math.max(0, ny * 0.5 + 0.5);
      cache.set(node.outputs[0]!.id, [0.3 + 0.3 * t, 0.5 + 0.3 * t, 0.8 * t + 0.2, 1] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeTexPointDensity') {
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node.bl_idname === 'ShaderNodeAttributeColor') {
      cache.set(node.outputs[0]!.id, [1, 1, 1, 1] as RGBA);
      cache.set(node.outputs[1]!.id, [1, 1, 1] as Vec3);
      cache.set(node.outputs[2]!.id, 1);
      cache.set(node.outputs[3]!.id, 1);
      return;
    }
    if (node.bl_idname === 'FunctionNodeFloatToInt') {
      const v = this.socketValue(node.inputs[0]!, cache) as number ?? 0;
      const mode = (node as unknown as { rounding_mode?: string }).rounding_mode ?? 'ROUND';
      let result: number;
      switch (mode) {
        case 'FLOOR': result = Math.floor(v); break;
        case 'CEIL': result = Math.ceil(v); break;
        case 'TRUNC': result = Math.trunc(v); break;
        default: result = Math.round(v);
      }
      cache.set(node.outputs[0]!.id, result);
      return;
    }
    if (node.bl_idname === 'FunctionNodeRotateEuler') {
      const v = this.socketValue(node.inputs[0]!, cache) as Vec3 ?? [0, 0, 0];
      const axis = this.socketValue(node.inputs[1]!, cache) as Vec3 ?? [0, 0, 1];
      const angle = (this.socketValue(node.inputs[2]!, cache) as number) ?? 0;
      const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      const ux = axis[0] / l, uy = axis[1] / l, uz = axis[2] / l;
      const c = Math.cos(angle), s = Math.sin(angle), ci = 1 - c;
      const rx = v[0] * (c + ux * ux * ci) + v[1] * (ux * uy * ci - uz * s) + v[2] * (ux * uz * ci + uy * s);
      const ry = v[0] * (uy * ux * ci + uz * s) + v[1] * (c + uy * uy * ci) + v[2] * (uy * uz * ci - ux * s);
      const rz = v[0] * (uz * ux * ci - uy * s) + v[1] * (uz * uy * ci + ux * s) + v[2] * (c + uz * uz * ci);
      cache.set(node.outputs[0]!.id, [rx, ry, rz] as Vec3);
      return;
    }
    if (node.bl_idname === 'FunctionNodeAlignEulerToVector') {
      const euler = this.socketValue(node.inputs[0]!, cache) as Vec3 ?? [0, 0, 0];
      const vector = this.socketValue(node.inputs[1]!, cache) as Vec3 ?? [0, 0, 1];
      const l = Math.hypot(vector[0], vector[1], vector[2]) || 1;
      const nx = vector[0] / l, ny = vector[1] / l, nz = vector[2] / l;
      const pitch = Math.asin(Math.max(-1, Math.min(1, -nx)));
      const yaw = Math.atan2(ny, nz);
      cache.set(node.outputs[0]!.id, [euler[0] + pitch, euler[1], euler[2] + yaw] as Vec3);
      return;
    }
    if (node.bl_idname === 'ShaderNodeScript') {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0, 0, 0, 1];
      cache.set(node.outputs[0]!.id, c);
      return;
    }
    // unknown node — propagate defaults
    for (const out of node.outputs) cache.set(out.id, out.default_value);
  }
}

function mixDesc(a: MaterialDescriptor, b: MaterialDescriptor, f: number): MaterialDescriptor {
  const m = (x: number, y: number) => x * (1 - f) + y * f;
  const mc = (x: RGBA, y: RGBA): RGBA => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2]), m(x[3], y[3])];
  const mv = (x: Vec3, y: Vec3): Vec3 => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  return {
    color: mc(a.color, b.color),
    metalness: m(a.metalness, b.metalness),
    roughness: m(a.roughness, b.roughness),
    emissive: mv(a.emissive, b.emissive),
    emissive_strength: m(a.emissive_strength, b.emissive_strength),
    opacity: m(a.opacity, b.opacity),
  };
}
