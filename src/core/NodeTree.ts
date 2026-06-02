/**
 * NodeTree — mirrors bpy.types.NodeTree.
 * Owns nodes, links, interface, and a Depsgraph for lazy re-evaluation.
 */
import { nanoid } from 'nanoid';
import type { NodeTreeKind, NodeCtor } from './types';
import { Node } from './Node';
import { NodeSocket } from './NodeSocket';
import { NodeLink } from './NodeLink';
import { NodeTreeInterface } from './NodeTreeInterface';
import { Depsgraph } from '../eval/Depsgraph';

export type NodeTreeListener = (tree: NodeTree, ev: NodeTreeEvent) => void;
export type NodeTreeEvent =
  | { type: 'node_added'; node: Node }
  | { type: 'node_removed'; node: Node }
  | { type: 'link_added'; link: NodeLink }
  | { type: 'link_removed'; link: NodeLink }
  | { type: 'node_moved'; node: Node }
  | { type: 'property_changed'; node: Node; key: string }
  | { type: 'evaluated' };

export class NodeTree {
  static bl_idname: NodeTreeKind = 'ShaderNodeTree';
  static bl_label: string = 'Node Tree';

  readonly id: string = nanoid(10);
  name: string;
  nodes: Node[] = [];
  links: NodeLink[] = [];
  interface = new NodeTreeInterface();
  depsgraph: Depsgraph;

  private listeners = new Set<NodeTreeListener>();
  private _nameCounter = 0;

  constructor(name = 'NodeTree') {
    this.name = name;
    this.depsgraph = new Depsgraph(this);
    NodeTree._allTreeRefs.add(new WeakRef(this));
  }

  // ---------------------------------------------------------------------
  //  Node ops
  // ---------------------------------------------------------------------
  addNode<N extends Node>(NodeCls: NodeCtor<N>, init?: Partial<N>): N {
    const node = new NodeCls();
    node.tree = this;
    node.name = init?.name ?? this.uniqueName(NodeCls.bl_label);
    if (init?.location) node.location = init.location;
    if (init?.label) node.label = init.label;
    node.init({ tree: this });
    this.nodes.push(node);
    this.emit({ type: 'node_added', node });
    this.depsgraph.invalidate(node);
    return node;
  }

  removeNode(node: Node): void {
    // remove dependent links first
    const dependent = this.links.filter((l) => l.from_node === node || l.to_node === node);
    for (const l of dependent) this.removeLink(l);
    const idx = this.nodes.indexOf(node);
    if (idx >= 0) {
      this.nodes.splice(idx, 1);
      node.free?.();
      this.emit({ type: 'node_removed', node });
    }
  }

  private uniqueName(base: string): string {
    let candidate = base;
    while (this.nodes.some((n) => n.name === candidate)) {
      this._nameCounter += 1;
      candidate = `${base}.${String(this._nameCounter).padStart(3, '0')}`;
    }
    return candidate;
  }

  // ---------------------------------------------------------------------
  //  Link ops
  // ---------------------------------------------------------------------
  addLink(from: NodeSocket, to: NodeSocket): NodeLink {
    if (!from.is_output) throw new Error('addLink: "from" must be an output socket');
    if (to.is_output) throw new Error('addLink: "to" must be an input socket');
    if (from.node === to.node) throw new Error('addLink: cannot link a node to itself');
    if (this.wouldCreateCycle(from.node, to.node)) {
      throw new Error(`addLink: link ${from.node.name || from.node.bl_label} → ${to.node.name || to.node.bl_label} would create a cycle`);
    }

    // enforce link_limit: when limit reached on either side, drop oldest link
    // (Blender does the same: dragging a wire onto a single-input socket
    //  replaces any existing wire).
    if (to.link_limit > 0 && to.links.length >= to.link_limit) {
      this.removeLink(to.links[0]!);
    }

    const link = new NodeLink(from.node, from, to.node, to);
    if (!link.is_valid) {
      // Still create the link visually; the evaluator will skip it.
      // Blender shows invalid links in red.
    }
    // Zone-escape rule: a link starting *inside* a zone must either stay in
    // the same zone or pass through its Output node. We mark such links so
    // the evaluator skips them and the UI can render them red.
    link.escapes_zone = this.detectZoneEscape(from.node, to.node);
    link.multi_input_sort_id = to.links.length;
    this.links.push(link);
    from.links.push(link);
    to.links.push(link);
    // Zone membership is structural. Adding a link can make existing nodes
    // enter/leave a zone, so refresh every link flag after the topology edit.
    this.recomputeZoneEscapes();
    this.emit({ type: 'link_added', link });
    this.depsgraph.invalidate(to.node);
    // poll for custom routing
    to.node.insert_link?.(link);
    return link;
  }

  /** Recompute zone-escape flags for all links after a topology edit. */
  recomputeZoneEscapes(): void {
    for (const l of this.links) l.escapes_zone = this.detectZoneEscape(l.from_node, l.to_node);
  }

  /**
   * Blender forbids graph cycles at edit-time. A new edge `fromNode -> toNode`
   * would create a cycle iff `toNode` can already reach `fromNode` through the
   * current valid link topology.
   */
  private wouldCreateCycle(fromNode: Node, toNode: Node): boolean {
    if (fromNode === toNode) return true;
    const seen = new Set<Node>([toNode]);
    const stack: Node[] = [toNode];
    while (stack.length) {
      const n = stack.pop()!;
      for (const l of this.links) {
        if (l.from_node !== n) continue;
        if (!l.is_valid || l.escapes_zone) continue;
        if (l.to_node === fromNode) return true;
        if (!seen.has(l.to_node)) {
          seen.add(l.to_node);
          stack.push(l.to_node);
        }
      }
    }
    return false;
  }

  /**
   * Returns true when a link from `fromNode` to `toNode` violates the
   * zone-escape rule: from is inside zone Z, to is outside Z, and from is
   * not the zone's Output node.
   */
  private detectZoneEscape(fromNode: Node, toNode: Node): boolean {
    const fromZone = this.zoneIdOf(fromNode);
    const toZone = this.zoneIdOf(toNode);
    if (!fromZone) return false;
    if (toZone === fromZone) return false;
    // Output nodes are the "border" — they can talk to the outside.
    const ctor = fromNode.constructor as typeof Node & { node_kind?: string };
    return ctor.node_kind !== 'ZONE_OUTPUT';
  }

  /**
   * Returns the zone_id `node` is enclosed by, or undefined if it's at the
   * outer level. Computed structurally: a node is inside zone Z iff it is
   * reachable forward from Z's Input *and* reachable backward from Z's
   * Output, restricted to nodes that aren't themselves zone boundaries.
   *
   * Implementation note: this is recomputed lazily on each link edit, which
   * is O(zones × nodes). Acceptable for trees with a handful of zones.
   */
  zoneIdOf(node: Node): string | undefined {
    const ctor = node.constructor as typeof Node & { node_kind?: string };
    if (ctor.node_kind === 'ZONE_INPUT' || ctor.node_kind === 'ZONE_OUTPUT') {
      return (node as unknown as { zone_id?: string }).zone_id;
    }
    for (const candidate of this.nodes) {
      const cc = candidate.constructor as typeof Node & { node_kind?: string };
      if (cc.node_kind !== 'ZONE_INPUT') continue;
      const zid = (candidate as unknown as { zone_id?: string }).zone_id;
      if (!zid) continue;
      const pair = this.nodes.find((p) => {
        const pc = p.constructor as typeof Node & { node_kind?: string };
        return pc.node_kind === 'ZONE_OUTPUT'
          && (pc as unknown as { zone_kind?: string }).zone_kind === (cc as unknown as { zone_kind?: string }).zone_kind
          && (p as unknown as { zone_id?: string }).zone_id === zid;
      });
      if (!pair) continue;
      if (this.isReachableForward(candidate, node) && this.isReachableBackward(pair, node)) {
        return zid;
      }
    }
    return undefined;
  }

  /** DFS: is `target` reachable forward from `from`? */
  private isReachableForward(from: Node, target: Node): boolean {
    if (from === target) return true;
    const seen = new Set<Node>([from]);
    const stack: Node[] = [from];
    while (stack.length) {
      const n = stack.pop()!;
      for (const l of this.links) {
        if (l.from_node !== n) continue;
        if (l.to_node === target) return true;
        if (!seen.has(l.to_node)) { seen.add(l.to_node); stack.push(l.to_node); }
      }
    }
    return false;
  }
  private isReachableBackward(from: Node, target: Node): boolean {
    if (from === target) return true;
    const seen = new Set<Node>([from]);
    const stack: Node[] = [from];
    while (stack.length) {
      const n = stack.pop()!;
      for (const l of this.links) {
        if (l.to_node !== n) continue;
        if (l.from_node === target) return true;
        if (!seen.has(l.from_node)) { seen.add(l.from_node); stack.push(l.from_node); }
      }
    }
    return false;
  }

  /**
   * Convenience: create a paired zone Input + Output, wired with the default
   * Geometry → Geometry state link.
   *
   *   const { input, output } = tree.addZone('REPEAT');
   *
   * Requires the zone node classes to be registered (bootstrapBuiltins does
   * this). The classes are looked up from the registry to avoid pulling a
   * circular module dependency into core/.
   */
  addZone(kind: 'SIM' | 'REPEAT' | 'FOREACH'): { input: Node; output: Node } {
    const prefix = kind === 'SIM' ? 'Simulation'
      : kind === 'REPEAT' ? 'Repeat'
      : 'ForeachGeometryElement';
    const inputId = `GeometryNode${prefix}Input`;
    const outputId = `GeometryNode${prefix}Output`;
    // Lazy lookup through the registry (set by bootstrapBuiltins() before any
    // tree is used). We keep core/ free of registry imports.
    const reg = NodeTree._registryLookup;
    if (!reg) {
      throw new Error('addZone: NodeRegistry hook not installed. Call bootstrapBuiltins() first.');
    }
    const InputCls = reg(inputId);
    const OutputCls = reg(outputId);
    if (!InputCls || !OutputCls) {
      throw new Error(`addZone: zone classes "${inputId}" / "${outputId}" not registered`);
    }
    const input = this.addNode(InputCls as unknown as Parameters<typeof this.addNode>[0]);
    const output = this.addNode(OutputCls as unknown as Parameters<typeof this.addNode>[0]);
    // Share zone_id from input to output.
    const zid = (input as unknown as { zone_id: string }).zone_id;
    (output as unknown as { zone_id: string }).zone_id = zid;
    output.location = [input.location[0] + 320, input.location[1]];
    // Rebuild output sockets now that it can locate its pair.
    (output as unknown as { rebuildSockets?(): void }).rebuildSockets?.();
    // Default link: first state item → first state item.
    const fromSock = input.outputs.find((s) => s.identifier === 'Geometry');
    const toSock = output.inputs.find((s) => s.identifier === 'in_Geometry');
    if (fromSock && toSock) this.addLink(fromSock, toSock);
    return { input, output };
  }

  /**
   * Hook installed by `bootstrapBuiltins()` so `addZone()` can look up the
   * concrete classes without core/ importing the registry.
   */
  static _registryLookup?: (bl_idname: string) => (new () => Node) | undefined;

  removeLink(link: NodeLink): void {
    const idx = this.links.indexOf(link);
    if (idx < 0) return;
    this.links.splice(idx, 1);
    const fi = link.from_socket.links.indexOf(link);
    if (fi >= 0) link.from_socket.links.splice(fi, 1);
    const ti = link.to_socket.links.indexOf(link);
    if (ti >= 0) link.to_socket.links.splice(ti, 1);
    this.recomputeZoneEscapes();
    this.emit({ type: 'link_removed', link });
    this.depsgraph.invalidate(link.to_node);
  }

  // ---------------------------------------------------------------------
  //  Topology
  // ---------------------------------------------------------------------
  /**
   * Kahn's algorithm — returns nodes in evaluation order (sources first).
   * Skips muted nodes correctly: a muted node's downstream still sees the
   * upstream values via internal_links (pass-through).
   */
  /**
   * Kahn's algorithm — returns nodes in evaluation order (sources first).
   * When a cycle is detected, nodes that are part of the cycle are appended
   * at the end and the `cycleNodes` property on the returned array is set so
   * evaluators can surface the error. Blender forbids cycles entirely.
   */
  topoOrder(): Node[] & { cycleNodes?: Node[] } {
    const indegree = new Map<Node, number>();
    for (const n of this.nodes) indegree.set(n, 0);
    for (const l of this.links) {
      if (!l.is_valid || l.is_muted || l.escapes_zone) continue;
      indegree.set(l.to_node, (indegree.get(l.to_node) ?? 0) + 1);
    }
    const queue: Node[] = [];
    for (const n of this.nodes) if ((indegree.get(n) ?? 0) === 0) queue.push(n);
    const out: Node[] & { cycleNodes?: Node[] } = [];
    while (queue.length) {
      const n = queue.shift()!;
      out.push(n);
      for (const l of this.links) {
        if (l.from_node !== n) continue;
        if (!l.is_valid || l.is_muted || l.escapes_zone) continue;
        const d = (indegree.get(l.to_node) ?? 0) - 1;
        indegree.set(l.to_node, d);
        if (d === 0) queue.push(l.to_node);
      }
    }
    if (out.length !== this.nodes.length) {
      // Collect nodes that are part of a cycle (still have indegree > 0).
      const cycleNodes = this.nodes.filter((n) => !out.includes(n));
      out.cycleNodes = cycleNodes;
      // Append them so evaluation can continue (with limited correctness).
      for (const n of cycleNodes) out.push(n);
    }
    return out;
  }

  /** Find an output node by class. Used by evaluators to pick a "root". */
  findRoot<N extends Node>(NodeCls: NodeCtor<N>): N | undefined {
    return this.nodes.find((n) => n instanceof NodeCls) as N | undefined;
  }

  /**
   * Re-sync all Group Input / Group Output nodes in this tree from the
   * current interface (preserving links by identifier). Call after editing
   * `interface`. Also refreshes any container nodes whose `resolvedTree` is
   * this tree, in every tree that has been registered as a listener target.
   */
  refreshGroupNodes(): void {
    for (const n of this.nodes) {
      const anyN = n as unknown as { refreshFromInterface?(t: NodeTree): void };
      anyN.refreshFromInterface?.(this);
    }
    // Notify container nodes referencing this tree to rebuild their sockets.
    for (const t of NodeTree._iterAllTrees()) {
      for (const n of t.nodes) {
        const c = n as unknown as { resolvedTree?: NodeTree; refreshSockets?(): void };
        if (c.resolvedTree === this) c.refreshSockets?.();
      }
    }
    this.emit({ type: 'evaluated' });
  }

  /**
   * Weak registry of all live NodeTrees, used for cross-tree group refresh.
   *
   * Implementation: a `Set` of `WeakRef<NodeTree>` values, pruned lazily
   * when iterated. This prevents the global reference from keeping trees alive
   * after all userland references are dropped.
   *
   * Iteration helpers live in `_iterAllTrees()`.
   */
  static _allTreeRefs: Set<WeakRef<NodeTree>> = new Set();

  /**
   * Iterate all live trees, skipping any that have been garbage-collected and
   * removing their stale `WeakRef` entries. Use this instead of `_allTrees`
   * directly.
   */
  static *_iterAllTrees(): Iterable<NodeTree> {
    for (const ref of NodeTree._allTreeRefs) {
      const t = ref.deref();
      if (t === undefined) {
        NodeTree._allTreeRefs.delete(ref);
      } else {
        yield t;
      }
    }
  }

  /**
   * Explicit disposal. Removes this tree from the global weak registry and
   * clears all listeners, freeing memory immediately. Optional — garbage
   * collection handles the WeakRef automatically, but calling `dispose()` is
   * good practice for short-lived trees (tests, undo snapshots, etc.).
   */
  dispose(): void {
    for (const ref of NodeTree._allTreeRefs) {
      if (ref.deref() === this) {
        NodeTree._allTreeRefs.delete(ref);
        break;
      }
    }
    this.listeners.clear();
    this.depsgraph.dispose();
  }

  // ---------------------------------------------------------------------------
  // Back-compat shim — keep _allTrees as a readable proxy so any callers that
  // imported the old static directly keep working without modification.
  // ---------------------------------------------------------------------------
  /** @deprecated Use `NodeTree._iterAllTrees()` instead. */
  static get _allTrees(): Set<NodeTree> {
    const live = new Set<NodeTree>();
    for (const t of NodeTree._iterAllTrees()) live.add(t);
    return live;
  }

  // ---------------------------------------------------------------------
  //  Event bus
  // ---------------------------------------------------------------------
  subscribe(fn: NodeTreeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev: NodeTreeEvent): void {
    for (const fn of this.listeners) fn(this, ev);
  }
}
