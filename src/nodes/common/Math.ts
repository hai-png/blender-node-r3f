/**
 * Math node — present in all four systems.
 * Mirrors Blender's ShaderNodeMath / GeometryNodeMath / CompositorNodeMath /
 * TextureNodeMath, which all share the same operation set.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, BoolProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeSocketFloat } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export const MATH_OPS = [
  // arithmetic
  'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD',
  // power & log
  'POWER', 'LOGARITHM', 'SQRT', 'INVERSE_SQRT', 'ABSOLUTE', 'EXPONENT',
  // comparison
  'MINIMUM', 'MAXIMUM', 'LESS_THAN', 'GREATER_THAN', 'SIGN', 'COMPARE', 'SMOOTH_MIN', 'SMOOTH_MAX',
  // rounding
  'ROUND', 'FLOOR', 'CEIL', 'TRUNC', 'FRACT', 'MODULO', 'WRAP', 'SNAP', 'PINGPONG',
  // trig
  'SINE', 'COSINE', 'TANGENT', 'ARCSINE', 'ARCCOSINE', 'ARCTANGENT', 'ARCTAN2',
  'SINH', 'COSH', 'TANH',
  // conversion
  'RADIANS', 'DEGREES',
] as const;
export type MathOp = (typeof MATH_OPS)[number];

const OP_ITEMS = MATH_OPS.map((op) => [op, op.replace(/_/g, ' ').toLowerCase().replace(/\b./g, (c) => c.toUpperCase()), op] as const);

const TWO_ARG: ReadonlySet<MathOp> = new Set<MathOp>([
  'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'POWER', 'LOGARITHM',
  'MINIMUM', 'MAXIMUM', 'LESS_THAN', 'GREATER_THAN', 'MODULO',
  'SNAP', 'PINGPONG', 'ARCTAN2', 'SMOOTH_MIN', 'SMOOTH_MAX',
]);
const THREE_ARG: ReadonlySet<MathOp> = new Set<MathOp>(['MULTIPLY_ADD', 'COMPARE', 'WRAP']);

export class MathNode extends Node {
  static override bl_idname = 'ShaderNodeMath';
  static override bl_label = 'Math';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override bl_width_default = 150;
  static override properties = {
    operation: EnumProperty({ items: OP_ITEMS, default: 'ADD', name: 'Operation' }),
    use_clamp: BoolProperty({ default: false, name: 'Clamp' }),
  };
  declare operation: MathOp;
  declare use_clamp: boolean;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'A', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'B', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'C', { default_value: 0 });
    this.addOutput(NodeSocketFloat, 'Value');
  }

  /** Pure CPU implementation, used by every evaluator that needs a literal value. */
  static compute(op: MathOp, a: number, b: number, c: number, clamp = false): number {
    let v = 0;
    switch (op) {
      case 'ADD': v = a + b; break;
      case 'SUBTRACT': v = a - b; break;
      case 'MULTIPLY': v = a * b; break;
      case 'DIVIDE': v = b === 0 ? 0 : a / b; break;
      case 'MULTIPLY_ADD': v = a * b + c; break;
      case 'POWER': v = Math.pow(a, b); break;
      case 'LOGARITHM': v = Math.log(a) / Math.log(b); break;
      case 'SQRT': v = Math.sqrt(a); break;
      case 'INVERSE_SQRT': v = 1 / Math.sqrt(a); break;
      case 'ABSOLUTE': v = Math.abs(a); break;
      case 'EXPONENT': v = Math.exp(a); break;
      case 'MINIMUM': v = Math.min(a, b); break;
      case 'MAXIMUM': v = Math.max(a, b); break;
      case 'LESS_THAN': v = a < b ? 1 : 0; break;
      case 'GREATER_THAN': v = a > b ? 1 : 0; break;
      case 'SIGN': v = Math.sign(a); break;
      case 'COMPARE': v = Math.abs(a - b) <= c ? 1 : 0; break;
      case 'SMOOTH_MIN': {
        const k = Math.max(c, 1e-6);
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        v = Math.min(a, b) - (h * h * k) / 4;
        break;
      }
      case 'SMOOTH_MAX': {
        const k = Math.max(c, 1e-6);
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        v = Math.max(a, b) + (h * h * k) / 4;
        break;
      }
      case 'ROUND': v = Math.round(a); break;
      case 'FLOOR': v = Math.floor(a); break;
      case 'CEIL': v = Math.ceil(a); break;
      case 'TRUNC': v = Math.trunc(a); break;
      case 'FRACT': v = a - Math.floor(a); break;
      case 'MODULO': v = b === 0 ? 0 : a - Math.floor(a / b) * b; break;
      case 'WRAP': {
        const range = b - c;
        v = range === 0 ? c : a - range * Math.floor((a - c) / range);
        break;
      }
      case 'SNAP': v = b === 0 ? 0 : Math.floor(a / b) * b; break;
      case 'PINGPONG': {
        const m = Math.abs(((a / (2 * b)) % 1) * 2 * b);
        v = b === 0 ? 0 : m > b ? 2 * b - m : m;
        break;
      }
      case 'SINE': v = Math.sin(a); break;
      case 'COSINE': v = Math.cos(a); break;
      case 'TANGENT': v = Math.tan(a); break;
      case 'ARCSINE': v = Math.asin(a); break;
      case 'ARCCOSINE': v = Math.acos(a); break;
      case 'ARCTANGENT': v = Math.atan(a); break;
      case 'ARCTAN2': v = Math.atan2(a, b); break;
      case 'SINH': v = Math.sinh(a); break;
      case 'COSH': v = Math.cosh(a); break;
      case 'TANH': v = Math.tanh(a); break;
      case 'RADIANS': v = (a * Math.PI) / 180; break;
      case 'DEGREES': v = (a * 180) / Math.PI; break;
    }
    return clamp ? Math.max(0, Math.min(1, v)) : v;
  }

  /** Show only the sockets relevant to the chosen operation (B/C dimmed). */
  visibleArgCount(): 1 | 2 | 3 {
    if (THREE_ARG.has(this.operation)) return 3;
    if (TWO_ARG.has(this.operation)) return 2;
    return 1;
  }
}

let _registered = false;
export function registerMathNode(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(MathNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
