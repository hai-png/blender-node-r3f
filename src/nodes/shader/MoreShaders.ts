/**
 * MoreShaders.ts — additional shader nodes registered for completeness
 * with Blender 4.x. Many are simple input/converter nodes whose runtime
 * semantics are best handled by host-resolver hooks (e.g. blackbody color
 * lookup) and so register as known bl_idnames mapping to default outputs.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, FloatProperty, StringProperty, BoolProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketShader, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class ShaderMisc extends Node {
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
}

/** Converts a temperature in Kelvin to an RGB color (host can resolve). */
export class ShaderNodeBlackbody extends ShaderMisc {
  static override bl_idname = 'ShaderNodeBlackbody';
  static override bl_label = 'Blackbody';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Temperature', { default_value: 1500 });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

/** Converts a wavelength in nm to an RGB color. */
export class ShaderNodeWavelength extends ShaderMisc {
  static override bl_idname = 'ShaderNodeWavelength';
  static override bl_label = 'Wavelength';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Wavelength', { default_value: 500 });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

/** Reduces an RGB color to luminance. */
export class ShaderNodeRGBToBW extends ShaderMisc {
  static override bl_idname = 'ShaderNodeRGBToBW';
  static override bl_label = 'RGB to BW';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addOutput(NodeSocketFloat, 'Val');
  }
}

/** Bakes a shader closure to RGB (Eevee). */
export class ShaderNodeShaderToRGB extends ShaderMisc {
  static override bl_idname = 'ShaderNodeShaderToRGB';
  static override bl_label = 'Shader to RGB';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketShader, 'Shader');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

/**
 * Normal node — direction picker + N·v dot product.
 *
 * Distinct from ShaderNodeNormalMap: that one decodes a tangent-space
 * normal map texture; this one is a manual direction picker that outputs a
 * normalised vector and the dot of its direction with the input.
 */
export class ShaderNodeNormal extends ShaderMisc {
  static override bl_idname = 'ShaderNodeNormal';
  static override bl_label = 'Normal';
  static override category = 'Vector';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Normal', { default_value: [0, 0, 1] });
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketFloat, 'Dot');
  }
}

export class ShaderNodeCombineVector extends ShaderMisc {
  // Alias of CombineXYZ for completeness in the shader category.
  static override bl_idname = 'ShaderNodeCombineXYZ';
  static override bl_label = 'Combine XYZ';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'X', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Y', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Z', { default_value: 0 });
    this.addOutput(NodeSocketVector, 'Vector');
  }
}

export class ShaderNodeSeparateVector extends ShaderMisc {
  static override bl_idname = 'ShaderNodeSeparateXYZ';
  static override bl_label = 'Separate XYZ';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketFloat, 'X');
    this.addOutput(NodeSocketFloat, 'Y');
    this.addOutput(NodeSocketFloat, 'Z');
  }
}

/** Vector Transform — converts between coordinate spaces. */
export class ShaderNodeVectorTransform extends ShaderMisc {
  static override bl_idname = 'ShaderNodeVectorTransform';
  static override bl_label = 'Vector Transform';
  static override category = 'Vector';
  static override properties = {
    vector_type: EnumProperty({
      items: [['POINT', 'Point', ''], ['VECTOR', 'Vector', ''], ['NORMAL', 'Normal', '']],
      default: 'VECTOR', name: 'Type',
    }),
    convert_from: EnumProperty({
      items: [['WORLD', 'World', ''], ['OBJECT', 'Object', ''], ['CAMERA', 'Camera', '']],
      default: 'WORLD', name: 'Convert From',
    }),
    convert_to: EnumProperty({
      items: [['WORLD', 'World', ''], ['OBJECT', 'Object', ''], ['CAMERA', 'Camera', '']],
      default: 'OBJECT', name: 'Convert To',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketVector, 'Vector');
  }
}

/** Script node (OSL). Read by importers; runtime is host-defined. */
export class ShaderNodeScript extends ShaderMisc {
  static override bl_idname = 'ShaderNodeScript';
  static override bl_label = 'Script';
  static override category = 'OSL';
  static override properties = {
    script_source: EnumProperty({
      items: [['INTERNAL', 'Internal', ''], ['EXTERNAL', 'External', '']],
      default: 'INTERNAL', name: 'Source',
    }),
    filepath: StringProperty({ default: '', name: 'File Path', subtype: 'FILE_PATH' }),
    bytecode: StringProperty({ default: '', name: 'Bytecode' }),
    use_auto_update: BoolProperty({ default: true, name: 'Auto Update' }),
  };
  override init(_ctx: NodeInitContext): void {
    // No fixed sockets — the OSL script defines them at runtime.
  }
}

/** Color Attribute alias of VertexColor for newer Blender. */
export class ShaderNodeAttributeColor extends ShaderMisc {
  static override bl_idname = 'ShaderNodeAttributeColor';
  static override bl_label = 'Color Attribute';
  static override category = 'Input';
  static override properties = {
    layer_name: StringProperty({ default: '', name: 'Layer Name' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

/** Float Color and float-Curve helpers (placeholders for future expansion). */
export class ShaderNodeFloatToInt extends ShaderMisc {
  static override bl_idname = 'FunctionNodeFloatToInt';
  static override bl_label = 'Float to Integer';
  static override category = 'Converter';
  static override properties = {
    rounding_mode: EnumProperty({
      items: [['ROUND', 'Round', ''], ['FLOOR', 'Floor', ''], ['CEILING', 'Ceiling', ''], ['TRUNCATE', 'Truncate', '']],
      default: 'ROUND', name: 'Rounding',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Float');
    this.addOutput(NodeSocketFloat, 'Integer');
  }
}

export class ShaderNodeAlignEulerToVector extends ShaderMisc {
  static override bl_idname = 'FunctionNodeAlignEulerToVector';
  static override bl_label = 'Align Euler to Vector';
  static override category = 'Converter';
  static override properties = {
    axis: EnumProperty({ items: [['X', 'X', ''], ['Y', 'Y', ''], ['Z', 'Z', '']], default: 'X', name: 'Axis' }),
    pivot_axis: EnumProperty({ items: [['AUTO', 'Auto', ''], ['X', 'X', ''], ['Y', 'Y', ''], ['Z', 'Z', '']], default: 'AUTO', name: 'Pivot Axis' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Rotation');
    this.addInput(NodeSocketFloat, 'Factor', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Vector', { default_value: [0, 0, 1] });
    this.addOutput(NodeSocketVector, 'Rotation');
  }
}

export class ShaderNodeRotateEuler extends ShaderMisc {
  static override bl_idname = 'FunctionNodeRotateEuler';
  static override bl_label = 'Rotate Euler';
  static override category = 'Converter';
  static override properties = {
    type: EnumProperty({ items: [['AXIS_ANGLE', 'Axis Angle', ''], ['EULER', 'Euler', '']], default: 'EULER', name: 'Type' }),
    space: EnumProperty({ items: [['OBJECT', 'Object', ''], ['LOCAL', 'Local', '']], default: 'OBJECT', name: 'Space' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Rotation');
    this.addInput(NodeSocketVector, 'Rotate By');
    this.addInput(NodeSocketVector, 'Axis', { default_value: [0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Angle');
    this.addOutput(NodeSocketVector, 'Rotation');
  }
}

let _registered = false;
export function registerMoreShaderNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeBlackbody, ShaderNodeWavelength, ShaderNodeRGBToBW,
    ShaderNodeShaderToRGB, ShaderNodeNormal,
    ShaderNodeVectorTransform, ShaderNodeScript, ShaderNodeAttributeColor,
    ShaderNodeFloatToInt, ShaderNodeAlignEulerToVector, ShaderNodeRotateEuler,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
