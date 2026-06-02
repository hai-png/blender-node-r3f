/**
 * Geometry-Node field-input nodes — Position, Normal, Index, ID, Radius,
 * Named Attribute, Material Index. Field nodes have no incoming geometry
 * and produce Field<T> outputs that are evaluated in the consumer's
 * context (the data-flow node downstream).
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketBool, NodeSocketColor, NodeSocketFloat, NodeSocketInt,
  NodeSocketString, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class GeoFieldInput extends Node {
  static override category = 'Geometry / Read';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  /** Marker for the evaluator's dispatcher. */
  static node_kind: 'FIELD' = 'FIELD';
}

export class GeometryNodeInputPosition extends GeoFieldInput {
  static override bl_idname = 'GeometryNodeInputPosition';
  static override bl_label = 'Position';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Position');
  }
}

export class GeometryNodeInputNormal extends GeoFieldInput {
  static override bl_idname = 'GeometryNodeInputNormal';
  static override bl_label = 'Normal';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Normal');
  }
}

export class GeometryNodeInputIndex extends GeoFieldInput {
  static override bl_idname = 'GeometryNodeInputIndex';
  static override bl_label = 'Index';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Index');
  }
}

export class GeometryNodeInputID extends GeoFieldInput {
  static override bl_idname = 'GeometryNodeInputID';
  static override bl_label = 'ID';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'ID');
  }
}

export class GeometryNodeInputRadius extends GeoFieldInput {
  static override bl_idname = 'GeometryNodeInputRadius';
  static override bl_label = 'Radius';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Radius');
  }
}

export class GeometryNodeInputNamedAttribute extends GeoFieldInput {
  static override bl_idname = 'GeometryNodeInputNamedAttribute';
  static override bl_label = 'Named Attribute';
  static override properties = {
    data_type: EnumProperty({
      items: [
        ['FLOAT', 'Float', ''],
        ['INT', 'Integer', ''],
        ['BOOL', 'Boolean', ''],
        ['FLOAT_VECTOR', 'Vector', ''],
        ['FLOAT_COLOR', 'Color', ''],
      ],
      default: 'FLOAT',
      name: 'Type',
    }),
  };
  declare data_type: 'FLOAT' | 'INT' | 'BOOL' | 'FLOAT_VECTOR' | 'FLOAT_COLOR';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketString, 'Name');
    this.addOutput(NodeSocketFloat, 'Attribute', { identifier: 'Attribute_Float' });
    this.addOutput(NodeSocketInt, 'Attribute', { identifier: 'Attribute_Int' });
    this.addOutput(NodeSocketBool, 'Attribute', { identifier: 'Attribute_Bool' });
    this.addOutput(NodeSocketVector, 'Attribute', { identifier: 'Attribute_Vector' });
    this.addOutput(NodeSocketColor, 'Attribute', { identifier: 'Attribute_Color' });
    this.addOutput(NodeSocketBool, 'Exists');
  }
}

let _registered = false;
export function registerGeoFieldInputs(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeInputPosition,
    GeometryNodeInputNormal,
    GeometryNodeInputIndex,
    GeometryNodeInputID,
    GeometryNodeInputRadius,
    GeometryNodeInputNamedAttribute,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
