/**
 * Shader input nodes — they read varying data (UV, position, normal, time)
 * or scene data (Object Info, Camera Data, Light Path).
 */
import { Node, type NodeInitContext } from '../../core/Node';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class InputNode extends Node {
  static override category = 'Input';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
}

export class ShaderNodeUVMap extends InputNode {
  static override bl_idname = 'ShaderNodeUVMap';
  static override bl_label = 'UV Map';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'UV');
  }
}

export class ShaderNodeGeometry extends InputNode {
  static override bl_idname = 'ShaderNodeNewGeometry';
  static override bl_label = 'Geometry';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Position');
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketVector, 'Tangent');
    this.addOutput(NodeSocketVector, 'True Normal');
    this.addOutput(NodeSocketVector, 'Incoming');
    this.addOutput(NodeSocketVector, 'Parametric');
    this.addOutput(NodeSocketFloat, 'Backfacing');
    this.addOutput(NodeSocketFloat, 'Pointiness');
    this.addOutput(NodeSocketFloat, 'Random Per Island');
  }
}

export class ShaderNodeAttribute extends InputNode {
  static override bl_idname = 'ShaderNodeAttribute';
  static override bl_label = 'Attribute';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketFloat, 'Fac');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class ShaderNodeFresnel extends InputNode {
  static override bl_idname = 'ShaderNodeFresnel';
  static override bl_label = 'Fresnel';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'IOR', { default_value: 1.45 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketFloatFactor, 'Fac');
  }
}

export class ShaderNodeLayerWeight extends InputNode {
  static override bl_idname = 'ShaderNodeLayerWeight';
  static override bl_label = 'Layer Weight';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Blend', { default_value: 0.5 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketFloatFactor, 'Fresnel');
    this.addOutput(NodeSocketFloatFactor, 'Facing');
  }
}

export class ShaderNodeObjectInfo extends InputNode {
  static override bl_idname = 'ShaderNodeObjectInfo';
  static override bl_label = 'Object Info';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Location');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
    this.addOutput(NodeSocketFloat, 'Object Index');
    this.addOutput(NodeSocketFloat, 'Material Index');
    this.addOutput(NodeSocketFloat, 'Random');
  }
}

export class ShaderNodeCameraData extends InputNode {
  static override bl_idname = 'ShaderNodeCameraData';
  static override bl_label = 'Camera Data';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'View Vector');
    this.addOutput(NodeSocketFloat, 'View Z Depth');
    this.addOutput(NodeSocketFloat, 'View Distance');
  }
}

export class ShaderNodeLightPath extends InputNode {
  static override bl_idname = 'ShaderNodeLightPath';
  static override bl_label = 'Light Path';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Is Camera Ray');
    this.addOutput(NodeSocketFloat, 'Is Shadow Ray');
    this.addOutput(NodeSocketFloat, 'Is Diffuse Ray');
    this.addOutput(NodeSocketFloat, 'Is Glossy Ray');
    this.addOutput(NodeSocketFloat, 'Is Singular Ray');
    this.addOutput(NodeSocketFloat, 'Is Reflection Ray');
    this.addOutput(NodeSocketFloat, 'Is Transmission Ray');
    this.addOutput(NodeSocketFloat, 'Ray Length');
    this.addOutput(NodeSocketFloat, 'Ray Depth');
    this.addOutput(NodeSocketFloat, 'Diffuse Depth');
    this.addOutput(NodeSocketFloat, 'Glossy Depth');
    this.addOutput(NodeSocketFloat, 'Transparent Depth');
    this.addOutput(NodeSocketFloat, 'Transmission Depth');
  }
}

let _registered = false;
export function registerShaderInputs(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeUVMap, ShaderNodeGeometry, ShaderNodeAttribute, ShaderNodeFresnel,
    ShaderNodeLayerWeight, ShaderNodeObjectInfo, ShaderNodeCameraData, ShaderNodeLightPath,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
