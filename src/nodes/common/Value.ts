import { Node, type NodeInitContext } from '../../core/Node';
import { ColorProperty, FloatProperty, FloatVectorProperty } from '../../core/Properties';
import type { NodeTreeKind, RGBA, Vec3 } from '../../core/types';
import { NodeSocketFloat, NodeSocketColor, NodeSocketVector } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

/** Value — single float constant. */
export class ValueNode extends Node {
  static override bl_idname = 'ShaderNodeValue';
  static override bl_label = 'Value';
  static override category = 'Input';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override bl_width_default = 130;
  static override properties = {
    value: FloatProperty({ default: 0.5, name: 'Value' }),
  };
  declare value: number;

  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

/** RGB — single color constant. */
export class RGBNode extends Node {
  static override bl_idname = 'ShaderNodeRGB';
  static override bl_label = 'RGB';
  static override category = 'Input';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = {
    rgb: ColorProperty({ default: [1, 1, 1, 1] as const, name: 'Color' }),
  };
  declare rgb: RGBA;

  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Color');
  }
}

/** Vector — single vec3 constant. */
export class VectorNode extends Node {
  static override bl_idname = 'FunctionNodeInputVector';
  static override bl_label = 'Vector';
  static override category = 'Input';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree'];
  static override properties = {
    vector: FloatVectorProperty({ default: [0, 0, 0], size: 3, name: 'Vector' }),
  };
  declare vector: Vec3;

  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Vector');
  }
}

let _registered = false;
export function registerInputNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [ValueNode, RGBNode, VectorNode]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
