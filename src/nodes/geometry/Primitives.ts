/**
 * Mesh primitive nodes (data-flow).
 * Mirrors:
 *   GeometryNodeMeshCube, GeometryNodeMeshUVSphere, GeometryNodeMeshIcoSphere,
 *   GeometryNodeMeshCylinder, GeometryNodeMeshCone, GeometryNodeMeshGrid,
 *   GeometryNodeMeshLine, GeometryNodeMeshCircle,
 *   GeometryNodeTransform, GeometryNodeJoinGeometry.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, IntProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketFloat, NodeSocketInt, NodeSocketGeometry, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class GeoDataFlow extends Node {
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
}

abstract class MeshPrim extends GeoDataFlow {
  static override category = 'Mesh / Primitives';
}

export class GeometryNodeMeshCube extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshCube';
  static override bl_label = 'Cube';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Size', { default_value: [2, 2, 2] });
    this.addInput(NodeSocketInt, 'Vertices X', { default_value: 2 });
    this.addInput(NodeSocketInt, 'Vertices Y', { default_value: 2 });
    this.addInput(NodeSocketInt, 'Vertices Z', { default_value: 2 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
    this.addOutput(NodeSocketVector, 'UV Map');
  }
}

export class GeometryNodeMeshUVSphere extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshUVSphere';
  static override bl_label = 'UV Sphere';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Segments', { default_value: 32 });
    this.addInput(NodeSocketInt, 'Rings', { default_value: 16 });
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
    this.addOutput(NodeSocketVector, 'UV Map');
  }
}

export class GeometryNodeMeshIcoSphere extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshIcoSphere';
  static override bl_label = 'Ico Sphere';
  static override properties = {
    subdivisions: IntProperty({ default: 1, min: 1, max: 7, name: 'Subdivisions' }),
  };
  declare subdivisions: number;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
    this.addOutput(NodeSocketVector, 'UV Map');
  }
}

export class GeometryNodeMeshCylinder extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshCylinder';
  static override bl_label = 'Cylinder';
  static override properties = {
    fill_type: EnumProperty({
      items: [['NONE', 'None', ''], ['NGON', 'N-gon', ''], ['TRIANGLE_FAN', 'Triangle Fan', '']],
      default: 'NGON', name: 'Fill Type',
    }),
  };
  declare fill_type: 'NONE' | 'NGON' | 'TRIANGLE_FAN';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Vertices', { default_value: 32 });
    this.addInput(NodeSocketInt, 'Side Segments', { default_value: 1 });
    this.addInput(NodeSocketInt, 'Fill Segments', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Depth', { default_value: 2 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeMeshCone extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshCone';
  static override bl_label = 'Cone';
  static override properties = {
    fill_type: EnumProperty({
      items: [['NONE', 'None', ''], ['NGON', 'N-gon', ''], ['TRIANGLE_FAN', 'Triangle Fan', '']],
      default: 'NGON', name: 'Fill Type',
    }),
  };
  declare fill_type: 'NONE' | 'NGON' | 'TRIANGLE_FAN';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Vertices', { default_value: 32 });
    this.addInput(NodeSocketInt, 'Side Segments', { default_value: 1 });
    this.addInput(NodeSocketInt, 'Fill Segments', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Radius Top', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Radius Bottom', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Depth', { default_value: 2 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeMeshGrid extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshGrid';
  static override bl_label = 'Grid';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Size X', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Size Y', { default_value: 1 });
    this.addInput(NodeSocketInt, 'Vertices X', { default_value: 3 });
    this.addInput(NodeSocketInt, 'Vertices Y', { default_value: 3 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
    this.addOutput(NodeSocketVector, 'UV Map');
  }
}

export class GeometryNodeMeshLine extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshLine';
  static override bl_label = 'Mesh Line';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Count', { default_value: 10 });
    this.addInput(NodeSocketFloat, 'Resolution', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Start Location', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Offset', { default_value: [0, 0, 1] });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeMeshCircle extends MeshPrim {
  static override bl_idname = 'GeometryNodeMeshCircle';
  static override bl_label = 'Mesh Circle';
  static override properties = {
    fill_type: EnumProperty({
      items: [['NONE', 'None', ''], ['NGON', 'N-gon', ''], ['TRIANGLE_FAN', 'Triangle Fan', '']],
      default: 'NONE', name: 'Fill Type',
    }),
  };
  declare fill_type: 'NONE' | 'NGON' | 'TRIANGLE_FAN';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Vertices', { default_value: 32 });
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

/* ------------------------------------------------------------------ */
/*  Transform / Join                                                  */
/* ------------------------------------------------------------------ */

export class GeometryNodeTransform extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeTransform';
  static override bl_label = 'Transform Geometry';
  static override category = 'Geometry / Operations';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketVector, 'Translation', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Rotation', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Scale', { default_value: [1, 1, 1] });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

export class GeometryNodeJoinGeometry extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeJoinGeometry';
  static override bl_label = 'Join Geometry';
  static override category = 'Geometry / Operations';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry', { is_multi_input: true, link_limit: 0 });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

let _registered = false;
export function registerGeometryPrimitives(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeMeshCube,
    GeometryNodeMeshUVSphere,
    GeometryNodeMeshIcoSphere,
    GeometryNodeMeshCylinder,
    GeometryNodeMeshCone,
    GeometryNodeMeshGrid,
    GeometryNodeMeshLine,
    GeometryNodeMeshCircle,
    GeometryNodeTransform,
    GeometryNodeJoinGeometry,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
