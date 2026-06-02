/**
 * Zone nodes — paired Input/Output pairs that form a closed sub-graph.
 * See `docs/M4_ZONES.md`.
 *
 * Three zone kinds:
 *   - 'SIM'      : GeometryNodeSimulationInput / GeometryNodeSimulationOutput
 *   - 'REPEAT'   : GeometryNodeRepeatInput / GeometryNodeRepeatOutput
 *   - 'FOREACH'  : GeometryNodeForeachGeometryElementInput / …Output
 *
 * Each Input node owns an authoritative list of *state items*; both partners
 * rebuild their sockets from that list. Items are added either:
 *   - via the API (`zoneInput.addStateItem({name, socket_type})`)
 *   - or implicitly by linking to the trailing empty "+" socket
 */
import { nanoid } from 'nanoid';
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, IntProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeRegistry } from '../../registry/NodeRegistry';
import type { ZoneKind, ZoneStateItem } from '../../eval/zones/types';
import {
  NodeSocketGeometry, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketInt, NodeSocketString,
} from '../../sockets';

/* ------------------------------------------------------------------ */
/*  Base classes                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_STATE_ITEMS = (): ZoneStateItem[] => [
  { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
];

abstract class GeoZoneInputBase extends Node {
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'ZONE_INPUT' = 'ZONE_INPUT';
  static zone_kind: ZoneKind = 'REPEAT';
  static override properties = {
    zone_id: StringProperty({ default: '', name: 'Zone ID' }),
  };
  declare zone_id: string;

  state_items: ZoneStateItem[] = DEFAULT_STATE_ITEMS();

  override init(_ctx: NodeInitContext): void {
    if (!this.zone_id) this.zone_id = nanoid(10);
    this.rebuildSockets();
  }

  /** Add a state item and rebuild both this node's sockets and its pair's. */
  addStateItem(item: Omit<ZoneStateItem, 'identifier'> & { identifier?: string }): ZoneStateItem {
    const it: ZoneStateItem = {
      identifier: item.identifier ?? `Item_${nanoid(6)}`,
      name: item.name,
      socket_type: item.socket_type,
    };
    this.state_items.push(it);
    this.rebuildSockets();
    this.findPair()?.rebuildSockets();
    return it;
  }

  removeStateItem(identifier: string): void {
    this.state_items = this.state_items.filter((it) => it.identifier !== identifier);
    this.rebuildSockets();
    this.findPair()?.rebuildSockets();
  }

  /** Locate the Output partner of this zone (by zone_id) within the same tree. */
  findPair(): GeoZoneOutputBase | undefined {
    const tree = (this as unknown as { tree?: { nodes: Node[] } }).tree;
    if (!tree) return undefined;
    const myKind = (this.constructor as typeof GeoZoneInputBase).zone_kind;
    return tree.nodes.find((n): n is GeoZoneOutputBase =>
      (n.constructor as typeof Node & { node_kind?: string }).node_kind === 'ZONE_OUTPUT'
      && (n.constructor as typeof Node & { zone_kind?: ZoneKind }).zone_kind === myKind
      && (n as unknown as { zone_id?: string }).zone_id === this.zone_id,
    );
  }

  /** Override in subclasses to add zone-specific extra sockets. */
  protected extraInputs(): void {}
  protected extraOutputs(): void {}

  /** Rebuilds sockets from `state_items`. Called after edits. */
  rebuildSockets(): void {
    this.inputs = [];
    this.outputs = [];
    this.extraInputs();
    for (const it of this.state_items) {
      const SockCls = NodeRegistry.getSocket(it.socket_type);
      if (!SockCls) continue;
      const inSock = new SockCls();
      inSock.is_output = false;
      inSock.node = this;
      inSock.init({ name: it.name, identifier: `in_${it.identifier}` });
      this.inputs.push(inSock);

      const outSock = new SockCls();
      outSock.is_output = true;
      outSock.node = this;
      outSock.init({ name: it.name, identifier: it.identifier });
      this.outputs.push(outSock);
    }
    this.extraOutputs();
  }
}

abstract class GeoZoneOutputBase extends Node {
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'ZONE_OUTPUT' = 'ZONE_OUTPUT';
  static zone_kind: ZoneKind = 'REPEAT';
  static override properties = {
    zone_id: StringProperty({ default: '', name: 'Zone ID' }),
  };
  declare zone_id: string;

  override init(_ctx: NodeInitContext): void {
    this.rebuildSockets();
  }

  /** Locate the Input partner of this zone. */
  findPair(): GeoZoneInputBase | undefined {
    const tree = (this as unknown as { tree?: { nodes: Node[] } }).tree;
    if (!tree) return undefined;
    const myKind = (this.constructor as typeof GeoZoneOutputBase).zone_kind;
    return tree.nodes.find((n): n is GeoZoneInputBase =>
      (n.constructor as typeof Node & { node_kind?: string }).node_kind === 'ZONE_INPUT'
      && (n.constructor as typeof Node & { zone_kind?: ZoneKind }).zone_kind === myKind
      && (n as unknown as { zone_id?: string }).zone_id === this.zone_id,
    );
  }

  /** Pulls the state-item list from the paired Input. */
  protected stateItems(): ZoneStateItem[] {
    return this.findPair()?.state_items ?? DEFAULT_STATE_ITEMS();
  }

  protected extraInputs(): void {}
  protected extraOutputs(): void {}

  rebuildSockets(): void {
    this.inputs = [];
    this.outputs = [];
    this.extraInputs();
    for (const it of this.stateItems()) {
      const SockCls = NodeRegistry.getSocket(it.socket_type);
      if (!SockCls) continue;
      const inSock = new SockCls();
      inSock.is_output = false;
      inSock.node = this;
      inSock.init({ name: it.name, identifier: `in_${it.identifier}` });
      this.inputs.push(inSock);

      const outSock = new SockCls();
      outSock.is_output = true;
      outSock.node = this;
      outSock.init({ name: it.name, identifier: it.identifier });
      this.outputs.push(outSock);
    }
    this.extraOutputs();
  }
}

/* ------------------------------------------------------------------ */
/*  Simulation Zone                                                    */
/* ------------------------------------------------------------------ */

export class GeometryNodeSimulationInput extends GeoZoneInputBase {
  static override bl_idname = 'GeometryNodeSimulationInput';
  static override bl_label = 'Simulation Input';
  static override category = 'Simulation';
  static override zone_kind: ZoneKind = 'SIM';

  protected override extraOutputs(): void {
    const dt = new NodeSocketFloat();
    dt.is_output = true; dt.node = this;
    dt.init({ name: 'Delta Time', identifier: '__delta_time' });
    this.outputs.push(dt);

    const elapsed = new NodeSocketFloat();
    elapsed.is_output = true; elapsed.node = this;
    elapsed.init({ name: 'Elapsed Time', identifier: '__elapsed_time' });
    this.outputs.push(elapsed);
  }
}

export class GeometryNodeSimulationOutput extends GeoZoneOutputBase {
  static override bl_idname = 'GeometryNodeSimulationOutput';
  static override bl_label = 'Simulation Output';
  static override category = 'Simulation';
  static override zone_kind: ZoneKind = 'SIM';
}

/* ------------------------------------------------------------------ */
/*  Repeat Zone                                                        */
/* ------------------------------------------------------------------ */

export class GeometryNodeRepeatInput extends GeoZoneInputBase {
  static override bl_idname = 'GeometryNodeRepeatInput';
  static override bl_label = 'Repeat Input';
  static override category = 'Utilities';
  static override zone_kind: ZoneKind = 'REPEAT';
  static override properties = {
    zone_id: StringProperty({ default: '', name: 'Zone ID' }),
    inspection_index: IntProperty({ default: 0, name: 'Inspection Index' }),
  };
  declare inspection_index: number;

  protected override extraInputs(): void {
    const it = new NodeSocketInt();
    it.is_output = false; it.node = this;
    it.init({ name: 'Iterations', identifier: '__iterations', default_value: 1 });
    this.inputs.push(it);
  }
  protected override extraOutputs(): void {
    const it = new NodeSocketInt();
    it.is_output = true; it.node = this;
    it.init({ name: 'Iteration', identifier: '__iteration' });
    this.outputs.push(it);
  }
}

export class GeometryNodeRepeatOutput extends GeoZoneOutputBase {
  static override bl_idname = 'GeometryNodeRepeatOutput';
  static override bl_label = 'Repeat Output';
  static override category = 'Utilities';
  static override zone_kind: ZoneKind = 'REPEAT';
}

/* ------------------------------------------------------------------ */
/*  Foreach Element Zone                                               */
/* ------------------------------------------------------------------ */

const FOREACH_DOMAINS = [
  ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
  ['CORNER', 'Face Corner', ''], ['CURVE', 'Spline', ''], ['INSTANCE', 'Instance', ''],
] as const;

export class GeometryNodeForeachGeometryElementInput extends GeoZoneInputBase {
  static override bl_idname = 'GeometryNodeForeachGeometryElementInput';
  static override bl_label = 'Foreach Element Input';
  static override category = 'Utilities';
  static override zone_kind: ZoneKind = 'FOREACH';
  static override properties = {
    zone_id: StringProperty({ default: '', name: 'Zone ID' }),
    domain: EnumProperty({ items: FOREACH_DOMAINS, default: 'POINT', name: 'Domain' }),
  };
  declare domain: 'POINT' | 'EDGE' | 'FACE' | 'CORNER' | 'CURVE' | 'INSTANCE';

  protected override extraInputs(): void {
    const sel = new NodeSocketFloatFactor();
    sel.is_output = false; sel.node = this;
    sel.init({ name: 'Selection', identifier: '__selection', default_value: 1 });
    this.inputs.push(sel);
  }
  protected override extraOutputs(): void {
    const idx = new NodeSocketInt();
    idx.is_output = true; idx.node = this;
    idx.init({ name: 'Index', identifier: '__element_index' });
    this.outputs.push(idx);
  }
}

export class GeometryNodeForeachGeometryElementOutput extends GeoZoneOutputBase {
  static override bl_idname = 'GeometryNodeForeachGeometryElementOutput';
  static override bl_label = 'Foreach Element Output';
  static override category = 'Utilities';
  static override zone_kind: ZoneKind = 'FOREACH';
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */
let _registered = false;
export function registerZoneNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeSimulationInput, GeometryNodeSimulationOutput,
    GeometryNodeRepeatInput, GeometryNodeRepeatOutput,
    GeometryNodeForeachGeometryElementInput, GeometryNodeForeachGeometryElementOutput,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}

/** Public union used by the evaluator's `instanceof` checks. */
export type ZoneInputNode =
  | GeometryNodeSimulationInput
  | GeometryNodeRepeatInput
  | GeometryNodeForeachGeometryElementInput;
export type ZoneOutputNode =
  | GeometryNodeSimulationOutput
  | GeometryNodeRepeatOutput
  | GeometryNodeForeachGeometryElementOutput;

/** Re-exports for type narrowing in the evaluator. */
export { GeoZoneInputBase, GeoZoneOutputBase };
