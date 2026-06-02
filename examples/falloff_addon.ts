/**
 * Example: porting a Blender custom-node addon to blender-nodes-r3f.
 *
 * --- Original Python (Blender addon, abridged) ---
 *
 *   import bpy
 *   from bpy.types import Node
 *   import nodeitems_utils
 *   from nodeitems_utils import NodeCategory, NodeItem
 *
 *   class GeometryNodeRadialFalloff(Node):
 *       bl_idname = 'GeometryNodeRadialFalloff'
 *       bl_label  = 'Radial Falloff'
 *       radius: bpy.props.FloatProperty(default=2.0, min=0.0)
 *       def init(self, ctx):
 *           self.inputs.new('NodeSocketVector', 'Position')
 *           self.outputs.new('NodeSocketFloat', 'Factor')
 *
 *   bpy.utils.register_class(GeometryNodeRadialFalloff)
 *   nodeitems_utils.register_node_categories('FALLOFF', [
 *       NodeCategory('FALLOFF', 'Falloff', items=[NodeItem('GeometryNodeRadialFalloff')]),
 *   ])
 *
 * --- TypeScript port (this file) ---
 *
 * The structure is mechanical: Python class → TS class extending
 * `bpy.types.Node`, properties → `static properties = {...}`, `init()` uses
 * `inputs_new/outputs_new`. The *behaviour* is supplied by an `executeGeo`
 * hook (the per-node extension point the GeometryEvaluator calls for custom
 * nodes) — this is the one piece Python addons get "for free" from Blender's
 * C core that we must re-implement.
 */
import { bpy, nodeitems_utils, FloatProperty } from '../src';
import type { GeoNodeExecCtx } from '../src';

export class GeometryNodeRadialFalloff extends bpy.types.Node {
  static override bl_idname = 'GeometryNodeRadialFalloff';
  static override bl_label = 'Radial Falloff';
  static override tree_types = ['GeometryNodeTree'] as const;
  static override category = 'Falloff';
  static override properties = {
    radius: FloatProperty({ default: 2.0, min: 0.0, name: 'Radius' }),
  };
  declare radius: number;

  override init(): void {
    (this as unknown as { inputs_new(t: string, n: string): unknown }).inputs_new('NodeSocketVector', 'Position');
    (this as unknown as { outputs_new(t: string, n: string): unknown }).outputs_new('NodeSocketFloat', 'Factor');
  }

  /** Per-node behaviour (Blender supplies this in C; we implement it here). */
  executeGeo(ctx: GeoNodeExecCtx): void {
    const radius = this.radius || 1;
    const posField = ctx.inputField('Position');
    // Factor = clamp(1 - |position| / radius, 0, 1) — a soft radial falloff.
    const factor = ctx.mapField<number[]>(posField, 'FLOAT', (p) => {
      const x = p[0] ?? 0, y = p[1] ?? 0, z = p[2] ?? 0;
      const d = Math.sqrt(x * x + y * y + z * z);
      return Math.max(0, Math.min(1, 1 - d / radius));
    });
    ctx.setOutputField('Factor', factor);
  }
}

let _registered = false;
export function registerFalloffAddon(): void {
  if (_registered) return;
  _registered = true;
  bpy.utils.register_class(GeometryNodeRadialFalloff);
  nodeitems_utils.register_node_categories('FALLOFF', [
    new nodeitems_utils.NodeCategory('FALLOFF', 'Falloff', [
      new nodeitems_utils.NodeItem('GeometryNodeRadialFalloff'),
    ]),
  ]);
}
