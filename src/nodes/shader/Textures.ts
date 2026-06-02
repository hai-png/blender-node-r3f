/**
 * Procedural & image texture nodes for the shader system.
 * Each accepts a Vector input (defaults to generated coordinates) and
 * produces a Color + Fac output.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketImage, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

const VORONOI_FEATURES = [
  ['F1', 'F1', ''], ['F2', 'F2', ''], ['SMOOTH_F1', 'Smooth F1', ''],
  ['DISTANCE_TO_EDGE', 'Distance to Edge', ''], ['N_SPHERE_RADIUS', 'N-Sphere Radius', ''],
] as const;
const VORONOI_METRICS = [
  ['EUCLIDEAN', 'Euclidean', ''], ['MANHATTAN', 'Manhattan', ''],
  ['CHEBYCHEV', 'Chebychev', ''], ['MINKOWSKI', 'Minkowski', ''],
] as const;

abstract class TextureNode extends Node {
  static override category = 'Texture';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree'];
}

export class ShaderNodeTexImage extends TextureNode {
  static override bl_idname = 'ShaderNodeTexImage';
  static override bl_label = 'Image Texture';
  static override properties = {
    interpolation: EnumProperty({
      items: [['Linear', 'Linear', ''], ['Closest', 'Closest', ''], ['Cubic', 'Cubic', ''], ['Smart', 'Smart', '']],
      default: 'Linear', name: 'Interpolation',
    }),
    projection: EnumProperty({
      items: [['FLAT', 'Flat', ''], ['BOX', 'Box', ''], ['SPHERE', 'Sphere', ''], ['TUBE', 'Tube', '']],
      default: 'FLAT', name: 'Projection',
    }),
    extension: EnumProperty({
      items: [['REPEAT', 'Repeat', ''], ['EXTEND', 'Extend', ''], ['CLIP', 'Clip', ''], ['MIRROR', 'Mirror', '']],
      default: 'REPEAT', name: 'Extension',
    }),
    image_src: StringProperty({ default: '', name: 'Image URL', subtype: 'FILE_PATH' }),
  };
  declare interpolation: string;
  declare projection: string;
  declare extension: string;
  declare image_src: string;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketImage, 'Image');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class ShaderNodeTexEnvironment extends TextureNode {
  static override bl_idname = 'ShaderNodeTexEnvironment';
  static override bl_label = 'Environment Texture';
  static override properties = {
    image_src: StringProperty({ default: '', name: 'Environment URL', subtype: 'FILE_PATH' }),
  };
  declare image_src: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketImage, 'Image');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeTexVoronoi extends TextureNode {
  static override bl_idname = 'ShaderNodeTexVoronoi';
  static override bl_label = 'Voronoi Texture';
  static override properties = {
    feature: EnumProperty({ items: VORONOI_FEATURES, default: 'F1', name: 'Feature' }),
    distance: EnumProperty({ items: VORONOI_METRICS, default: 'EUCLIDEAN', name: 'Distance' }),
    voronoi_dimensions: EnumProperty({
      items: [['1D', '1D', ''], ['2D', '2D', ''], ['3D', '3D', ''], ['4D', '4D', '']],
      default: '3D', name: 'Dimensions',
    }),
  };
  declare feature: string;
  declare distance: string;
  declare voronoi_dimensions: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addInput(NodeSocketFloat, 'Smoothness', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Exponent', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'Randomness', { default_value: 1 });
    this.addOutput(NodeSocketFloat, 'Distance');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketVector, 'Position');
  }
}

export class ShaderNodeTexWave extends TextureNode {
  static override bl_idname = 'ShaderNodeTexWave';
  static override bl_label = 'Wave Texture';
  static override properties = {
    wave_type: EnumProperty({ items: [['BANDS', 'Bands', ''], ['RINGS', 'Rings', '']], default: 'BANDS', name: 'Type' }),
    wave_profile: EnumProperty({
      items: [['SIN', 'Sine', ''], ['SAW', 'Saw', ''], ['TRI', 'Triangle', '']],
      default: 'SIN', name: 'Profile',
    }),
  };
  declare wave_type: string;
  declare wave_profile: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addInput(NodeSocketFloat, 'Distortion', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Detail', { default_value: 2 });
    this.addInput(NodeSocketFloat, 'Detail Scale', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Detail Roughness', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'Phase Offset', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class ShaderNodeTexChecker extends TextureNode {
  static override bl_idname = 'ShaderNodeTexChecker';
  static override bl_label = 'Checker Texture';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketColor, 'Color1', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addInput(NodeSocketColor, 'Color2', { default_value: [0.2, 0.2, 0.2, 1] });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class ShaderNodeTexBrick extends TextureNode {
  static override bl_idname = 'ShaderNodeTexBrick';
  static override bl_label = 'Brick Texture';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketColor, 'Color1', { default_value: [0.8, 0.25, 0.1, 1] });
    this.addInput(NodeSocketColor, 'Color2', { default_value: [0.6, 0.15, 0.05, 1] });
    this.addInput(NodeSocketColor, 'Mortar', { default_value: [0.05, 0.05, 0.05, 1] });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addInput(NodeSocketFloat, 'Mortar Size', { default_value: 0.02 });
    this.addInput(NodeSocketFloat, 'Mortar Smooth', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Bias', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Brick Width', { default_value: 0.5 });
    this.addInput(NodeSocketFloat, 'Row Height', { default_value: 0.25 });
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class ShaderNodeTexGradient extends TextureNode {
  static override bl_idname = 'ShaderNodeTexGradient';
  static override bl_label = 'Gradient Texture';
  static override properties = {
    gradient_type: EnumProperty({
      items: [
        ['LINEAR', 'Linear', ''], ['QUADRATIC', 'Quadratic', ''],
        ['EASING', 'Easing', ''], ['DIAGONAL', 'Diagonal', ''],
        ['SPHERICAL', 'Spherical', ''], ['QUADRATIC_SPHERE', 'Quadratic Sphere', ''],
        ['RADIAL', 'Radial', ''],
      ],
      default: 'LINEAR', name: 'Type',
    }),
  };
  declare gradient_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class ShaderNodeTexMagic extends TextureNode {
  static override bl_idname = 'ShaderNodeTexMagic';
  static override bl_label = 'Magic Texture';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 5 });
    this.addInput(NodeSocketFloat, 'Distortion', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class ShaderNodeTexWhiteNoise extends TextureNode {
  static override bl_idname = 'ShaderNodeTexWhiteNoise';
  static override bl_label = 'White Noise Texture';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketFloat, 'W', { default_value: 0 });
    this.addOutput(NodeSocketFloat, 'Value');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

let _registered = false;
export function registerShaderTextures(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeTexImage, ShaderNodeTexEnvironment, ShaderNodeTexVoronoi, ShaderNodeTexWave,
    ShaderNodeTexChecker, ShaderNodeTexBrick, ShaderNodeTexGradient, ShaderNodeTexMagic,
    ShaderNodeTexWhiteNoise,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
