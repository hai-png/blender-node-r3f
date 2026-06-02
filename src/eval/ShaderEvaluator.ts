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

    const output = order.find((n) => n instanceof ShaderNodeOutputMaterial) as ShaderNodeOutputMaterial | undefined;
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
      const a = this.socketValue(node.inputs[0]!, cache) as number;
      const b = this.socketValue(node.inputs[1]!, cache) as number;
      const eps = this.socketValue(node.inputs[2]!, cache) as number;
      cache.set(node.outputs[0]!.id, CompareNode.compute(node.operation, a, b, eps));
      return;
    }
    if (node instanceof SwitchNode) {
      const cond = !!(this.socketValue(node.inputs[0]!, cache) as boolean);
      cache.set(node.outputs[0]!.id, this.socketValue(node.inputs[cond ? 2 : 1]!, cache));
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
      // Emit a procedural color = vec3(0.5 + 0.5*sin(scale * uv))
      const scale = this.socketValue(node.inputs[1]!, cache) as number;
      cache.set(node.outputs[0]!.id, 0.5);
      cache.set(node.outputs[1]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      // expose as a side-channel for the descriptor (M0 demo trick)
      (cache as Map<string, unknown>).set(`__noise_scale_${node.id}`, scale);
      return;
    }
    if (node instanceof ShaderNodeBsdfPrincipled) {
      const baseColor = this.socketValue(node.inputs[0]!, cache) as RGBA;
      const metallic = this.socketValue(node.inputs[1]!, cache) as number;
      const roughness = this.socketValue(node.inputs[2]!, cache) as number;
      const alpha = this.socketValue(node.inputs[4]!, cache) as number;
      const emissiveColor = this.socketValue(node.inputs[6]!, cache) as RGBA;
      const emissiveStrength = this.socketValue(node.inputs[7]!, cache) as number;
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
    if (node instanceof ShaderNodeOutputMaterial) {
      return;
    }
    // ----------------------------------------------------------------
    //  Texture nodes — procedural samplers (CPU approximations)
    // ----------------------------------------------------------------
    if (node instanceof ShaderNodeTexVoronoi) {
      /* TSL APPROX: CPU fallback returns mid-grey */
      cache.set(node.outputs[0]!.id, 0.5);
      cache.set(node.outputs[1]!.id, 0.5);
      cache.set(node.outputs[2]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      return;
    }
    if (node instanceof ShaderNodeTexWave) {
      /* TSL APPROX: CPU fallback */
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeTexChecker) {
      /* TSL APPROX: CPU fallback — checkerboard at default scale */
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeTexBrick) {
      /* TSL APPROX */
      cache.set(node.outputs[0]!.id, [0.6, 0.5, 0.4, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeTexGradient) {
      /* TSL APPROX */
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeTexMagic) {
      /* TSL APPROX */
      cache.set(node.outputs[0]!.id, [0.5, 0.4, 0.7, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeTexWhiteNoise) {
      /* TSL APPROX */
      cache.set(node.outputs[0]!.id, Math.random());
      cache.set(node.outputs[1]!.id, [Math.random(), Math.random(), Math.random(), 1] as RGBA);
      return;
    }
    if (node instanceof ShaderNodeTexImage) {
      /* TSL APPROX: image node without resolver returns white */
      cache.set(node.outputs[0]!.id, [1, 1, 1, 1] as RGBA);
      cache.set(node.outputs[1]!.id, 1);
      return;
    }
    if (node instanceof ShaderNodeTexEnvironment) {
      /* TSL APPROX */
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
      /* TSL APPROX: return default color/value for unknown attributes */
      cache.set(node.outputs[0]!.id, [0.5, 0.5, 0.5, 1] as RGBA);
      cache.set(node.outputs[1]!.id, [0.5, 0.5, 0.5] as Vec3);
      cache.set(node.outputs[2]!.id, 0.5);
      cache.set(node.outputs[3]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeFresnel) {
      /* TSL APPROX: mid-factor */
      cache.set(node.outputs[0]!.id, 0.05);
      return;
    }
    if (node instanceof ShaderNodeLayerWeight) {
      /* TSL APPROX */
      cache.set(node.outputs[0]!.id, 0.5);
      cache.set(node.outputs[1]!.id, 0.5);
      return;
    }
    if (node instanceof ShaderNodeObjectInfo) {
      /* TSL APPROX: zeros */
      cache.set(node.outputs[0]!.id, [0, 0, 0] as Vec3);
      cache.set(node.outputs[1]!.id, [0, 0, 0] as Vec3);
      cache.set(node.outputs[2]!.id, [0.8, 0.8, 0.8, 1] as RGBA);
      cache.set(node.outputs[3]!.id, 0);
      cache.set(node.outputs[4]!.id, 0);
      cache.set(node.outputs[5]!.id, 0);
      return;
    }
    if (node instanceof ShaderNodeCameraData) {
      /* TSL APPROX */
      cache.set(node.outputs[0]!.id, [0, 0, 1] as Vec3);
      cache.set(node.outputs[1]!.id, 1);
      cache.set(node.outputs[2]!.id, 45);
      return;
    }
    if (node instanceof ShaderNodeLightPath) {
      /* TSL APPROX: camera ray context */
      const defaults = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < node.outputs.length; i++) {
        cache.set(node.outputs[i]!.id, defaults[i] ?? 0);
      }
      return;
    }
    if (node.bl_idname === 'ShaderNodeHueSaturation') {
      /* TSL APPROX: pass through color unchanged */
      const c = this.socketValue(node.inputs[4]!, cache) as RGBA ?? [0.5, 0.5, 0.5, 1];
      cache.set(node.outputs[0]!.id, c);
      return;
    }
    if (node.bl_idname === 'ShaderNodeBrightContrast') {
      /* TSL APPROX: approximate brightness/contrast */
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0, 0, 0, 1];
      const bright = (this.socketValue(node.inputs[1]!, cache) as number) ?? 0;
      const contrast = (this.socketValue(node.inputs[2]!, cache) as number) ?? 0;
      const apply = (x: number) => Math.max(0, Math.min(1, x * (1 + contrast / 100) + bright / 100 + 0.5 * (1 - (1 + contrast / 100))));
      cache.set(node.outputs[0]!.id, [apply(c[0]), apply(c[1]), apply(c[2]), c[3]] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeInvert') {
      /* TSL APPROX */
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
      /* TSL APPROX */
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA ?? [0, 0, 0, 1];
      const g = (this.socketValue(node.inputs[1]!, cache) as number) ?? 1;
      const safe = (x: number) => Math.max(0, x) ** g;
      cache.set(node.outputs[0]!.id, [safe(c[0]), safe(c[1]), safe(c[2]), c[3]] as RGBA);
      return;
    }
    if (node.bl_idname === 'ShaderNodeMixRGB') {
      /* TSL APPROX: legacy MixRGB node */
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
