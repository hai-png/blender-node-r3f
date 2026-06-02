/**
 * BSDF / shader closure nodes. Covers the rest of Blender's surface
 * shaders so that ported materials are recognised by the evaluator.
 *
 * Some of these (Subsurface, Hair, Toon) have no exact 1:1 in WebGL/WebGPU
 * standard PBR; the evaluator approximates them with the closest TSL slot
 * configuration. The graph is preserved either way.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketShader, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class BsdfNode extends Node {
  static override category = 'Shader';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
}

export class ShaderNodeBsdfDiffuse extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfDiffuse';
  static override bl_label = 'Diffuse BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfGlossy extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfGlossy';
  static override bl_label = 'Glossy BSDF';
  static override properties = {
    distribution: EnumProperty({
      items: [['GGX', 'GGX', ''], ['MULTI_GGX', 'Multiscatter GGX', ''], ['BECKMANN', 'Beckmann', ''], ['SHARP', 'Sharp', '']],
      default: 'MULTI_GGX', name: 'Distribution',
    }),
  };
  declare distribution: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'Anisotropy', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Rotation', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addInput(NodeSocketVector, 'Tangent');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfRefraction extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfRefraction';
  static override bl_label = 'Refraction BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'IOR', { default_value: 1.45 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfGlass extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfGlass';
  static override bl_label = 'Glass BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'IOR', { default_value: 1.45 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfTransparent extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfTransparent';
  static override bl_label = 'Transparent BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [1, 1, 1, 1] });
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfTranslucent extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfTranslucent';
  static override bl_label = 'Translucent BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfSheen extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfSheen';
  static override bl_label = 'Sheen BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 0.5 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeBsdfToon extends BsdfNode {
  static override bl_idname = 'ShaderNodeBsdfToon';
  static override bl_label = 'Toon BSDF';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloatFactor, 'Size', { default_value: 0.5 });
    this.addInput(NodeSocketFloatFactor, 'Smooth', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSDF');
  }
}

export class ShaderNodeSubsurfaceScattering extends BsdfNode {
  static override bl_idname = 'ShaderNodeSubsurfaceScattering';
  static override bl_label = 'Subsurface Scattering';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloatFactor, 'Scale', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Radius', { default_value: [1, 0.2, 0.1] });
    this.addInput(NodeSocketFloatFactor, 'IOR', { default_value: 1.4 });
    this.addInput(NodeSocketFloatFactor, 'Roughness', { default_value: 1 });
    this.addInput(NodeSocketFloatFactor, 'Anisotropy', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketShader, 'BSSRDF');
  }
}

export class ShaderNodeBackground extends BsdfNode {
  static override bl_idname = 'ShaderNodeBackground';
  static override bl_label = 'Background';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloat, 'Strength', { default_value: 1 });
    this.addOutput(NodeSocketShader, 'Background');
  }
}

export class ShaderNodeHoldout extends BsdfNode {
  static override bl_idname = 'ShaderNodeHoldout';
  static override bl_label = 'Holdout';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketShader, 'Holdout');
  }
}

export class ShaderNodeAddShader extends BsdfNode {
  static override bl_idname = 'ShaderNodeAddShader';
  static override bl_label = 'Add Shader';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketShader, 'Shader', { identifier: 'Shader1' });
    this.addInput(NodeSocketShader, 'Shader', { identifier: 'Shader2' });
    this.addOutput(NodeSocketShader, 'Shader');
  }
}

export class ShaderNodeVolumeAbsorption extends BsdfNode {
  static override bl_idname = 'ShaderNodeVolumeAbsorption';
  static override bl_label = 'Volume Absorption';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloat, 'Density', { default_value: 1 });
    this.addOutput(NodeSocketShader, 'Volume');
  }
}

export class ShaderNodeVolumeScatter extends BsdfNode {
  static override bl_idname = 'ShaderNodeVolumeScatter';
  static override bl_label = 'Volume Scatter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketFloat, 'Density', { default_value: 1 });
    this.addInput(NodeSocketFloatFactor, 'Anisotropy', { default_value: 0 });
    this.addOutput(NodeSocketShader, 'Volume');
  }
}

let _registered = false;
export function registerBsdfNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeBsdfDiffuse, ShaderNodeBsdfGlossy, ShaderNodeBsdfRefraction, ShaderNodeBsdfGlass,
    ShaderNodeBsdfTransparent, ShaderNodeBsdfTranslucent, ShaderNodeBsdfSheen, ShaderNodeBsdfToon,
    ShaderNodeSubsurfaceScattering, ShaderNodeBackground, ShaderNodeHoldout, ShaderNodeAddShader,
    ShaderNodeVolumeAbsorption, ShaderNodeVolumeScatter,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
