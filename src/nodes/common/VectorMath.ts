/**
 * Vector Math node — present in Shader / Geometry / Compositor / Texture.
 * Mirrors Blender's ShaderNodeVectorMath operation set.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind, Vec3 } from '../../core/types';
import { NodeSocketVector, NodeSocketFloat } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export const VEC_MATH_OPS = [
  'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD',
  'CROSS_PRODUCT', 'PROJECT', 'REFLECT', 'REFRACT', 'FACEFORWARD', 'DOT_PRODUCT',
  'DISTANCE', 'LENGTH', 'SCALE', 'NORMALIZE',
  'ABSOLUTE', 'MINIMUM', 'MAXIMUM', 'FLOOR', 'CEIL', 'FRACTION', 'MODULO',
  'WRAP', 'SNAP', 'SINE', 'COSINE', 'TANGENT',
] as const;
export type VecMathOp = (typeof VEC_MATH_OPS)[number];

const OP_ITEMS = VEC_MATH_OPS.map((op) =>
  [op, op.replace(/_/g, ' ').toLowerCase().replace(/\b./g, (c) => c.toUpperCase()), op] as const);

/** Single-vector output ops. */
const VEC_OUT: ReadonlySet<VecMathOp> = new Set([
  'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD',
  'CROSS_PRODUCT', 'PROJECT', 'REFLECT', 'REFRACT', 'FACEFORWARD',
  'SCALE', 'NORMALIZE',
  'ABSOLUTE', 'MINIMUM', 'MAXIMUM', 'FLOOR', 'CEIL', 'FRACTION', 'MODULO',
  'WRAP', 'SNAP', 'SINE', 'COSINE', 'TANGENT',
]);
/** Scalar output ops. */
const FLOAT_OUT: ReadonlySet<VecMathOp> = new Set(['DOT_PRODUCT', 'DISTANCE', 'LENGTH']);

export class VectorMathNode extends Node {
  static override bl_idname = 'ShaderNodeVectorMath';
  static override bl_label = 'Vector Math';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = [
    'ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree',
  ];
  static override bl_width_default = 150;
  static override properties = {
    operation: EnumProperty({ items: OP_ITEMS, default: 'ADD', name: 'Operation' }),
  };
  declare operation: VecMathOp;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'A', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'B', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'C', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 1 });
    this.addOutput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketFloat, 'Value');
  }

  static compute(op: VecMathOp, a: Vec3, b: Vec3, c: Vec3, scale: number): { vec: Vec3; val: number } {
    let vec: Vec3 = [0, 0, 0];
    let val = 0;
    const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    const len = (x: Vec3) => Math.hypot(x[0], x[1], x[2]);
    const norm = (x: Vec3): Vec3 => {
      const l = len(x) || 1;
      return [x[0] / l, x[1] / l, x[2] / l];
    };
    switch (op) {
      case 'ADD': vec = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; break;
      case 'SUBTRACT': vec = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; break;
      case 'MULTIPLY': vec = [a[0] * b[0], a[1] * b[1], a[2] * b[2]]; break;
      case 'DIVIDE': vec = [b[0] === 0 ? 0 : a[0] / b[0], b[1] === 0 ? 0 : a[1] / b[1], b[2] === 0 ? 0 : a[2] / b[2]]; break;
      case 'MULTIPLY_ADD': vec = [a[0] * b[0] + c[0], a[1] * b[1] + c[1], a[2] * b[2] + c[2]]; break;
      case 'CROSS_PRODUCT': vec = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; break;
      case 'PROJECT': { const d = dot(b, b); const f = d === 0 ? 0 : dot(a, b) / d; vec = [b[0] * f, b[1] * f, b[2] * f]; break; }
      case 'REFLECT': { const d = 2 * dot(a, b); vec = [a[0] - d * b[0], a[1] - d * b[1], a[2] - d * b[2]]; break; }
      case 'REFRACT': {
        const eta = scale;
        const cosI = -dot(b, a);
        const k = 1 - eta * eta * (1 - cosI * cosI);
        if (k < 0) vec = [0, 0, 0];
        else {
          const f = eta * cosI - Math.sqrt(k);
          vec = [eta * a[0] + f * b[0], eta * a[1] + f * b[1], eta * a[2] + f * b[2]];
        }
        break;
      }
      case 'FACEFORWARD': vec = dot(b, c) < 0 ? [...a] : [-a[0], -a[1], -a[2]]; break;
      case 'DOT_PRODUCT': val = dot(a, b); break;
      case 'DISTANCE': val = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); break;
      case 'LENGTH': val = len(a); break;
      case 'SCALE': vec = [a[0] * scale, a[1] * scale, a[2] * scale]; break;
      case 'NORMALIZE': vec = norm(a); break;
      case 'ABSOLUTE': vec = [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2])]; break;
      case 'MINIMUM': vec = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])]; break;
      case 'MAXIMUM': vec = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]; break;
      case 'FLOOR': vec = [Math.floor(a[0]), Math.floor(a[1]), Math.floor(a[2])]; break;
      case 'CEIL': vec = [Math.ceil(a[0]), Math.ceil(a[1]), Math.ceil(a[2])]; break;
      case 'FRACTION': vec = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1]), a[2] - Math.floor(a[2])]; break;
      case 'MODULO':
        vec = [
          b[0] === 0 ? 0 : a[0] - Math.floor(a[0] / b[0]) * b[0],
          b[1] === 0 ? 0 : a[1] - Math.floor(a[1] / b[1]) * b[1],
          b[2] === 0 ? 0 : a[2] - Math.floor(a[2] / b[2]) * b[2],
        ];
        break;
      case 'WRAP': {
        const w = (x: number, mx: number, mn: number) => {
          const r = mx - mn;
          return r === 0 ? mn : x - r * Math.floor((x - mn) / r);
        };
        vec = [w(a[0], b[0], c[0]), w(a[1], b[1], c[1]), w(a[2], b[2], c[2])];
        break;
      }
      case 'SNAP':
        vec = [
          b[0] === 0 ? 0 : Math.floor(a[0] / b[0]) * b[0],
          b[1] === 0 ? 0 : Math.floor(a[1] / b[1]) * b[1],
          b[2] === 0 ? 0 : Math.floor(a[2] / b[2]) * b[2],
        ];
        break;
      case 'SINE': vec = [Math.sin(a[0]), Math.sin(a[1]), Math.sin(a[2])]; break;
      case 'COSINE': vec = [Math.cos(a[0]), Math.cos(a[1]), Math.cos(a[2])]; break;
      case 'TANGENT': vec = [Math.tan(a[0]), Math.tan(a[1]), Math.tan(a[2])]; break;
    }
    return { vec, val };
  }

  vectorOut(): boolean { return VEC_OUT.has(this.operation); }
  floatOut(): boolean { return FLOAT_OUT.has(this.operation); }
}

let _registered = false;
export function registerVectorMathNode(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(VectorMathNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
