/**
 * Geometry field-utility nodes (M5/Phase 5):
 *   - Accumulate Field      (running totals along the domain)
 *   - Evaluate on Domain    (interpolate a field to another domain)
 *   - Evaluate at Index     (gather a field value from another element)
 *   - Domain Size           (element counts per domain — data node)
 *   - Field on Domain alias (Blender's "Evaluate on Domain")
 *
 * These mirror Blender's Utilities → Field group.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeSocketFloat, NodeSocketInt, NodeSocketVector, NodeSocketGeometry } from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class GeoFieldUtil extends Node {
  static override category = 'Utilities / Field';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'FIELD' = 'FIELD';
}

const DOMAIN_ITEMS: [string, string, string][] = [
  ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
  ['CORNER', 'Corner', ''], ['CURVE', 'Curve', ''], ['INSTANCE', 'Instance', ''],
];

export class GeometryNodeAccumulateField extends GeoFieldUtil {
  static override bl_idname = 'GeometryNodeAccumulateField';
  static override bl_label = 'Accumulate Field';
  static override properties = {
    domain: EnumProperty({ items: DOMAIN_ITEMS, default: 'POINT' }),
  };
  declare domain: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 1 });
    this.addOutput(NodeSocketFloat, 'Leading');   // inclusive prefix sum
    this.addOutput(NodeSocketFloat, 'Trailing');   // exclusive prefix sum
    this.addOutput(NodeSocketFloat, 'Total');      // grand total (single)
  }
}

export class GeometryNodeFieldOnDomain extends GeoFieldUtil {
  static override bl_idname = 'GeometryNodeFieldOnDomain';
  static override bl_label = 'Evaluate on Domain';
  static override properties = {
    domain: EnumProperty({ items: DOMAIN_ITEMS, default: 'POINT' }),
  };
  declare domain: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0 });
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

export class GeometryNodeFieldAtIndex extends GeoFieldUtil {
  static override bl_idname = 'GeometryNodeFieldAtIndex';
  static override bl_label = 'Evaluate at Index';
  static override properties = {
    domain: EnumProperty({ items: DOMAIN_ITEMS, default: 'POINT' }),
  };
  declare domain: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Index', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0 });
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

/** Data-flow node: reports element counts for each domain of the input. */
export class GeometryNodeAttributeDomainSize extends Node {
  static override bl_idname = 'GeometryNodeAttributeDomainSize';
  static override bl_label = 'Domain Size';
  static override category = 'Geometry / Read';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketInt, 'Point Count');
    this.addOutput(NodeSocketInt, 'Edge Count');
    this.addOutput(NodeSocketInt, 'Face Count');
    this.addOutput(NodeSocketInt, 'Face Corner Count');
    this.addOutput(NodeSocketInt, 'Spline Count');
    this.addOutput(NodeSocketInt, 'Instance Count');
  }
}

void NodeSocketVector;

let _registered = false;
export function registerFieldUtilNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeAccumulateField, GeometryNodeFieldOnDomain, GeometryNodeFieldAtIndex,
    GeometryNodeAttributeDomainSize,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
