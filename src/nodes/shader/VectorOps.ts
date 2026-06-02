/**
 * Vector-space utility nodes: Bump, Normal Map, Mapping, Vector Rotate,
 * Vector Transform, Displacement.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class VectorOp extends Node {
  static override category = 'Vector';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
}

export class ShaderNodeBump extends VectorOp {
  static override bl_idname = 'ShaderNodeBump';
  static override bl_label = 'Bump';
  static override properties = {
    invert: EnumProperty({ items: [['NORMAL', 'Normal', ''], ['INVERT', 'Invert', '']], default: 'NORMAL', name: 'Direction' }),
  };
  declare invert: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Strength', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Distance', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Height', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketVector, 'Normal');
  }
}

export class ShaderNodeNormalMap extends VectorOp {
  static override bl_idname = 'ShaderNodeNormalMap';
  static override bl_label = 'Normal Map';
  static override properties = {
    space: EnumProperty({
      items: [
        ['TANGENT', 'Tangent Space', ''], ['OBJECT', 'Object Space', ''],
        ['WORLD', 'World Space', ''], ['BLENDER_OBJECT', 'Blender Object Space', ''],
      ],
      default: 'TANGENT', name: 'Space',
    }),
  };
  declare space: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Strength', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 1, 1] });
    this.addOutput(NodeSocketVector, 'Normal');
  }
}

export class ShaderNodeMapping extends VectorOp {
  static override bl_idname = 'ShaderNodeMapping';
  static override bl_label = 'Mapping';
  static override properties = {
    vector_type: EnumProperty({
      items: [['POINT', 'Point', ''], ['TEXTURE', 'Texture', ''], ['VECTOR', 'Vector', ''], ['NORMAL', 'Normal', '']],
      default: 'POINT', name: 'Type',
    }),
  };
  declare vector_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketVector, 'Location', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Rotation', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Scale', { default_value: [1, 1, 1] });
    this.addOutput(NodeSocketVector, 'Vector');
  }
}

export class ShaderNodeVectorRotate extends VectorOp {
  static override bl_idname = 'ShaderNodeVectorRotate';
  static override bl_label = 'Vector Rotate';
  static override properties = {
    rotation_type: EnumProperty({
      items: [
        ['AXIS_ANGLE', 'Axis Angle', ''], ['X_AXIS', 'X Axis', ''], ['Y_AXIS', 'Y Axis', ''],
        ['Z_AXIS', 'Z Axis', ''], ['EULER_XYZ', 'Euler', ''],
      ],
      default: 'AXIS_ANGLE', name: 'Type',
    }),
  };
  declare rotation_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketVector, 'Center', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Axis', { default_value: [0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Angle', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Rotation', { default_value: [0, 0, 0] });
    this.addOutput(NodeSocketVector, 'Vector');
  }
}

export class ShaderNodeVectorDisplacement extends VectorOp {
  static override bl_idname = 'ShaderNodeVectorDisplacement';
  static override bl_label = 'Vector Displacement';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Vector', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Midlevel', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 1 });
    this.addOutput(NodeSocketVector, 'Displacement');
  }
}

export class ShaderNodeDisplacement extends VectorOp {
  static override bl_idname = 'ShaderNodeDisplacement';
  static override bl_label = 'Displacement';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Height', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Midlevel', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketVector, 'Displacement');
  }
}

let _registered = false;
export function registerShaderVectorOps(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeBump, ShaderNodeNormalMap, ShaderNodeMapping, ShaderNodeVectorRotate,
    ShaderNodeVectorDisplacement, ShaderNodeDisplacement,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
