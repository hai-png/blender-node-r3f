/**
 * TSLShaderEvaluator — translates a ShaderNodeTree into a real Three.js
 * TSL node graph, then assigns the result to a MeshStandardNodeMaterial.
 *
 * Architecture
 * ------------
 *   1. Walk the tree in topological order.
 *   2. For each Blender node, call `emit()` to produce a record of TSL
 *      node values keyed by socket identifier.
 *   3. When a downstream node needs an input, look up the linked source's
 *      emitted value (TSL node), apply implicit type conversion via the
 *      destination socket's TSL kind.
 *   4. When we hit ShaderNodeOutputMaterial, gather the surface closure
 *      into a TSLMaterialDescriptor of TSL nodes (colorNode, roughnessNode,
 *      …) and build a MeshStandardNodeMaterial.
 *
 * What TSL is
 * -----------
 * TSL (Three Shading Language) is a JS DSL that compiles to GLSL/WGSL.
 * Importing from "three/tsl" works in both WebGL2 and WebGPU paths.
 *
 *   import { float, vec3, uv, positionLocal, mx_noise_float } from 'three/tsl';
 *   import { MeshStandardNodeMaterial } from 'three/webgpu';
 *
 *   const m = new MeshStandardNodeMaterial();
 *   m.colorNode      = vec3(uv().x, uv().y, 0.5);
 *   m.roughnessNode  = float(0.3);
 *
 * Closures
 * --------
 * Blender's NodeSocketShader is opaque. We model a closure as a partial
 * `TSLMaterialDescriptor` (color + metalness + roughness + emissive + …).
 * Combining closures (Add Shader / Mix Shader / Principled) yields a new
 * descriptor by summing or mixing channels.
 */
import type { NodeTree } from '../../core/NodeTree';
import type { Node } from '../../core/Node';
import type { NodeSocket } from '../../core/NodeSocket';
import type { SystemEvaluator, EvaluationResult } from '../Depsgraph';
import type { Texture } from 'three';

// Lazy import — only loaded by callers that pass `useTSL=true` to bootstrap.
// Note: importing 'three/tsl' pulls in the WebGPU node system; the demo's
// fallback evaluator (ShaderEvaluator) still works without it.
import * as TSL from 'three/tsl';
import * as TWG from 'three/webgpu';

/**
 * Anything in the TSL graph — UniformNode, ShaderNodeObject, Number literal …
 * We use `any` deliberately at the boundary because TSL's runtime API is
 * fluent and accepts mixed-type operands.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TSLNode = any;

export interface TSLMaterialDescriptor {
  colorNode?: TSLNode;
  metalnessNode?: TSLNode;
  roughnessNode?: TSLNode;
  normalNode?: TSLNode;
  emissiveNode?: TSLNode;
  opacityNode?: TSLNode;
  positionNode?: TSLNode;
  iorNode?: TSLNode;
  transmissionNode?: TSLNode;
  alphaTest?: TSLNode;
}

const {
  float, vec2, vec3, vec4, color, uv, positionLocal, positionWorld, normalWorld,
  mix, mul, add, sub, cameraPosition, reflectVector, texture: textureNode,
} = TSL;

/* ---------------------------------------------------------------- */
/*  Small TSL vector helpers                                         */
/* ---------------------------------------------------------------- */
function toVec3(v: TSLNode): TSLNode {
  if (v?.xyz) return v.xyz;
  if (v?.z !== undefined) return vec3(v.x, v.y, v.z);
  if (v?.y !== undefined) return vec3(v.x, v.y, 0);
  return vec3(v, v, v);
}
function scalarInputOr(node: Node, index: number, ctx: EmitContext, fallback: number): TSLNode {
  const sock = node.inputs[index];
  if (!sock) return float(fallback);
  if (sock.is_linked) return ctx.input(sock);
  if (typeof sock.default_value === 'number') return float(sock.default_value);
  return float(fallback);
}
function vectorInputOr(node: Node, index: number, ctx: EmitContext, fallback: TSLNode): TSLNode {
  const sock = node.inputs[index];
  if (!sock) return fallback;
  if (sock.is_linked) return toVec3(ctx.input(sock));
  if (Array.isArray(sock.default_value) && sock.default_value.length >= 3) {
    return vec3(sock.default_value[0]!, sock.default_value[1]!, sock.default_value[2]!);
  }
  return fallback;
}
function hash1(v: TSLNode): TSLNode {
  return toVec3(v).dot(vec3(127.1, 311.7, 74.7)).sin().mul(43758.5453).fract();
}
function hash3(v: TSLNode): TSLNode {
  const p = toVec3(v);
  return vec3(
    hash1(p.add(vec3(0.0, 0.0, 0.0))),
    hash1(p.add(vec3(19.19, 73.42, 11.17))),
    hash1(p.add(vec3(47.11, 3.17, 29.53))),
  );
}
function viewVectorWorld(): TSLNode {
  return cameraPosition.sub(positionWorld).normalize();
}
function viewDistanceWorld(): TSLNode {
  return cameraPosition.sub(positionWorld).length();
}
function generatedVector(node: Node, index: number, ctx: EmitContext): TSLNode {
  return vectorInputOr(node, index, ctx, positionLocal);
}
function wrapUv(u: TSLNode, v: TSLNode, extension: string): TSLNode {
  switch (extension) {
    case 'CLIP':
    case 'EXTEND':
      return vec2(u.clamp(0, 1), v.clamp(0, 1));
    case 'MIRROR': {
      const mu = float(1).sub(u.fract().mul(2).sub(1).abs());
      const mv = float(1).sub(v.fract().mul(2).sub(1).abs());
      return vec2(mu, mv);
    }
    default:
      return vec2(u.fract(), v.fract());
  }
}
function sampleResolvedTexture(ctx: EmitContext, key: string, kind: 'IMAGE' | 'ENVIRONMENT', uvNode: TSLNode): TSLNode | null {
  const tex = ctx.resolveTexture?.(key, kind) ?? null;
  if (!tex) return null;
  return textureNode(tex, uvNode);
}
function rotateX(v: TSLNode, a: TSLNode): TSLNode {
  const c = a.cos(), s = a.sin();
  return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
}
function rotateY(v: TSLNode, a: TSLNode): TSLNode {
  const c = a.cos(), s = a.sin();
  return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
}
function rotateZ(v: TSLNode, a: TSLNode): TSLNode {
  const c = a.cos(), s = a.sin();
  return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
}
function rotateEulerXYZ(v: TSLNode, r: TSLNode): TSLNode {
  return rotateZ(rotateY(rotateX(v, r.x), r.y), r.z);
}
function rotateAxisAngle(v: TSLNode, axisIn: TSLNode, angle: TSLNode): TSLNode {
  const axis = axisIn.normalize ? axisIn.normalize() : axisIn;
  const c = angle.cos(), s = angle.sin(), oneMinusC = float(1).sub(c);
  return v.mul(c).add(axis.cross(v).mul(s)).add(axis.mul(axis.dot(v)).mul(oneMinusC));
}

/* ---------------------------------------------------------------- */
/*  Emit table — maps bl_idname -> emit function                    */
/* ---------------------------------------------------------------- */
type Cache = Map<string /* socket.id */, TSLNode>;
type EmitFn = (node: Node, ctx: EmitContext) => Record<string, TSLNode>;
export interface TSLShaderEvaluatorOptions {
  /** Optional texture hook for ShaderNodeTexImage / ShaderNodeTexEnvironment. */
  resolveTexture?: (key: string, kind: 'IMAGE' | 'ENVIRONMENT') => Texture | null;
}
interface EmitContext {
  cache: Cache;
  /** Resolve an input socket to its TSL node (or default literal). */
  input: (socket: NodeSocket) => TSLNode;
  /** Optional texture resolver for real sampled image/environment nodes. */
  resolveTexture?: (key: string, kind: 'IMAGE' | 'ENVIRONMENT') => Texture | null;
}

const EMITTERS = new Map<string, EmitFn>();

/** Register an emit function for a node bl_idname. Re-exported below. */
export function registerEmit(bl_idname: string, fn: EmitFn): void {
  EMITTERS.set(bl_idname, fn);
}

/* ---------------------------------------------------------------- */
/*  Default emit fallbacks for primitive value nodes                */
/* ---------------------------------------------------------------- */
registerEmit('NodeReroute', (n, c) => {
  const v = n.inputs[0] ? c.input(n.inputs[0]) : float(0);
  return { Output: v };
});
registerEmit('ShaderNodeValue', (n) => {
  const v = (n as unknown as { value: number }).value;
  return { Value: float(v) };
});
registerEmit('ShaderNodeRGB', (n) => {
  const c = (n as unknown as { rgb: number[] }).rgb;
  return { Color: vec4(c[0]!, c[1]!, c[2]!, c[3] ?? 1) };
});
registerEmit('ShaderNodeOutputMaterial', () => ({}));
registerEmit('ShaderNodeOutputWorld', () => ({}));
registerEmit('ShaderNodeOutputLight', () => ({}));
registerEmit('FunctionNodeInputVector', (n) => {
  const v = (n as unknown as { vector: number[] }).vector;
  return { Vector: vec3(v[0]!, v[1]!, v[2]!) };
});

/* ---------------------------------------------------------------- */
/*  Common: Math / VectorMath / Mix / MapRange / Clamp              */
/* ---------------------------------------------------------------- */
registerEmit('ShaderNodeMath', (n, c) => {
  const a = c.input(n.inputs[0]!);
  const b = c.input(n.inputs[1]!);
  const cc = c.input(n.inputs[2]!);
  const op = (n as unknown as { operation: string }).operation;
  const clamp = (n as unknown as { use_clamp: boolean }).use_clamp;
  let v: TSLNode;
  switch (op) {
    case 'ADD': v = a.add(b); break;
    case 'SUBTRACT': v = a.sub(b); break;
    case 'MULTIPLY': v = a.mul(b); break;
    case 'DIVIDE': v = a.div(b); break;
    case 'MULTIPLY_ADD': v = a.mul(b).add(cc); break;
    case 'POWER': v = a.pow(b); break;
    case 'SQRT': v = a.sqrt(); break;
    case 'INVERSE_SQRT': v = a.inverseSqrt(); break;
    case 'ABSOLUTE': v = a.abs(); break;
    case 'EXPONENT': v = a.exp(); break;
    case 'LOGARITHM': v = a.log().div(b.log()); break;
    case 'MINIMUM': v = a.min(b); break;
    case 'MAXIMUM': v = a.max(b); break;
    case 'LESS_THAN': v = a.lessThan(b); break;
    case 'GREATER_THAN': v = a.greaterThan(b); break;
    case 'SIGN': v = a.sign(); break;
    case 'ROUND': v = a.round(); break;
    case 'FLOOR': v = a.floor(); break;
    case 'CEIL': v = a.ceil(); break;
    case 'TRUNC': v = a.trunc(); break;
    case 'FRACT': v = a.fract(); break;
    case 'MODULO': v = a.mod(b); break;
    case 'SINE': v = a.sin(); break;
    case 'COSINE': v = a.cos(); break;
    case 'TANGENT': v = a.tan(); break;
    case 'ARCSINE': v = a.asin(); break;
    case 'ARCCOSINE': v = a.acos(); break;
    case 'ARCTANGENT': v = a.atan(); break;
    case 'ARCTAN2': v = a.atan2 ? a.atan2(b) : a.div(b).atan(); break;
    case 'RADIANS': v = a.mul(Math.PI / 180); break;
    case 'DEGREES': v = a.mul(180 / Math.PI); break;
    default: v = a;
  }
  if (clamp) v = v.clamp(0, 1);
  return { Value: v };
});

registerEmit('ShaderNodeVectorMath', (n, c) => {
  const a = c.input(n.inputs[0]!);
  const b = c.input(n.inputs[1]!);
  const cc = c.input(n.inputs[2]!);
  const s = c.input(n.inputs[3]!);
  const op = (n as unknown as { operation: string }).operation;
  let vec: TSLNode = a; let val: TSLNode = float(0);
  switch (op) {
    case 'ADD': vec = a.add(b); break;
    case 'SUBTRACT': vec = a.sub(b); break;
    case 'MULTIPLY': vec = a.mul(b); break;
    case 'DIVIDE': vec = a.div(b); break;
    case 'MULTIPLY_ADD': vec = a.mul(b).add(cc); break;
    case 'CROSS_PRODUCT': vec = a.cross(b); break;
    case 'NORMALIZE': vec = a.normalize(); break;
    case 'ABSOLUTE': vec = a.abs(); break;
    case 'MINIMUM': vec = a.min(b); break;
    case 'MAXIMUM': vec = a.max(b); break;
    case 'FLOOR': vec = a.floor(); break;
    case 'CEIL': vec = a.ceil(); break;
    case 'FRACTION': vec = a.fract(); break;
    case 'SCALE': vec = a.mul(s); break;
    case 'SINE': vec = a.sin(); break;
    case 'COSINE': vec = a.cos(); break;
    case 'TANGENT': vec = a.tan(); break;
    case 'DOT_PRODUCT': val = a.dot(b); break;
    case 'DISTANCE': val = a.distance(b); break;
    case 'LENGTH': val = a.length(); break;
    case 'REFLECT': vec = a.reflect(b); break;
    default: vec = a;
  }
  return { Vector: vec, Value: val };
});

registerEmit('ShaderNodeMix', (n, c) => {
  const dataType = (n as unknown as { data_type: string }).data_type;
  const f = c.input(n.inputs[0]!);
  if (dataType === 'FLOAT') {
    const a = c.input(n.inputs[1]!);
    const b = c.input(n.inputs[2]!);
    return { Result: mix(a, b, f) };
  }
  if (dataType === 'VECTOR') {
    const a = c.input(n.inputs[3]!);
    const b = c.input(n.inputs[4]!);
    return { Result_Vector: mix(a, b, f) };
  }
  // RGBA
  const a = c.input(n.inputs[5]!);
  const b = c.input(n.inputs[6]!);
  return { Result_Color: mix(a, b, f) };
});

registerEmit('ShaderNodeMapRange', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const fmn = c.input(n.inputs[1]!);
  const fmx = c.input(n.inputs[2]!);
  const tmn = c.input(n.inputs[3]!);
  const tmx = c.input(n.inputs[4]!);
  // (v - fmn) / (fmx - fmn) -> remap to [tmn, tmx]
  const t = v.sub(fmn).div(fmx.sub(fmn));
  const result = tmn.add(t.mul(tmx.sub(tmn)));
  const clamp = (n as unknown as { clamp: boolean }).clamp;
  return { Result: clamp ? result.clamp(tmn, tmx) : result };
});

registerEmit('ShaderNodeClamp', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const mn = c.input(n.inputs[1]!);
  const mx = c.input(n.inputs[2]!);
  return { Result: v.clamp(mn, mx) };
});

registerEmit('ShaderNodeCombineXYZ', (n, c) => {
  const x = c.input(n.inputs[0]!);
  const y = c.input(n.inputs[1]!);
  const z = c.input(n.inputs[2]!);
  return { Vector: vec3(x, y, z) };
});

registerEmit('ShaderNodeSeparateXYZ', (n, c) => {
  const v = c.input(n.inputs[0]!);
  return { X: v.x, Y: v.y, Z: v.z };
});
registerEmit('ShaderNodeCombineColor', (n, c) => {
  // Current TSL approximation: treat channels as RGB even when mode=HSV/HSL.
  const r = c.input(n.inputs[0]!);
  const g = c.input(n.inputs[1]!);
  const b = c.input(n.inputs[2]!);
  return { Color: vec4(r, g, b, 1) };
});
registerEmit('ShaderNodeSeparateColor', (n, c) => {
  // Current TSL approximation: split RGB channels directly.
  const v = c.input(n.inputs[0]!);
  return { Red: v.x, Green: v.y, Blue: v.z };
});
registerEmit('FunctionNodeBooleanMath', (n, c) => {
  const a = c.input(n.inputs[0]!).clamp(0, 1);
  const b = c.input(n.inputs[1]!).clamp(0, 1);
  const op = (n as unknown as { operation: string }).operation;
  let v: TSLNode;
  switch (op) {
    case 'AND': v = a.mul(b); break;
    case 'OR': v = a.add(b).clamp(0, 1); break;
    case 'NOT': v = float(1).sub(a); break;
    case 'NAND': v = float(1).sub(a.mul(b)).clamp(0, 1); break;
    case 'NOR': v = float(1).sub(a.add(b).clamp(0, 1)); break;
    case 'XNOR': v = float(1).sub(a.sub(b).abs().clamp(0, 1)); break;
    case 'XOR': v = a.sub(b).abs().clamp(0, 1); break;
    case 'IMPLY': v = float(1).sub(a).add(b).clamp(0, 1); break;
    case 'NIMPLY': v = a.mul(float(1).sub(b)).clamp(0, 1); break;
    default: v = a.mul(b); break;
  }
  return { Boolean: v };
});
registerEmit('FunctionNodeCompare', (n, c) => {
  const a = c.input(n.inputs[0]!);
  const b = c.input(n.inputs[1]!);
  const eps = c.input(n.inputs[2]!);
  const op = (n as unknown as { operation: string }).operation;
  let v: TSLNode;
  switch (op) {
    case 'LESS_THAN': v = b.sub(a).sign().max(0); break;
    case 'LESS_EQUAL': v = b.sub(a).add(eps).sign().max(0); break;
    case 'GREATER_THAN': v = a.sub(b).sign().max(0); break;
    case 'GREATER_EQUAL': v = a.sub(b).add(eps).sign().max(0); break;
    case 'EQUAL': v = float(1).sub(a.sub(b).abs().div(eps.max ? eps.max(1e-6) : add(eps, 1e-6)).clamp(0, 1)); break;
    case 'NOT_EQUAL': v = a.sub(b).abs().div(eps.max ? eps.max(1e-6) : add(eps, 1e-6)).clamp(0, 1); break;
    default: v = a.sub(b).sign().max(0); break;
  }
  return { Result: v };
});
registerEmit('GeometryNodeSwitch', (n, c) => {
  const cond = c.input(n.inputs[0]!).clamp(0, 1);
  const a = c.input(n.inputs[1]!);
  const b = c.input(n.inputs[2]!);
  return { Output: mix(a, b, cond) };
});
registerEmit('FunctionNodeRandomValue', (n, c) => {
  const dataType = (n as unknown as { data_type: string }).data_type;
  const id = c.input(n.inputs[7]!);
  const seed = c.input(n.inputs[8]!);
  const rand = hash1(vec3(id, seed, id.add(seed)));
  const rand2 = hash1(vec3(id.add(17), seed.add(23), id.add(seed).add(5)));
  const rand3 = hash1(vec3(id.add(37), seed.add(47), id.add(seed).add(11)));
  if (dataType === 'FLOAT_VECTOR') {
    const minV = c.input(n.inputs[0]!);
    const maxV = c.input(n.inputs[1]!);
    const rv = vec3(
      mix(minV.x, maxV.x, rand),
      mix(minV.y, maxV.y, rand2),
      mix(minV.z, maxV.z, rand3),
    );
    return { Value_Vector: rv };
  }
  if (dataType === 'INT') {
    const minI = c.input(n.inputs[4]!);
    const maxI = c.input(n.inputs[5]!);
    return { Value_Int: mix(minI, maxI.add(1), rand).floor() };
  }
  if (dataType === 'BOOLEAN') {
    const prob = c.input(n.inputs[6]!);
    return { Value_Bool: rand.lessThan(prob) };
  }
  const minF = c.input(n.inputs[2]!);
  const maxF = c.input(n.inputs[3]!);
  return { Value: mix(minF, maxF, rand) };
});

registerEmit('ShaderNodeValToRGB', (n, c) => {
  // ColorRamp — sample stops in a TSL Fn.
  const t = c.input(n.inputs[0]!).clamp(0, 1);
  const stops = (n as unknown as { stops: { position: number; color: number[] }[] }).stops;
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return { Color: vec4(0, 0, 0, 1), Alpha: float(1) };
  if (sorted.length === 1) {
    const c0 = sorted[0]!.color;
    return { Color: vec4(c0[0]!, c0[1]!, c0[2]!, c0[3] ?? 1), Alpha: float(c0[3] ?? 1) };
  }
  // Chained mix() calls between adjacent stops.
  let result: TSLNode = vec4(sorted[0]!.color[0]!, sorted[0]!.color[1]!, sorted[0]!.color[2]!, sorted[0]!.color[3] ?? 1);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!, b = sorted[i + 1]!;
    const r = Math.max(b.position - a.position, 1e-6);
    const local = t.sub(a.position).div(r).clamp(0, 1);
    const bC = vec4(b.color[0]!, b.color[1]!, b.color[2]!, b.color[3] ?? 1);
    result = mix(result, bC, local.smoothstep(0, 1));
  }
  return { Color: result, Alpha: result.w };
});

/* ---------------------------------------------------------------- */
/*  Shader inputs (varying / scene data)                            */
/* ---------------------------------------------------------------- */
registerEmit('ShaderNodeUVMap', () => ({ UV: vec3(uv().x, uv().y, 0) }));
registerEmit('ShaderNodeTexCoord', () => ({
  Generated: positionLocal,
  Normal: normalWorld,
  UV: vec3(uv().x, uv().y, 0),
  Object: positionLocal,
  Camera: positionWorld,
  Window: vec3(uv().x, uv().y, 0),
  Reflection: normalWorld,
}));
registerEmit('ShaderNodeNewGeometry', () => ({
  Position: positionWorld,
  Normal: normalWorld,
  Tangent: normalWorld,
  'True Normal': normalWorld,
  Incoming: normalWorld,
  Parametric: vec3(uv().x, uv().y, 0),
  Backfacing: float(0),
  Pointiness: float(0),
  'Random Per Island': float(0),
}));
registerEmit('ShaderNodeFresnel', (n, c) => {
  const ior = c.input(n.inputs[0]!);
  const normalIn = n.inputs[1]?.is_linked ? toVec3(c.input(n.inputs[1]!)) : normalWorld;
  // Schlick approximation: f0 = ((1-ior)/(1+ior))^2
  const f0 = sub(float(1), ior).div(add(float(1), ior)).pow(2);
  const ndv = normalIn.normalize().dot(viewVectorWorld()).clamp(0, 1);
  const fac = float(1).sub(ndv);
  return { Fac: f0.add(fac.pow(5).mul(float(1).sub(f0))) };
});
registerEmit('ShaderNodeAttribute', () => {
  const u = uv();
  const fac = u.x;
  return {
    Color: vec4(u.x, u.y, float(1).sub(u.x), 1),
    Vector: vec3(u.x, u.y, 0),
    Fac: fac,
    Alpha: float(1),
  };
});
registerEmit('ShaderNodeLayerWeight', (n, c) => {
  const blend = scalarInputOr(n, 0, c, 0.5).clamp(0, 1);
  const normalIn = n.inputs[1]?.is_linked ? toVec3(c.input(n.inputs[1]!)) : normalWorld;
  const ndv = normalIn.normalize().dot(viewVectorWorld()).clamp(0, 1);
  const exponent = float(1).add(blend.mul(4));
  const facing = ndv.pow(exponent);
  const fresnel = float(1).sub(facing);
  return { Fresnel: fresnel, Facing: facing };
});
registerEmit('ShaderNodeObjectInfo', () => {
  const loc = positionLocal;
  const tint = hash3(positionLocal.floor().add(vec3(1, 3, 5))).mul(0.6).add(vec3(0.2, 0.2, 0.2));
  const rand = hash1(positionLocal.add(vec3(17.0, 29.0, 47.0)));
  return {
    Location: loc,
    Color: vec4(tint, 1),
    Alpha: float(1),
    'Object Index': float(0),
    'Material Index': float(0),
    Random: rand,
  };
});
registerEmit('ShaderNodeCameraData', () => {
  const viewVec = viewVectorWorld();
  const delta = cameraPosition.sub(positionWorld);
  return {
    'View Vector': viewVec,
    'View Z Depth': delta.z.abs(),
    'View Distance': delta.length(),
  };
});
registerEmit('ShaderNodeLightPath', () => ({
  'Is Camera Ray': float(1),
  'Is Shadow Ray': float(0),
  'Is Diffuse Ray': float(0),
  'Is Glossy Ray': float(0),
  'Is Singular Ray': float(0),
  'Is Reflection Ray': float(0),
  'Is Transmission Ray': float(0),
  'Ray Length': viewDistanceWorld(),
  'Ray Depth': float(0),
  'Diffuse Depth': float(0),
  'Glossy Depth': float(0),
  'Transparent Depth': float(0),
  'Transmission Depth': float(0),
}));

/* ---------------------------------------------------------------- */
/*  Procedural textures                                             */
/* ---------------------------------------------------------------- */
registerEmit('ShaderNodeTexNoise', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const scale = c.input(n.inputs[1]!);
  // mx_noise_float from MaterialX is shipped in three/tsl. If it isn't
  // available at runtime, fall back to a simple hash noise (still TSL).
  const coords = v.mul(scale);
  let noise: TSLNode;
  const tslAny = TSL as unknown as Record<string, unknown>;
  if (typeof tslAny['mx_noise_float'] === 'function') {
    noise = (tslAny['mx_noise_float'] as (c: TSLNode) => TSLNode)(coords);
  } else if (typeof tslAny['triNoise3D'] === 'function') {
    noise = (tslAny['triNoise3D'] as (a: TSLNode, b: TSLNode, c: TSLNode) => TSLNode)(coords, float(0.5), float(0));
  } else {
    // Hash-based pseudo-noise: fract(sin(dot(p, k)) * c)
    noise = coords.dot(vec3(12.9898, 78.233, 37.719)).sin().mul(43758.5453).fract();
  }
  return { Fac: noise, Color: vec4(noise, noise, noise, 1) };
});
registerEmit('ShaderNodeTexVoronoi', (n, c) => {
  const p = generatedVector(n, 0, c).mul(scalarInputOr(n, 1, c, 5));
  const cell = p.floor();
  const local = p.fract().sub(vec3(0.5, 0.5, 0.5));
  const randomness = scalarInputOr(n, 4, c, 1).clamp(0, 1);
  const jitter = hash3(cell).sub(vec3(0.5, 0.5, 0.5)).mul(randomness);
  const position = cell.add(jitter);
  const delta = local.sub(jitter);
  const distance = delta.length().clamp(0, 1);
  return {
    Distance: distance,
    Color: vec4(hash3(cell), 1),
    Position: position,
  };
});
registerEmit('ShaderNodeTexWave', (n, c) => {
  const p = generatedVector(n, 0, c);
  const scale = scalarInputOr(n, 1, c, 5);
  const distortion = scalarInputOr(n, 2, c, 0);
  const phase = scalarInputOr(n, 6, c, 0);
  const waveType = (n as unknown as { wave_type?: string }).wave_type ?? 'BANDS';
  const base = waveType === 'RINGS'
    ? p.length().mul(scale)
    : p.x.add(p.y).add(p.z).mul(scale.mul(0.3333));
  const wobble = hash1(p.mul(scale).floor()).mul(distortion);
  const fac = base.add(wobble).add(phase).mul(Math.PI * 2).sin().mul(0.5).add(0.5).clamp(0, 1);
  return { Color: vec4(fac, fac, fac, 1), Fac: fac };
});

registerEmit('ShaderNodeTexChecker', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const scale = c.input(n.inputs[3]!);
  // Reproduce blender's 3D checker: parity of floor(p * scale).
  const p = v.mul(scale).floor();
  const parity = p.x.add(p.y).add(p.z).mod(2).abs();
  const c1 = c.input(n.inputs[1]!);
  const c2 = c.input(n.inputs[2]!);
  const result = mix(c1, c2, parity);
  return { Color: result, Fac: parity };
});
registerEmit('ShaderNodeTexBrick', (n, c) => {
  const p = generatedVector(n, 0, c);
  const scale = scalarInputOr(n, 4, c, 5);
  const mortarSize = scalarInputOr(n, 5, c, 0.02).clamp(0.0001, 0.45);
  const mortarSmooth = scalarInputOr(n, 6, c, 0).max(0.0001);
  const rowHeight = scalarInputOr(n, 9, c, 0.25).max(0.0001);
  const brickWidth = scalarInputOr(n, 8, c, 0.5).max(0.0001);
  const pp = vec3(p.x.div(brickWidth), p.y.div(rowHeight), p.z).mul(scale);
  const row = pp.y.floor();
  const brickX = pp.x.add(row.mod(2).mul(0.5));
  const cell = vec3(brickX.floor(), row, 0);
  const local = vec3(brickX.fract(), pp.y.fract(), 0);
  const edge = local.x.min(float(1).sub(local.x)).min(local.y.min(float(1).sub(local.y)));
  const brickMask = edge.smoothstep(mortarSize, mortarSize.add(mortarSmooth));
  const parity = cell.x.add(cell.y).mod(2).abs();
  const brickColor = mix(c.input(n.inputs[1]!), c.input(n.inputs[2]!), parity);
  const mortarColor = c.input(n.inputs[3]!);
  const out = mix(mortarColor, brickColor, brickMask);
  return { Color: out, Fac: brickMask };
});

registerEmit('ShaderNodeTexGradient', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const type = (n as unknown as { gradient_type: string }).gradient_type;
  let f: TSLNode;
  switch (type) {
    case 'LINEAR': f = v.x.add(0.5).clamp(0, 1); break;
    case 'QUADRATIC': f = v.x.add(0.5).clamp(0, 1).pow(2); break;
    case 'EASING': { const t = v.x.add(0.5).clamp(0, 1); f = t.mul(t).mul(t.mul(-2).add(3)); break; }
    case 'DIAGONAL': f = v.x.add(v.y).mul(0.5).add(0.5).clamp(0, 1); break;
    case 'SPHERICAL': f = float(1).sub(v.length()).max(0); break;
    case 'QUADRATIC_SPHERE': { const r = float(1).sub(v.length()).max(0); f = r.mul(r); break; }
    case 'RADIAL': f = v.y.atan2 ? v.y.atan2(v.x).mul(0.5 / Math.PI).add(0.5) : float(0.5); break;
    default: f = v.x.add(0.5);
  }
  return { Color: vec4(f, f, f, 1), Fac: f };
});

registerEmit('ShaderNodeTexWhiteNoise', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const seed = v.dot(vec3(127.1, 311.7, 74.7)).sin().mul(43758.5453).fract();
  return { Value: seed, Color: vec4(seed, seed, seed, 1) };
});
registerEmit('ShaderNodeTexMagic', (n, c) => {
  const p = generatedVector(n, 0, c).mul(scalarInputOr(n, 1, c, 5));
  const distortion = scalarInputOr(n, 2, c, 1);
  const a = p.x.add(p.y).add(p.z.mul(0.5)).sin();
  const b = p.x.mul(1.7).sub(p.y.mul(1.3)).add(p.z).cos();
  const cc = p.x.mul(p.y.add(1)).add(p.z.mul(distortion)).sin();
  const colorOut = vec4(
    a.mul(0.5).add(0.5),
    b.mul(0.5).add(0.5),
    cc.mul(0.5).add(0.5),
    1,
  );
  const fac = colorOut.x.add(colorOut.y).add(colorOut.z).mul(0.3333);
  return { Color: colorOut, Fac: fac };
});
registerEmit('ShaderNodeTexImage', (n, c) => {
  const p = generatedVector(n, 0, c);
  const extension = (n as unknown as { extension?: string }).extension ?? 'REPEAT';
  const uvNode = wrapUv(p.x, p.y, extension);
  const key = (n as unknown as { image_src?: string }).image_src ?? '';
  const resolved = key ? sampleResolvedTexture(c, key, 'IMAGE', uvNode) : null;
  if (resolved) {
    return { Color: resolved, Alpha: resolved.a ?? resolved.w ?? float(1) };
  }
  const colorOut = vec4(uvNode.x, uvNode.y, hash1(p.floor()), 1);
  return { Color: colorOut, Alpha: float(1) };
});
registerEmit('ShaderNodeTexEnvironment', (n, c) => {
  const dir = vectorInputOr(n, 0, c, reflectVector).normalize();
  const u = dir.z.atan2 ? dir.z.atan2(dir.x).mul(0.5 / Math.PI).add(0.5) : dir.x.mul(0.5).add(0.5);
  const v = dir.y.clamp(-1, 1).mul(0.5).add(0.5);
  const uvNode = wrapUv(u, v, 'REPEAT');
  const key = (n as unknown as { image_src?: string }).image_src ?? n.id;
  const resolved = sampleResolvedTexture(c, key, 'ENVIRONMENT', uvNode);
  if (resolved) return { Color: resolved };
  const horizon = dir.y.mul(0.5).add(0.5).clamp(0, 1);
  const sky = vec3(0.12, 0.28, 0.65);
  const ground = vec3(0.18, 0.14, 0.10);
  const base = mix(vec4(ground, 1), vec4(sky, 1), horizon);
  const sun = dir.z.max(0).pow(32).mul(0.6);
  return { Color: vec4(base.xyz.add(vec3(sun, sun.mul(0.85), sun.mul(0.55))), 1) };
});

/* ---------------------------------------------------------------- */
/*  Vector ops                                                      */
/* ---------------------------------------------------------------- */
registerEmit('ShaderNodeMapping', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const loc = c.input(n.inputs[1]!);
  const rot = c.input(n.inputs[2]!);
  const scl = c.input(n.inputs[3]!);
  // Blender Mapping applies scale, Euler rotation, then translation for POINT/TEXTURE modes.
  // This approximation keeps VECTOR/NORMAL type semantics flowing while finally honoring rotation.
  return { Vector: rotateEulerXYZ(v.mul(scl), rot).add(loc) };
});

registerEmit('ShaderNodeNormalMap', (n, c) => {
  const strength = c.input(n.inputs[0]!);
  const c0 = c.input(n.inputs[1]!);
  // tangent-space normal (rgb*2-1) lerped toward (0,0,1) by 1-strength
  const sampled = c0.xyz.mul(2).sub(1);
  const flat = vec3(0, 0, 1);
  return { Normal: mix(flat, sampled, strength.clamp(0, 1)) };
});

registerEmit('ShaderNodeBump', (n, c) => {
  // Stub: pass-through input normal + strength scaling.
  const normal = c.input(n.inputs[3]!);
  return { Normal: normal };
});

registerEmit('ShaderNodeVectorRotate', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const center = c.input(n.inputs[1]!);
  const axis = c.input(n.inputs[2]!);
  const angle = c.input(n.inputs[3]!);
  const rot = c.input(n.inputs[4]!);
  const type = (n as unknown as { rotation_type?: string }).rotation_type ?? 'AXIS_ANGLE';
  const local = v.sub(center);
  let out: TSLNode;
  switch (type) {
    case 'X_AXIS': out = rotateX(local, angle); break;
    case 'Y_AXIS': out = rotateY(local, angle); break;
    case 'Z_AXIS': out = rotateZ(local, angle); break;
    case 'EULER_XYZ': out = rotateEulerXYZ(local, rot); break;
    default: out = rotateAxisAngle(local, axis, angle); break;
  }
  return { Vector: out.add(center) };
});

registerEmit('ShaderNodeDisplacement', (n, c) => {
  const height = c.input(n.inputs[0]!);
  const mid = c.input(n.inputs[1]!);
  const scale = c.input(n.inputs[2]!);
  const normal = c.input(n.inputs[3]!);
  return { Displacement: normal.mul(height.sub(mid).mul(scale)) };
});

registerEmit('ShaderNodeVectorDisplacement', (n, c) => {
  const v = c.input(n.inputs[0]!);
  const mid = c.input(n.inputs[1]!);
  const scale = c.input(n.inputs[2]!);
  const xyz = v.xyz ? v.xyz : vec3(v.x, v.y, v.z);
  return { Displacement: xyz.sub(vec3(mid, mid, mid)).mul(scale) };
});

/* ---------------------------------------------------------------- */
/*  Shader closures                                                  */
/* ---------------------------------------------------------------- */
registerEmit('ShaderNodeBsdfPrincipled', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const metalness = c.input(n.inputs[1]!);
  const roughness = c.input(n.inputs[2]!);
  const ior = c.input(n.inputs[3]!);
  const alpha = c.input(n.inputs[4]!);
  const _normal = c.input(n.inputs[5]!); void _normal;
  const emissiveColor = c.input(n.inputs[6]!);
  const emissiveStrength = c.input(n.inputs[7]!);
  const desc: TSLMaterialDescriptor = {
    colorNode: baseColor,
    metalnessNode: metalness,
    roughnessNode: roughness,
    iorNode: ior,
    opacityNode: alpha,
    emissiveNode: emissiveColor.xyz ? emissiveColor.xyz.mul(emissiveStrength) : mul(emissiveColor, emissiveStrength),
  };
  return { BSDF: desc as unknown as TSLNode };
});

registerEmit('ShaderNodeBsdfDiffuse', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const roughness = c.input(n.inputs[1]!);
  return {
    BSDF: {
      colorNode: baseColor,
      roughnessNode: roughness.max(0.5),  // diffuse → high roughness in PBR
      metalnessNode: float(0),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeBsdfGlossy', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const roughness = c.input(n.inputs[1]!);
  return {
    BSDF: {
      colorNode: baseColor,
      roughnessNode: roughness,
      metalnessNode: float(1),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeBsdfRefraction', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const roughness = c.input(n.inputs[1]!);
  const ior = c.input(n.inputs[2]!);
  return {
    BSDF: {
      colorNode: baseColor,
      roughnessNode: roughness,
      iorNode: ior,
      transmissionNode: float(1),
      opacityNode: float(0.35),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeBsdfGlass', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const roughness = c.input(n.inputs[1]!);
  const ior = c.input(n.inputs[2]!);
  return {
    BSDF: {
      colorNode: baseColor,
      roughnessNode: roughness,
      iorNode: ior,
      transmissionNode: float(1),
      opacityNode: float(0.5),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeBsdfTransparent', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  return {
    BSDF: {
      colorNode: baseColor,
      opacityNode: float(0),
      transmissionNode: float(1),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeBsdfTranslucent', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  return { BSDF: { colorNode: baseColor, roughnessNode: float(1), opacityNode: float(0.6) } as unknown as TSLNode };
});

registerEmit('ShaderNodeBsdfSheen', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const roughness = c.input(n.inputs[1]!);
  return { BSDF: { colorNode: baseColor, roughnessNode: roughness.max(0.7), metalnessNode: float(0) } as unknown as TSLNode };
});

registerEmit('ShaderNodeBsdfToon', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const smooth = c.input(n.inputs[2]!);
  return { BSDF: { colorNode: baseColor, roughnessNode: float(1).sub(smooth.clamp(0, 1).mul(0.5)), metalnessNode: float(0) } as unknown as TSLNode };
});

registerEmit('ShaderNodeSubsurfaceScattering', (n, c) => {
  const baseColor = c.input(n.inputs[0]!);
  const roughness = c.input(n.inputs[4]!);
  return { BSSRDF: { colorNode: baseColor, roughnessNode: roughness.max(0.8), opacityNode: float(0.9) } as unknown as TSLNode };
});

registerEmit('ShaderNodeEmission', (n, c) => {
  const col = c.input(n.inputs[0]!);
  const str = c.input(n.inputs[1]!);
  return {
    Emission: {
      colorNode: vec4(0, 0, 0, 1),
      emissiveNode: col.xyz ? col.xyz.mul(str) : mul(col, str),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeBackground', (n, c) => {
  const col = c.input(n.inputs[0]!);
  const str = c.input(n.inputs[1]!);
  return {
    Background: {
      colorNode: vec4(0, 0, 0, 1),
      emissiveNode: col.xyz ? col.xyz.mul(str) : mul(col, str),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeHoldout', () => ({
  Holdout: { colorNode: vec4(0, 0, 0, 1), opacityNode: float(0) } as unknown as TSLNode,
}));

registerEmit('ShaderNodeVolumeAbsorption', (n, c) => {
  const col = c.input(n.inputs[0]!);
  const density = c.input(n.inputs[1]!);
  return {
    Volume: {
      colorNode: vec4(0, 0, 0, 1),
      emissiveNode: col.xyz ? col.xyz.mul(density.mul(0.15)) : mul(col, density.mul(0.15)),
      opacityNode: float(1).sub(density.mul(0.1)).clamp(0, 1),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeVolumeScatter', (n, c) => {
  const col = c.input(n.inputs[0]!);
  const density = c.input(n.inputs[1]!);
  return {
    Volume: {
      colorNode: vec4(0, 0, 0, 1),
      emissiveNode: col.xyz ? col.xyz.mul(density.mul(0.12)) : mul(col, density.mul(0.12)),
      opacityNode: float(1).sub(density.mul(0.08)).clamp(0, 1),
    } as unknown as TSLNode,
  };
});

registerEmit('ShaderNodeMixShader', (n, c) => {
  const fac = c.input(n.inputs[0]!);
  const a = c.input(n.inputs[1]!) as unknown as TSLMaterialDescriptor;
  const b = c.input(n.inputs[2]!) as unknown as TSLMaterialDescriptor;
  return { Shader: mixDescriptors(a, b, fac) as unknown as TSLNode };
});

registerEmit('ShaderNodeAddShader', (n, c) => {
  const a = c.input(n.inputs[0]!) as unknown as TSLMaterialDescriptor;
  const b = c.input(n.inputs[1]!) as unknown as TSLMaterialDescriptor;
  return { Shader: addDescriptors(a, b) as unknown as TSLNode };
});

/* ---------------------------------------------------------------- */
/*  Helpers — descriptor combination                                */
/* ---------------------------------------------------------------- */
function mixDescriptors(a: TSLMaterialDescriptor, b: TSLMaterialDescriptor, f: TSLNode): TSLMaterialDescriptor {
  const m = (x?: TSLNode, y?: TSLNode): TSLNode | undefined => {
    if (x && y) return mix(x, y, f);
    return x ?? y;
  };
  return {
    colorNode: m(a.colorNode, b.colorNode),
    metalnessNode: m(a.metalnessNode, b.metalnessNode),
    roughnessNode: m(a.roughnessNode, b.roughnessNode),
    normalNode: m(a.normalNode, b.normalNode),
    emissiveNode: m(a.emissiveNode, b.emissiveNode),
    opacityNode: m(a.opacityNode, b.opacityNode),
    iorNode: m(a.iorNode, b.iorNode),
    transmissionNode: m(a.transmissionNode, b.transmissionNode),
  };
}
function addDescriptors(a: TSLMaterialDescriptor, b: TSLMaterialDescriptor): TSLMaterialDescriptor {
  const s = (x?: TSLNode, y?: TSLNode): TSLNode | undefined => {
    if (x && y) return x.add ? x.add(y) : add(x, y);
    return x ?? y;
  };
  return {
    colorNode: s(a.colorNode, b.colorNode),
    metalnessNode: a.metalnessNode ?? b.metalnessNode,
    roughnessNode: a.roughnessNode ?? b.roughnessNode,
    normalNode: a.normalNode ?? b.normalNode,
    emissiveNode: s(a.emissiveNode, b.emissiveNode),
    opacityNode: a.opacityNode ?? b.opacityNode,
    iorNode: a.iorNode ?? b.iorNode,
    transmissionNode: a.transmissionNode ?? b.transmissionNode,
  };
}

/* ---------------------------------------------------------------- */
/*  Evaluator                                                        */
/* ---------------------------------------------------------------- */
export class TSLShaderEvaluator implements SystemEvaluator {
  constructor(private opts: TSLShaderEvaluatorOptions = {}) {}

  /** Last complete output — returned as-is when dirty set is empty and same tree. */
  private _lastOutput: { descriptor: TSLMaterialDescriptor; material: unknown } | null = null;
  private _lastTreeId: string | null = null;

  /** Wipe cached output (called by Depsgraph on topology changes). */
  clearPersistentCache(): void {
    this._lastOutput = null;
    this._lastTreeId = null;
  }

  evaluate(tree: NodeTree, dirty: ReadonlySet<Node>): EvaluationResult {
    const start = performance.now();

    // Fast path: nothing changed AND same tree — reuse last material.
    if (this._lastOutput !== null && dirty.size === 0 && this._lastTreeId === tree.id) {
      return {
        output: this._lastOutput,
        duration_ms: 0,
        node_timings: new Map(),
        errors: new Map(),
      };
    }
    this._lastTreeId = tree.id;

    const cache: Cache = new Map();
    const timings = new Map<string, number>();
    const errors = new Map<string, string>();

    const ctx: EmitContext = {
      cache,
      input: (socket) => this.resolveInput(socket, cache),
      resolveTexture: this.opts.resolveTexture,
    };

    const order = tree.topoOrder();
    for (const node of order) {
      const t0 = performance.now();
      try {
        if (node.mute) this.passthroughMuted(node, ctx);
        else if (node.bl_idname === 'NodeGroupInput') { /* seeded by group container */ }
        else if (node.bl_idname === 'NodeGroupOutput') { /* read by group container */ }
        else if ((node as { resolvedTree?: NodeTree }).resolvedTree !== undefined || node.bl_idname.endsWith('NodeGroup')) {
          this.emitGroup(node, ctx, 0);
        } else {
          this.emitNode(node, ctx);
        }
      } catch (e) {
        errors.set(node.id, (e as Error).message);
      }
      timings.set(node.id, performance.now() - t0);
    }

    const output = order.find((n) => n.bl_idname === 'ShaderNodeOutputMaterial')
      ?? order.find((n) => n.bl_idname === 'ShaderNodeOutputWorld')
      ?? order.find((n) => n.bl_idname === 'ShaderNodeOutputLight');
    let desc: TSLMaterialDescriptor = { colorNode: color(0.8, 0.8, 0.8), roughnessNode: float(0.5), metalnessNode: float(0) };
    if (output) {
      const surface = output.inputs[0];
      if (surface) {
        const surfaceDesc = this.resolveInput(surface, cache) as TSLMaterialDescriptor | undefined;
        if (surfaceDesc && typeof surfaceDesc === 'object') desc = surfaceDesc;
      }
      if (output.bl_idname === 'ShaderNodeOutputMaterial') {
        const displacement = output.inputs[2];
        if (displacement && displacement.is_linked) {
          const d = this.resolveInput(displacement, cache);
          if (d) desc.positionNode = positionLocal.add(d);
        }
      }
    }

    // Construct the material on demand. If WebGPU isn't available, the
    // viewport may still consume the descriptor by reading the literal
    // default_value fallbacks.
    let material: TWG.MeshStandardNodeMaterial | null = null;
    try {
      material = new TWG.MeshStandardNodeMaterial();
      if (desc.colorNode) material.colorNode = desc.colorNode;
      if (desc.metalnessNode) material.metalnessNode = desc.metalnessNode;
      if (desc.roughnessNode) material.roughnessNode = desc.roughnessNode;
      if (desc.normalNode) material.normalNode = desc.normalNode;
      if (desc.emissiveNode) material.emissiveNode = desc.emissiveNode;
      if (desc.opacityNode) {
        material.opacityNode = desc.opacityNode;
        material.transparent = true;
      }
      if (desc.positionNode) material.positionNode = desc.positionNode;
    } catch (e) {
      errors.set('__material__', (e as Error).message);
    }

    this._lastOutput = { descriptor: desc, material };
    return {
      output: this._lastOutput,
      duration_ms: performance.now() - start,
      node_timings: timings,
      errors,
    };
  }

  private passthroughMuted(node: Node, ctx: EmitContext): void {
    const links = node.computeInternalLinks();
    for (const out of node.outputs) {
      const inSock = links.get(out.id);
      ctx.cache.set(out.id, inSock ? this.resolveInput(inSock, ctx.cache) : this.literalFor(out));
    }
  }

  private emitGroup(node: Node, ctx: EmitContext, depth: number): void {
    const child = (node as { resolvedTree?: NodeTree }).resolvedTree;
    if (!child || depth > 64) {
      for (const out of node.outputs) ctx.cache.set(out.id, this.literalFor(out));
      return;
    }
    const giInput = child.nodes.find((n) => n.bl_idname === 'NodeGroupInput');
    const giOutput = child.nodes.find((n) => n.bl_idname === 'NodeGroupOutput');
    if (giInput) {
      for (const o of giInput.outputs) {
        const containerIn = node.inputs.find((sk) => sk.identifier === o.identifier);
        ctx.cache.set(o.id, containerIn ? this.resolveInput(containerIn, ctx.cache) : this.literalFor(o));
      }
    }
    for (const inner of child.topoOrder()) {
      if (inner === giInput) continue;
      try {
        if (inner.mute) this.passthroughMuted(inner, ctx);
        else if ((inner as { resolvedTree?: NodeTree }).resolvedTree !== undefined) this.emitGroup(inner, ctx, depth + 1);
        else if (inner.bl_idname === 'NodeGroupOutput') { /* skip */ }
        else this.emitNode(inner, ctx);
      } catch { /* keep flowing */ }
    }
    for (const out of node.outputs) {
      let v: TSLNode | undefined;
      if (giOutput) {
        const innerIn = giOutput.inputs.find((sk) => sk.identifier === out.identifier);
        v = innerIn ? this.resolveInput(innerIn, ctx.cache) : undefined;
      }
      ctx.cache.set(out.id, v !== undefined ? v : this.literalFor(out));
    }
  }

  private resolveInput(socket: NodeSocket, cache: Cache): TSLNode {
    if (socket.is_linked) {
      const link = socket.links[0];
      if (link && link.is_valid && !link.is_muted) {
        const upstream = cache.get(link.from_socket.id);
        if (upstream !== undefined) return upstream;
      }
    }
    return this.literalFor(socket);
  }

  /** Convert a default_value to a TSL literal of the right kind. */
  private literalFor(socket: NodeSocket): TSLNode {
    const v = socket.default_value;
    if (typeof v === 'number') return float(v);
    if (typeof v === 'boolean') return float(v ? 1 : 0);
    if (Array.isArray(v)) {
      if (v.length >= 4) return vec4(v[0]!, v[1]!, v[2]!, v[3]!);
      if (v.length >= 3) return vec3(v[0]!, v[1]!, v[2]!);
      if (v.length >= 2) return vec3(v[0]!, v[1]!, 0);
    }
    return float(0);
  }

  private emitNode(node: Node, ctx: EmitContext): void {
    const fn = EMITTERS.get(node.bl_idname);
    if (!fn) {
      // Unknown — propagate literal defaults for outputs.
      for (const out of node.outputs) ctx.cache.set(out.id, this.literalFor(out));
      return;
    }
    const outputs = fn(node, ctx);
    for (const out of node.outputs) {
      // Match by identifier first, then by name (Blender's lookup order).
      const v = outputs[out.identifier] ?? outputs[out.name];
      ctx.cache.set(out.id, v !== undefined ? v : this.literalFor(out));
    }
  }
}
