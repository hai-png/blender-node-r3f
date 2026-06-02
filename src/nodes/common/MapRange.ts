/**
 * Map Range — remaps a value (or vector) from one interval to another.
 * Mirrors ShaderNodeMapRange.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { BoolProperty, EnumProperty } from '../../core/Properties';
import type { NodeTreeKind, Vec3 } from '../../core/types';
import { NodeSocketFloat, NodeSocketVector } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export const INTERP_TYPES = [
  ['LINEAR', 'Linear', ''],
  ['STEPPED', 'Stepped Linear', ''],
  ['SMOOTHSTEP', 'Smooth Step', ''],
  ['SMOOTHERSTEP', 'Smoother Step', ''],
] as const;
const DATA_ITEMS = [
  ['FLOAT', 'Float', ''],
  ['FLOAT_VECTOR', 'Vector', ''],
] as const;

export class MapRangeNode extends Node {
  static override bl_idname = 'ShaderNodeMapRange';
  static override bl_label = 'Map Range';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = [
    'ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree',
  ];
  static override bl_width_default = 160;
  static override properties = {
    data_type: EnumProperty({ items: DATA_ITEMS, default: 'FLOAT', name: 'Type' }),
    interpolation_type: EnumProperty({ items: INTERP_TYPES, default: 'LINEAR', name: 'Interpolation' }),
    clamp: BoolProperty({ default: true, name: 'Clamp' }),
  };
  declare data_type: 'FLOAT' | 'FLOAT_VECTOR';
  declare interpolation_type: 'LINEAR' | 'STEPPED' | 'SMOOTHSTEP' | 'SMOOTHERSTEP';
  declare clamp: boolean;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'From Min', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'From Max', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'To Min', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'To Max', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Steps', { default_value: 4 });
    this.addOutput(NodeSocketFloat, 'Result');
    this.addOutput(NodeSocketVector, 'Vector', { identifier: 'Vector' });
  }

  static computeFloat(
    v: number, fmn: number, fmx: number, tmn: number, tmx: number,
    steps: number, interp: MapRangeNode['interpolation_type'], clamp: boolean,
  ): number {
    const r = fmx - fmn;
    let f = r === 0 ? 0 : (v - fmn) / r;
    if (clamp) f = Math.max(0, Math.min(1, f));
    switch (interp) {
      case 'STEPPED': f = steps <= 0 ? 0 : Math.floor(f * (steps + 1)) / steps; break;
      case 'SMOOTHSTEP': f = f * f * (3 - 2 * f); break;
      case 'SMOOTHERSTEP': f = f * f * f * (f * (f * 6 - 15) + 10); break;
    }
    return tmn + f * (tmx - tmn);
  }
  static computeVec(
    v: Vec3,
    fmn: Vec3, fmx: Vec3, tmn: Vec3, tmx: Vec3,
    steps: number, interp: MapRangeNode['interpolation_type'], clamp: boolean,
  ): Vec3 {
    return [
      MapRangeNode.computeFloat(v[0], fmn[0], fmx[0], tmn[0], tmx[0], steps, interp, clamp),
      MapRangeNode.computeFloat(v[1], fmn[1], fmx[1], tmn[1], tmx[1], steps, interp, clamp),
      MapRangeNode.computeFloat(v[2], fmn[2], fmx[2], tmn[2], tmx[2], steps, interp, clamp),
    ] as Vec3;
  }
  /**
   * Per-component vector variant that accepts scalar bounds (the common
   * Blender case where the same From/To range is applied to all three axes).
   */
  static computeVecScalar(
    v: Vec3,
    fmn: number, fmx: number, tmn: number, tmx: number,
    steps: number, interp: MapRangeNode['interpolation_type'], clamp: boolean,
  ): Vec3 {
    return [
      MapRangeNode.computeFloat(v[0], fmn, fmx, tmn, tmx, steps, interp, clamp),
      MapRangeNode.computeFloat(v[1], fmn, fmx, tmn, tmx, steps, interp, clamp),
      MapRangeNode.computeFloat(v[2], fmn, fmx, tmn, tmx, steps, interp, clamp),
    ] as Vec3;
  }
}

let _registered = false;
export function registerMapRangeNode(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(MapRangeNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
