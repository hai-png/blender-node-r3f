/**
 * Legacy Texture node tree (TextureNodeTree) — M6.
 *
 * These mirror Blender's Texture nodes. The TextureEvaluator compiles the
 * tree into a per-sample callback `(u, v) => RGBA` and can bake it to a
 * THREE.DataTexture.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, FloatProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeSocketColor, NodeSocketFloat, NodeSocketVector } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class TexNode extends Node {
  static override tree_types: NodeTreeKind[] = ['TextureNodeTree'];
}

export class TextureNodeOutput extends TexNode {
  static override bl_idname = 'TextureNodeOutput';
  static override bl_label = 'Output';
  static override category = 'Output';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color');
  }
}

export class TextureNodeNoise extends TexNode {
  static override bl_idname = 'TextureNodeNoise';
  static override bl_label = 'Noise';
  static override category = 'Patterns';
  static override properties = { scale: FloatProperty({ default: 5, name: 'Scale' }) };
  declare scale: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class TextureNodeChecker extends TexNode {
  static override bl_idname = 'TextureNodeChecker';
  static override bl_label = 'Checker';
  static override category = 'Patterns';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addInput(NodeSocketColor, 'Color 1', { default_value: [0.05, 0.05, 0.05, 1] });
    this.addInput(NodeSocketColor, 'Color 2', { default_value: [0.95, 0.95, 0.95, 1] });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class TextureNodeVoronoi extends TexNode {
  static override bl_idname = 'TextureNodeVoronoi';
  static override bl_label = 'Voronoi';
  static override category = 'Patterns';
  static override properties = {
    metric: EnumProperty({ items: [['DISTANCE', 'Euclidean', ''], ['MANHATTAN', 'Manhattan', '']], default: 'DISTANCE' }),
    scale: FloatProperty({ default: 5, name: 'Scale' }),
  };
  declare metric: string;
  declare scale: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Distance');
  }
}

export class TextureNodeWave extends TexNode {
  static override bl_idname = 'TextureNodeWave';
  static override bl_label = 'Wave';
  static override category = 'Patterns';
  static override properties = {
    wave_type: EnumProperty({ items: [['BANDS', 'Bands', ''], ['RINGS', 'Rings', '']], default: 'BANDS' }),
    scale: FloatProperty({ default: 5, name: 'Scale' }),
    distortion: FloatProperty({ default: 0, name: 'Distortion' }),
  };
  declare wave_type: string;
  declare scale: number;
  declare distortion: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class TextureNodeMagic extends TexNode {
  static override bl_idname = 'TextureNodeMagic';
  static override bl_label = 'Magic';
  static override category = 'Patterns';
  static override properties = {
    depth: FloatProperty({ default: 2, name: 'Depth' }),
    scale: FloatProperty({ default: 5, name: 'Scale' }),
  };
  declare depth: number;
  declare scale: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class TextureNodeBlend extends TexNode {
  static override bl_idname = 'TextureNodeBlend';
  static override bl_label = 'Blend';
  static override category = 'Patterns';
  static override properties = {
    progression: EnumProperty({ items: [['LINEAR', 'Linear', ''], ['RADIAL', 'Radial', ''], ['QUADRATIC', 'Quadratic', '']], default: 'LINEAR' }),
  };
  declare progression: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class TextureNodeImage extends TexNode {
  static override bl_idname = 'TextureNodeImage';
  static override bl_label = 'Image';
  static override category = 'Input';
  static override properties = { image_src: StringProperty({ default: '', name: 'Image' }) };
  declare image_src: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Coords');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class TextureNodeMath extends TexNode {
  static override bl_idname = 'TextureNodeMath';
  static override bl_label = 'Math';
  static override category = 'Converter';
  static override properties = {
    operation: EnumProperty({
      items: [['ADD','Add',''],['SUBTRACT','Subtract',''],['MULTIPLY','Multiply',''],['DIVIDE','Divide',''],['POWER','Power',''],['MINIMUM','Minimum',''],['MAXIMUM','Maximum','']],
      default: 'ADD',
    }),
  };
  declare operation: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0, identifier: 'Value_001' });
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

export class TextureNodeMixRGB extends TexNode {
  static override bl_idname = 'TextureNodeMixRGB';
  static override bl_label = 'Mix';
  static override category = 'Converter';
  static override properties = {
    blend_type: EnumProperty({ items: [['MIX','Mix',''],['ADD','Add',''],['MULTIPLY','Multiply','']], default: 'MIX' }),
  };
  declare blend_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Fac', { default_value: 0.5 });
    this.addInput(NodeSocketColor, 'Color1', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketColor, 'Color2', { default_value: [1, 1, 1, 1] });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class TextureNodeValToRGB extends TexNode {
  static override bl_idname = 'TextureNodeValToRGB';
  static override bl_label = 'Color Ramp';
  static override category = 'Converter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Fac', { default_value: 0.5 });
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class TextureNodeCoordinates extends TexNode {
  static override bl_idname = 'TextureNodeCoordinates';
  static override bl_label = 'Coordinates';
  static override category = 'Input';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Coordinates');
  }
}

let _registered = false;
export function registerTextureNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    TextureNodeOutput, TextureNodeNoise, TextureNodeChecker, TextureNodeVoronoi,
    TextureNodeWave, TextureNodeMagic, TextureNodeBlend, TextureNodeImage,
    TextureNodeMath, TextureNodeMixRGB, TextureNodeValToRGB, TextureNodeCoordinates,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
