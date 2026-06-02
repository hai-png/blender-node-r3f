/**
 * Combine / Separate XYZ, RGB, HSV, Color.
 * Mirrors ShaderNodeCombineXYZ, ShaderNodeSeparateXYZ, ShaderNodeCombineColor,
 * ShaderNodeSeparateColor.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeSocketColor, NodeSocketFloat, NodeSocketVector } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export class CombineXYZNode extends Node {
  static override bl_idname = 'ShaderNodeCombineXYZ';
  static override bl_label = 'Combine XYZ';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'X');
    this.addInput(NodeSocketFloat, 'Y');
    this.addInput(NodeSocketFloat, 'Z');
    this.addOutput(NodeSocketVector, 'Vector');
  }
}
export class SeparateXYZNode extends Node {
  static override bl_idname = 'ShaderNodeSeparateXYZ';
  static override bl_label = 'Separate XYZ';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketFloat, 'X');
    this.addOutput(NodeSocketFloat, 'Y');
    this.addOutput(NodeSocketFloat, 'Z');
  }
}

const COLOR_MODES = [
  ['RGB', 'RGB', ''],
  ['HSV', 'HSV', ''],
  ['HSL', 'HSL', ''],
] as const;

export class CombineColorNode extends Node {
  static override bl_idname = 'ShaderNodeCombineColor';
  static override bl_label = 'Combine Color';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = { mode: EnumProperty({ items: COLOR_MODES, default: 'RGB', name: 'Mode' }) };
  declare mode: 'RGB' | 'HSV' | 'HSL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Red', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Green', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Blue', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class SeparateColorNode extends Node {
  static override bl_idname = 'ShaderNodeSeparateColor';
  static override bl_label = 'Separate Color';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = { mode: EnumProperty({ items: COLOR_MODES, default: 'RGB', name: 'Mode' }) };
  declare mode: 'RGB' | 'HSV' | 'HSL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [1, 1, 1, 1] });
    this.addOutput(NodeSocketFloat, 'Red');
    this.addOutput(NodeSocketFloat, 'Green');
    this.addOutput(NodeSocketFloat, 'Blue');
  }
}

let _registered = false;
export function registerCombineSeparateNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [CombineXYZNode, SeparateXYZNode, CombineColorNode, SeparateColorNode]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
