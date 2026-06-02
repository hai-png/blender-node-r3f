/**
 * Geometry → Material nodes.
 *
 * Blender ships four material-related geometry nodes:
 *   - Set Material          — assigns a material slot to selected faces
 *   - Set Material Index    — writes the material_index attribute per-face
 *   - Material Index        — reads material_index as a field
 *   - Material Selection    — boolean field: true where material_index == target
 *
 * In our runtime, material assignment is modelled as an integer attribute
 * `material_index` on the FACE domain. The actual Three.js material array
 * is resolved by the host; the evaluator just maintains the per-face int.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { IntProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketGeometry, NodeSocketBool, NodeSocketInt, NodeSocketMaterial,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

/* ------------------------------------------------------------------ */
/*  Set Material                                                      */
/* ------------------------------------------------------------------ */
export class GeometryNodeSetMaterial extends Node {
  static override bl_idname = 'GeometryNodeSetMaterial';
  static override bl_label = 'Set Material';
  static override category = 'Geometry / Material';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true, hide_value: true });
    this.addInput(NodeSocketMaterial, 'Material');
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Set Material Index                                                */
/* ------------------------------------------------------------------ */
export class GeometryNodeSetMaterialIndex extends Node {
  static override bl_idname = 'GeometryNodeSetMaterialIndex';
  static override bl_label = 'Set Material Index';
  static override category = 'Geometry / Material';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true, hide_value: true });
    this.addInput(NodeSocketInt, 'Material Index', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Material Index (field read)                                       */
/* ------------------------------------------------------------------ */
export class GeometryNodeMaterialIndex extends Node {
  static override bl_idname = 'GeometryNodeMaterialIndex';
  static override bl_label = 'Material Index';
  static override category = 'Geometry / Read';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Material Index');
  }
}

/* ------------------------------------------------------------------ */
/*  Material Selection (boolean field)                                */
/* ------------------------------------------------------------------ */
export class GeometryNodeMaterialSelection extends Node {
  static override bl_idname = 'GeometryNodeMaterialSelection';
  static override bl_label = 'Material Selection';
  static override category = 'Geometry / Material';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];

  static override properties = {
    material_index: IntProperty({ default: 0, min: 0, name: 'Material Index' }),
  };
  declare material_index: number;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketMaterial, 'Material');
    this.addOutput(NodeSocketBool, 'Selection');
  }
}

/* ------------------------------------------------------------------ */
/*  Replace Material                                                  */
/* ------------------------------------------------------------------ */
export class GeometryNodeReplaceMaterial extends Node {
  static override bl_idname = 'GeometryNodeReplaceMaterial';
  static override bl_label = 'Replace Material';
  static override category = 'Geometry / Material';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketMaterial, 'Old');
    this.addInput(NodeSocketMaterial, 'New');
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */
let _registered = false;
export function registerMaterialNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeSetMaterial,
    GeometryNodeSetMaterialIndex,
    GeometryNodeMaterialIndex,
    GeometryNodeMaterialSelection,
    GeometryNodeReplaceMaterial,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
