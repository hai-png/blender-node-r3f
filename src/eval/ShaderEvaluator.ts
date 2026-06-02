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
import { RerouteNode, NodeGroupInput, NodeGroupOutput } from '../nodes/common';
import { NodeGroupBase } from '../nodes/common/Group';

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

export class ShaderEvaluator implements SystemEvaluator {
  evaluate(tree: NodeTree, _dirty: ReadonlySet<Node>): EvaluationResult {
    const start = performance.now();
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
      const r = this.socketValue(node.inputs[0]!, cache) as number;
      const g = this.socketValue(node.inputs[1]!, cache) as number;
      const b = this.socketValue(node.inputs[2]!, cache) as number;
      cache.set(node.outputs[0]!.id, [r, g, b, 1] as RGBA);
      return;
    }
    if (node instanceof SeparateColorNode) {
      const c = this.socketValue(node.inputs[0]!, cache) as RGBA;
      cache.set(node.outputs[0]!.id, c[0]);
      cache.set(node.outputs[1]!.id, c[1]);
      cache.set(node.outputs[2]!.id, c[2]);
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
