/**
 * Shader input nodes — they read varying data (UV, position, normal, time)
 * or scene data (Object Info, Camera Data, Light Path).
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketVector,
  NodeSocketShader,
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

// ── Additional Blender 4.x input/info nodes ───────────────────────────

export class ShaderNodeTangent extends InputNode {
  static override bl_idname = 'ShaderNodeTangent';
  static override bl_label = 'Tangent';
  static override properties = {
    direction_type: EnumProperty({
      items: [['RADIAL', 'Radial', ''], ['UV_MAP', 'UV Map', '']],
      default: 'RADIAL', name: 'Direction',
    }),
    axis: EnumProperty({
      items: [['X', 'X', ''], ['Y', 'Y', ''], ['Z', 'Z', '']],
      default: 'Z', name: 'Axis',
    }),
    uv_map: StringProperty({ default: '', name: 'UV Map' }),
  };
  declare direction_type: string;
  declare axis: string;
  declare uv_map: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Tangent');
  }
}

export class ShaderNodeWireframe extends InputNode {
  static override bl_idname = 'ShaderNodeWireframe';
  static override bl_label = 'Wireframe';
  static override properties = {
    use_pixel_size: EnumProperty({
      items: [['MESH', 'Mesh', ''], ['PIXEL', 'Pixel Size', '']],
      default: 'MESH', name: 'Size',
    }),
  };
  declare use_pixel_size: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Size', { default_value: 0.01 });
    this.addOutput(NodeSocketFloat, 'Fac');
  }
}

export class ShaderNodeBevel extends InputNode {
  static override bl_idname = 'ShaderNodeBevel';
  static override bl_label = 'Bevel';
  static override properties = {
    samples: EnumProperty({
      items: [['2', '2', ''], ['4', '4', ''], ['8', '8', ''], ['16', '16', '']],
      default: '4', name: 'Samples',
    }),
  };
  declare samples: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 0.05 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketVector, 'Normal');
  }
}

export class ShaderNodeAmbientOcclusion extends InputNode {
  static override bl_idname = 'ShaderNodeAmbientOcclusion';
  static override bl_label = 'Ambient Occlusion';
  static override properties = {
    samples: EnumProperty({
      items: [['8', '8', ''], ['16', '16', ''], ['32', '32', '']],
      default: '16', name: 'Samples',
    }),
    inside: EnumProperty({
      items: [['INSIDE', 'Inside', ''], ['OUTSIDE', 'Outside', '']],
      default: 'OUTSIDE', name: 'Side',
    }),
    only_local: EnumProperty({
      items: [['LOCAL', 'Local Only', ''], ['ALL', 'All', '']],
      default: 'ALL', name: 'Mode',
    }),
  };
  declare samples: string; declare inside: string; declare only_local: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketFloat, 'Distance', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloatFactor, 'AO');
  }
}

export class ShaderNodeVolumeInfo extends InputNode {
  static override bl_idname = 'ShaderNodeVolumeInfo';
  static override bl_label = 'Volume Info';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Density');
    this.addOutput(NodeSocketFloat, 'Flame');
    this.addOutput(NodeSocketFloat, 'Temperature');
  }
}

export class ShaderNodeVertexColor extends InputNode {
  static override bl_idname = 'ShaderNodeVertexColor';
  static override bl_label = 'Color Attribute';
  static override properties = {
    layer_name: StringProperty({ default: '', name: 'Layer Name' }),
  };
  declare layer_name: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class ShaderNodeHairInfo extends InputNode {
  static override bl_idname = 'ShaderNodeHairInfo';
  static override bl_label = 'Curves Info';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Is Strand');
    this.addOutput(NodeSocketFloat, 'Intercept');
    this.addOutput(NodeSocketFloat, 'Length');
    this.addOutput(NodeSocketFloat, 'Thickness');
    this.addOutput(NodeSocketVector, 'Tangent Normal');
    this.addOutput(NodeSocketFloat, 'Random');
  }
}

export class ShaderNodePointInfo extends InputNode {
  static override bl_idname = 'ShaderNodePointInfo';
  static override bl_label = 'Point Info';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Position');
    this.addOutput(NodeSocketFloat, 'Radius');
    this.addOutput(NodeSocketFloat, 'Random');
  }
}

export class ShaderNodeParticleInfo extends InputNode {
  static override bl_idname = 'ShaderNodeParticleInfo';
  static override bl_label = 'Particle Info';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Index');
    this.addOutput(NodeSocketFloat, 'Random');
    this.addOutput(NodeSocketFloat, 'Age');
    this.addOutput(NodeSocketFloat, 'Lifetime');
    this.addOutput(NodeSocketVector, 'Location');
    this.addOutput(NodeSocketFloat, 'Size');
    this.addOutput(NodeSocketVector, 'Velocity');
    this.addOutput(NodeSocketVector, 'Angular Velocity');
  }
}

export class ShaderNodeOutputAOV extends Node {
  static override bl_idname = 'ShaderNodeOutputAOV';
  static override bl_label = 'AOV Output';
  static override category = 'Output';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  static override properties = {
    name: StringProperty({ default: 'AOV', name: 'Name' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0 });
  }
}

// Volume Principled (Cycles/Eevee) — analogous to Principled BSDF for volumes.
export class ShaderNodeVolumePrincipled extends Node {
  static override bl_idname = 'ShaderNodeVolumePrincipled';
  static override bl_label = 'Principled Volume';
  static override category = 'Shader';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addInput(NodeSocketFloat, 'Color Attribute', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Density', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Density Attribute', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Anisotropy', { default_value: 0 });
    this.addInput(NodeSocketColor, 'Absorption Color', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketColor, 'Emission Color', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Emission Strength', { default_value: 0 });
    this.addInput(NodeSocketColor, 'Blackbody Tint', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketFloat, 'Blackbody Intensity', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Temperature', { default_value: 1000 });
    this.addInput(NodeSocketFloat, 'Temperature Attribute', { default_value: 0 });
    this.addOutput(NodeSocketShader, 'Volume');
  }
}

// Sky Texture and Point Density (procedural textures missing from Textures.ts).
export class ShaderNodeTexSky extends Node {
  static override bl_idname = 'ShaderNodeTexSky';
  static override bl_label = 'Sky Texture';
  static override category = 'Texture';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  static override properties = {
    sky_type: EnumProperty({
      items: [
        ['PREETHAM', 'Preetham', ''],
        ['HOSEK_WILKIE', 'Hosek / Wilkie', ''],
        ['NISHITA', 'Nishita', ''],
      ],
      default: 'NISHITA', name: 'Sky Type',
    }),
    sun_size: StringProperty({ default: '0.009', name: 'Sun Size' }),
    sun_elevation: StringProperty({ default: '15', name: 'Sun Elevation' }),
    sun_rotation: StringProperty({ default: '0', name: 'Sun Rotation' }),
    altitude: StringProperty({ default: '0', name: 'Altitude' }),
    air_density: StringProperty({ default: '1', name: 'Air' }),
    dust_density: StringProperty({ default: '1', name: 'Dust' }),
    ozone_density: StringProperty({ default: '1', name: 'Ozone' }),
  };
  declare sky_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class ShaderNodeTexPointDensity extends Node {
  static override bl_idname = 'ShaderNodeTexPointDensity';
  static override bl_label = 'Point Density';
  static override category = 'Texture';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  static override properties = {
    point_source: EnumProperty({
      items: [['PARTICLE_SYSTEM', 'Particle System', ''], ['OBJECT', 'Object Vertices', '']],
      default: 'PARTICLE_SYSTEM', name: 'Point Source',
    }),
    space: EnumProperty({
      items: [['OBJECT', 'Object Space', ''], ['WORLD', 'World Space', '']],
      default: 'OBJECT', name: 'Space',
    }),
    interpolation: EnumProperty({
      items: [['CLOSEST', 'Closest', ''], ['LINEAR', 'Linear', ''], ['CUBIC', 'Cubic', '']],
      default: 'LINEAR', name: 'Interpolation',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Vector');
    this.addOutput(NodeSocketColor, 'Color');
    this.addOutput(NodeSocketFloat, 'Density');
  }
}

let _registered = false;
export function registerShaderInputs(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    ShaderNodeUVMap, ShaderNodeGeometry, ShaderNodeAttribute, ShaderNodeFresnel,
    ShaderNodeLayerWeight, ShaderNodeObjectInfo, ShaderNodeCameraData, ShaderNodeLightPath,
    ShaderNodeTangent, ShaderNodeWireframe, ShaderNodeBevel, ShaderNodeAmbientOcclusion,
    ShaderNodeVolumeInfo, ShaderNodeVertexColor, ShaderNodeHairInfo, ShaderNodePointInfo,
    ShaderNodeParticleInfo, ShaderNodeOutputAOV, ShaderNodeVolumePrincipled,
    ShaderNodeTexSky, ShaderNodeTexPointDensity,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
