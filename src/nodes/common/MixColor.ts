/**
 * Mix node (color/vector/float variants). Mirrors Blender's
 * ShaderNodeMix (introduced in 3.4, replacing legacy ShaderNodeMixRGB).
 *
 * In Blender the same node services Float/Vector/Color via a `data_type`
 * enum + a per-color `blend_type` enum. We mirror that exactly.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { BoolProperty, EnumProperty } from '../../core/Properties';
import type { NodeTreeKind, RGBA, Vec3 } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export const MIX_BLEND_TYPES = [
  'MIX', 'DARKEN', 'MULTIPLY', 'BURN', 'LIGHTEN', 'SCREEN', 'DODGE', 'ADD',
  'OVERLAY', 'SOFT_LIGHT', 'LINEAR_LIGHT', 'DIFFERENCE', 'EXCLUSION',
  'SUBTRACT', 'DIVIDE', 'HUE', 'SATURATION', 'COLOR', 'VALUE',
] as const;
export type MixBlendType = (typeof MIX_BLEND_TYPES)[number];

const BLEND_ITEMS = MIX_BLEND_TYPES.map((t) =>
  [t, t.replace(/_/g, ' ').toLowerCase().replace(/\b./g, (c) => c.toUpperCase()), t] as const);

const DATA_TYPE_ITEMS = [
  ['FLOAT', 'Float', 'Mix scalars'],
  ['VECTOR', 'Vector', 'Mix vectors'],
  ['RGBA', 'Color', 'Mix colors'],
] as const;

export class MixNode extends Node {
  static override bl_idname = 'ShaderNodeMix';
  static override bl_label = 'Mix';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = [
    'ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree',
  ];
  static override bl_width_default = 160;
  static override properties = {
    data_type: EnumProperty({ items: DATA_TYPE_ITEMS, default: 'RGBA', name: 'Data Type' }),
    blend_type: EnumProperty({ items: BLEND_ITEMS, default: 'MIX', name: 'Blend' }),
    clamp_factor: BoolProperty({ default: true, name: 'Clamp Factor' }),
    clamp_result: BoolProperty({ default: false, name: 'Clamp Result' }),
  };
  declare data_type: 'FLOAT' | 'VECTOR' | 'RGBA';
  declare blend_type: MixBlendType;
  declare clamp_factor: boolean;
  declare clamp_result: boolean;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Factor', { default_value: 0.5 });
    // Blender shows only the relevant pair based on data_type. We expose all
    // and the evaluator picks based on data_type.
    this.addInput(NodeSocketFloat, 'A', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'B', { default_value: 0 });
    this.addInput(NodeSocketVector, 'A', { default_value: [0, 0, 0], identifier: 'A_Vector' });
    this.addInput(NodeSocketVector, 'B', { default_value: [0, 0, 0], identifier: 'B_Vector' });
    this.addInput(NodeSocketColor, 'A', { default_value: [0.5, 0.5, 0.5, 1], identifier: 'A_Color' });
    this.addInput(NodeSocketColor, 'B', { default_value: [0.5, 0.5, 0.5, 1], identifier: 'B_Color' });
    this.addOutput(NodeSocketFloat, 'Result');
    this.addOutput(NodeSocketVector, 'Result', { identifier: 'Result_Vector' });
    this.addOutput(NodeSocketColor, 'Result', { identifier: 'Result_Color' });
  }

  static mixFloat(a: number, b: number, f: number): number { return a * (1 - f) + b * f; }
  static mixVec(a: Vec3, b: Vec3, f: number): Vec3 {
    return [a[0] * (1 - f) + b[0] * f, a[1] * (1 - f) + b[1] * f, a[2] * (1 - f) + b[2] * f];
  }

  /** Apply a per-channel blend op then mix with factor f. Color path only. */
  static mixColor(a: RGBA, b: RGBA, f: number, blend: MixBlendType): RGBA {
    const blended = applyBlend(a, b, blend);
    return [
      a[0] * (1 - f) + blended[0] * f,
      a[1] * (1 - f) + blended[1] * f,
      a[2] * (1 - f) + blended[2] * f,
      a[3] * (1 - f) + blended[3] * f,
    ];
  }
}

function applyBlend(a: RGBA, b: RGBA, t: MixBlendType): RGBA {
  // Per-channel except HUE/SAT/COLOR/VALUE which work in HSV.
  const ch = (i: 0|1|2) => {
    const x = a[i], y = b[i];
    switch (t) {
      case 'MIX': return y;
      case 'DARKEN': return Math.min(x, y);
      case 'MULTIPLY': return x * y;
      case 'BURN': return y === 0 ? 0 : 1 - (1 - x) / y;
      case 'LIGHTEN': return Math.max(x, y);
      case 'SCREEN': return 1 - (1 - x) * (1 - y);
      case 'DODGE': return y === 1 ? 1 : x / (1 - y);
      case 'ADD': return x + y;
      case 'OVERLAY': return x < 0.5 ? 2 * x * y : 1 - 2 * (1 - x) * (1 - y);
      case 'SOFT_LIGHT': return (1 - 2 * y) * x * x + 2 * y * x;
      case 'LINEAR_LIGHT': return x + 2 * y - 1;
      case 'DIFFERENCE': return Math.abs(x - y);
      case 'EXCLUSION': return x + y - 2 * x * y;
      case 'SUBTRACT': return x - y;
      case 'DIVIDE': return y === 0 ? 0 : x / y;
      default: return y;
    }
  };
  if (t === 'HUE' || t === 'SATURATION' || t === 'VALUE' || t === 'COLOR') {
    const ah = rgbToHsv(a[0], a[1], a[2]);
    const bh = rgbToHsv(b[0], b[1], b[2]);
    let h = ah[0], s = ah[1], v = ah[2];
    if (t === 'HUE') h = bh[0];
    if (t === 'SATURATION') s = bh[1];
    if (t === 'VALUE') v = bh[2];
    if (t === 'COLOR') { h = bh[0]; s = bh[1]; }
    const out = hsvToRgb(h, s, v);
    return [out[0], out[1], out[2], a[3]];
  }
  return [ch(0), ch(1), ch(2), a[3]];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360 / 360;
  }
  const s = mx === 0 ? 0 : d / mx;
  return [h, s, mx];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

let _registered = false;
export function registerMixNode(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(MixNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
