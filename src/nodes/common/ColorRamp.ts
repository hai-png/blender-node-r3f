/**
 * Color Ramp — gradient editor with N stops.
 * Mirrors ShaderNodeValToRGB.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind, RGBA } from '../../core/types';
import { NodeSocketColor, NodeSocketFloatFactor, NodeSocketFloat } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export interface ColorRampStop {
  position: number;   // 0..1
  color: RGBA;
}

const INTERP = [
  ['LINEAR', 'Linear', ''],
  ['CONSTANT', 'Constant', ''],
  ['EASE', 'Ease', ''],
  ['B_SPLINE', 'B-Spline', ''],
  ['CARDINAL', 'Cardinal', ''],
] as const;

export class ColorRampNode extends Node {
  static override bl_idname = 'ShaderNodeValToRGB';
  static override bl_label = 'Color Ramp';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override bl_width_default = 220;
  static override properties = {
    interpolation: EnumProperty({ items: INTERP, default: 'LINEAR', name: 'Interpolation' }),
  };
  declare interpolation: 'LINEAR' | 'CONSTANT' | 'EASE' | 'B_SPLINE' | 'CARDINAL';

  /** Stops — exposed for the inspector. Sorted by position. */
  stops: ColorRampStop[] = [
    { position: 0, color: [0, 0, 0, 1] },
    { position: 1, color: [1, 1, 1, 1] },
  ];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 0.5 });
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }

  static sample(stops: ColorRampStop[], interp: ColorRampNode['interpolation'], t: number): RGBA {
    if (stops.length === 0) return [0, 0, 0, 1];
    if (stops.length === 1) return [...stops[0]!.color] as RGBA;
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    if (t <= sorted[0]!.position) return [...sorted[0]!.color] as RGBA;
    if (t >= sorted[sorted.length - 1]!.position) return [...sorted[sorted.length - 1]!.color] as RGBA;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      if (t >= a.position && t <= b.position) {
        const r = b.position - a.position;
        let f = r === 0 ? 0 : (t - a.position) / r;
        if (interp === 'CONSTANT') f = 0;
        else if (interp === 'EASE') f = f * f * (3 - 2 * f);
        return [
          a.color[0] + (b.color[0] - a.color[0]) * f,
          a.color[1] + (b.color[1] - a.color[1]) * f,
          a.color[2] + (b.color[2] - a.color[2]) * f,
          a.color[3] + (b.color[3] - a.color[3]) * f,
        ];
      }
    }
    return [0, 0, 0, 1];
  }
}

let _registered = false;
export function registerColorRampNode(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(ColorRampNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
