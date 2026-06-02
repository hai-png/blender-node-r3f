/**
 * Subset of Shader nodes for M0/M1:
 *   ShaderNodeOutputMaterial, ShaderNodeBsdfPrincipled, ShaderNodeEmission,
 *   ShaderNodeTexImage, ShaderNodeTexNoise, ShaderNodeMixShader,
 *   ShaderNodeAddShader, ShaderNodeTexCoord.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { FloatProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor,
  NodeSocketFloat,
  NodeSocketFloatFactor,
  NodeSocketShader,
  NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

export class ShaderNodeOutputMaterial extends Node {
  static override bl_idname = 'ShaderNodeOutputMaterial';
  static override bl_label = 'Material Output';
  static override category = 'Output';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketShader, 'Surface');
    this.addInput(NodeSocketShader, 'Volume');
    this.addInput(NodeSocketVector, 'Displacement', { default_value: [0, 0, 0] });
  }
}

export class ShaderNodeBsdfPrincipled extends Node {
  static override bl_idname = 'ShaderNodeBsdfPrincipled';
  static override bl_label = 'Principled BSDF';
  static override category = 'Shader';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  static override bl_width_default = 240;

  override init(_ctx: NodeInitContext): void {
    // Full Blender 4.x Principled BSDF input set (panel order preserved).
    this.addInput(NodeSocketColor, 'Base Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloatFactor, 'Metallic', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'IOR', { default_value: 1.5 });
    this.addInput(NodeSocketFloatFactor, 'Alpha', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Normal');
    // Subsurface
    this.addInput(NodeSocketFloatFactor, 'Subsurface Weight', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Subsurface Radius', { default_value: [1, 0.2, 0.1] });
    this.addInput(NodeSocketFloat, 'Subsurface Scale', { default_value: 0.05 });
    this.addInput(NodeSocketFloat, 'Subsurface IOR', { default_value: 1.4 });
    this.addInput(NodeSocketFloatFactor, 'Subsurface Anisotropy', { default_value: 0 });
    // Specular
    this.addInput(NodeSocketFloatFactor, 'Specular IOR Level', { default_value: 0.5 });
    this.addInput(NodeSocketColor, 'Specular Tint', { default_value: [1, 1, 1, 1] });
    // Anisotropy
    this.addInput(NodeSocketFloatFactor, 'Anisotropic', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Anisotropic Rotation', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Tangent');
    // Transmission
    this.addInput(NodeSocketFloatFactor, 'Transmission Weight', { default_value: 0 });
    // Coat
    this.addInput(NodeSocketFloatFactor, 'Coat Weight', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Coat Roughness', { default_value: 0.03 });
    this.addInput(NodeSocketFloat, 'Coat IOR', { default_value: 1.5 });
    this.addInput(NodeSocketColor, 'Coat Tint', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketVector, 'Coat Normal');
    // Sheen
    this.addInput(NodeSocketFloatFactor, 'Sheen Weight', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Sheen Roughness', { default_value: 0.5 });
    this.addInput(NodeSocketColor, 'Sheen Tint', { default_value: [1, 1, 1, 1] });
    // Emission
    this.addInput(NodeSocketColor, 'Emission Color', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Emission Strength', { default_value: 0 });
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeEmission extends Node {
  static override bl_idname = 'ShaderNodeEmission';
  static override bl_label = 'Emission';
  static override category = 'Shader';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketFloat, 'Strength', { default_value: 1 });
    this.addOutput(NodeSocketShader, 'Emission');
  }
}

export class ShaderNodeTexNoise extends Node {
  static override bl_idname = 'ShaderNodeTexNoise';
  static override bl_label = 'Noise Texture';
  static override category = 'Texture';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = {
    detail: FloatProperty({ default: 2, name: 'Detail' }),
  };
  declare detail: number;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addInput(NodeSocketFloat, 'Detail', { default_value: 2 });
    this.addInput(NodeSocketFloat, 'Roughness', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'Distortion', { default_value: 0 });
    this.addOutput(NodeSocketFloat, 'Fac');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeTexCoord extends Node {
  static override bl_idname = 'ShaderNodeTexCoord';
  static override bl_label = 'Texture Coordinate';
  static override category = 'Input';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Generated');
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketVector, 'UV');
    this.addOutput(NodeSocketVector, 'Object');
    this.addOutput(NodeSocketVector, 'Camera');
    this.addOutput(NodeSocketVector, 'Window');
    this.addOutput(NodeSocketVector, 'Reflection');
  }
}

export class ShaderNodeMixShader extends Node {
  static override bl_idname = 'ShaderNodeMixShader';
  static override bl_label = 'Mix Shader';
  static override category = 'Shader';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 0.5 });
    this.addInput(NodeSocketShader, 'Shader');
    this.addInput(NodeSocketShader, 'Shader');
    this.addOutput(NodeSocketShader, 'Shader');
  }
}

export class ShaderNodeOutputWorld extends Node {
  static override bl_idname = 'ShaderNodeOutputWorld';
  static override bl_label = 'World Output';
  static override category = 'Output';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketShader, 'Surface');
    this.addInput(NodeSocketShader, 'Volume');
  }
}

export class ShaderNodeOutputLight extends Node {
  static override bl_idname = 'ShaderNodeOutputLight';
  static override bl_label = 'Light Output';
  static override category = 'Output';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketShader, 'Surface');
  }
}

// ── Color operations (registered classes so they show up in the Add menu) ──

export class ShaderNodeHueSaturation extends Node {
  static override bl_idname = 'ShaderNodeHueSaturation';
  static override bl_label = 'Hue/Saturation/Value';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'CompositorNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Hue', { default_value: 0.5 });
    this.addInput(NodeSocketFloatFactor, 'Saturation', { default_value: 1 });
    this.addInput(NodeSocketFloatFactor, 'Value', { default_value: 1 });
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeBrightContrast extends Node {
  static override bl_idname = 'ShaderNodeBrightContrast';
  static override bl_label = 'Bright/Contrast';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'CompositorNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addInput(NodeSocketFloat, 'Bright', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Contrast', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeInvert extends Node {
  static override bl_idname = 'ShaderNodeInvert';
  static override bl_label = 'Invert Color';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'CompositorNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Color', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeGamma extends Node {
  static override bl_idname = 'ShaderNodeGamma';
  static override bl_label = 'Gamma';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'CompositorNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addInput(NodeSocketFloat, 'Gamma', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeMixRGB extends Node {
  static override bl_idname = 'ShaderNodeMixRGB';
  static override bl_label = 'Mix (Legacy)';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'CompositorNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 0.5 });
    this.addInput(NodeSocketColor, 'Color1', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addInput(NodeSocketColor, 'Color2', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

let _registered = false;
export function registerCoreShaderNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeOutputMaterial,
    ShaderNodeBsdfPrincipled,
    ShaderNodeEmission,
    ShaderNodeTexNoise,
    ShaderNodeTexCoord,
    ShaderNodeMixShader,
    ShaderNodeOutputWorld,
    ShaderNodeOutputLight,
    ShaderNodeHueSaturation,
    ShaderNodeBrightContrast,
    ShaderNodeInvert,
    ShaderNodeGamma,
    ShaderNodeMixRGB,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
