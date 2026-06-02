import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeSocketFloat } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

const ITEMS = [
  ['MINMAX', 'Min Max', 'Clamp to [min, max]'],
  ['RANGE', 'Range', 'Clamp to the min/max range regardless of order'],
] as const;

export class ClampNode extends Node {
  static override bl_idname = 'ShaderNodeClamp';
  static override bl_label = 'Clamp';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = {
    clamp_type: EnumProperty({ items: ITEMS, default: 'MINMAX', name: 'Clamp Type' }),
  };
  declare clamp_type: 'MINMAX' | 'RANGE';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Min', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Max', { default_value: 1 });
    this.addOutput(NodeSocketFloat, 'Result');
  }

  static compute(v: number, mn: number, mx: number, mode: 'MINMAX' | 'RANGE'): number {
    if (mode === 'RANGE') { if (mn > mx) [mn, mx] = [mx, mn]; }
    return Math.max(mn, Math.min(mx, v));
  }
}

let _registered = false;
export function registerClampNode(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(ClampNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
