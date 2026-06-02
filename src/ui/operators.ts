/**
 * Editor operators (M8) — pure, headless-testable tree manipulations that the
 * React UI invokes. Kept free of React so they can be unit-tested and reused.
 *
 *   - autoLayout(tree)         : assign columns by topological depth
 *   - makeGroup(tree, nodes)   : pack a node selection into a child group
 *   - ungroup(tree, container) : inline a group container back into the tree
 *   - History                  : snapshot-based undo/redo over BNG JSON
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import { exportDocument } from '../bridge/exporter';
import { importDocument } from '../bridge/importer';

/* ------------------------------------------------------------------ */
/*  Auto-layout                                                        */
/* ------------------------------------------------------------------ */

/**
 * Assign each node an (x, y) based on its longest-path depth from a source.
 * Nodes in the same depth column are stacked vertically. Pure layout; mutates
 * `node.location`.
 */
export function autoLayout(tree: NodeTree, opts: { colGap?: number; rowGap?: number } = {}): void {
  const colGap = opts.colGap ?? 220;
  const rowGap = opts.rowGap ?? 160;
  const depth = new Map<Node, number>();
  const order = tree.topoOrder();
  for (const n of order) depth.set(n, 0);
  for (const n of order) {
    const d = depth.get(n) ?? 0;
    for (const l of tree.links) {
      if (l.from_node !== n || !l.is_valid) continue;
      depth.set(l.to_node, Math.max(depth.get(l.to_node) ?? 0, d + 1));
    }
  }
  const byCol = new Map<number, Node[]>();
  for (const n of tree.nodes) {
    const d = depth.get(n) ?? 0;
    (byCol.get(d) ?? byCol.set(d, []).get(d)!).push(n);
  }
  for (const [col, nodes] of byCol) {
    nodes.forEach((n, row) => { n.location = [col * colGap, row * rowGap]; });
  }
}

/* ------------------------------------------------------------------ */
/*  Undo / redo history                                                */
/* ------------------------------------------------------------------ */

/**
 * Snapshot-based history. Each push serialises the tree to BNG JSON; undo/redo
 * re-imports. Coarse but robust and matches the bridge round-trip guarantees.
 */
export class History {
  private stack: string[] = [];
  private index = -1;
  constructor(private limit = 100) {}

  /** Capture the current state. Truncates any redo tail. */
  push(tree: NodeTree): void {
    const snap = JSON.stringify(exportDocument([tree]));
    // Drop redo tail.
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.stack.length - 1; }

  /** Returns the freshly re-imported NodeTree at the previous snapshot. */
  undo(): NodeTree | null {
    if (!this.canUndo) return null;
    this.index -= 1;
    return this.restore();
  }
  redo(): NodeTree | null {
    if (!this.canRedo) return null;
    this.index += 1;
    return this.restore();
  }
  private restore(): NodeTree | null {
    const snap = this.stack[this.index];
    if (!snap) return null;
    const trees = importDocument(JSON.parse(snap));
    return trees[0] ?? null;
  }
}

/* ------------------------------------------------------------------ */
/*  Make Group / Ungroup                                               */
/* ------------------------------------------------------------------ */

/**
 * Pack a selection of nodes into a new child group tree, replacing them with a
 * single Group container in the parent. Links crossing the selection boundary
 * become the group's interface sockets.
 *
 * Requires the registry hook (bootstrapBuiltins) so the right Group classes
 * and sockets can be instantiated.
 */
export function makeGroup(
  parent: NodeTree,
  selection: Node[],
  ctors: {
    childTree: new (name?: string) => NodeTree;
    groupContainer: new () => Node;
    groupInput: new () => Node;
    groupOutput: new () => Node;
  },
): { container: Node; child: NodeTree } {
  const sel = new Set(selection);
  const child = new ctors.childTree('Group');

  // Boundary links.
  const incoming = parent.links.filter((l) => !sel.has(l.from_node) && sel.has(l.to_node) && l.is_valid);
  const outgoing = parent.links.filter((l) => sel.has(l.from_node) && !sel.has(l.to_node) && l.is_valid);

  // Build interface from boundary sockets (dedupe by source/target socket).
  const inIfaceBySock = new Map<string, string>();
  for (const l of incoming) {
    const key = l.to_socket.id;
    if (inIfaceBySock.has(key)) continue;
    const it = child.interface.new_socket({ name: l.to_socket.name, in_out: 'INPUT', socket_type: l.to_socket.bl_idname });
    inIfaceBySock.set(key, it.identifier);
  }
  const outIfaceBySock = new Map<string, string>();
  for (const l of outgoing) {
    const key = l.from_socket.id;
    if (outIfaceBySock.has(key)) continue;
    const it = child.interface.new_socket({ name: l.from_socket.name, in_out: 'OUTPUT', socket_type: l.from_socket.bl_idname });
    outIfaceBySock.set(key, it.identifier);
  }

  // Move selected nodes into the child tree (re-parent + re-home links).
  const internalLinks = parent.links.filter((l) => sel.has(l.from_node) && sel.has(l.to_node));
  for (const n of selection) {
    const i = parent.nodes.indexOf(n);
    if (i >= 0) parent.nodes.splice(i, 1);
    n.tree = child;
    child.nodes.push(n);
  }
  // Move internal links.
  for (const l of internalLinks) {
    const pi = parent.links.indexOf(l);
    if (pi >= 0) parent.links.splice(pi, 1);
    child.links.push(l);
  }

  // Group I/O nodes inside the child.
  const gin = child.addNode(ctors.groupInput as never);
  const gout = child.addNode(ctors.groupOutput as never);
  (gin as unknown as { refreshFromInterface(t: NodeTree): void }).refreshFromInterface(child);
  (gout as unknown as { refreshFromInterface(t: NodeTree): void }).refreshFromInterface(child);

  // Wire interior: incoming → Group Input output; interior out → Group Output input.
  for (const l of incoming) {
    const ifaceId = inIfaceBySock.get(l.to_socket.id)!;
    const src = gin.outputs.find((s) => s.identifier === ifaceId);
    if (src) child.addLink(src, l.to_socket);
  }
  for (const l of outgoing) {
    const ifaceId = outIfaceBySock.get(l.from_socket.id)!;
    const dst = gout.inputs.find((s) => s.identifier === ifaceId);
    if (dst) child.addLink(l.from_socket, dst);
  }

  // Container in the parent.
  const container = parent.addNode(ctors.groupContainer as never);
  (container as unknown as { setNodeTree(t: NodeTree): void }).setNodeTree(child);

  // Reconnect parent boundary links to the container.
  for (const l of incoming) {
    const ifaceId = inIfaceBySock.get(l.to_socket.id)!;
    const cIn = container.inputs.find((s) => s.identifier === ifaceId);
    const pi = parent.links.indexOf(l);
    if (pi >= 0) parent.links.splice(pi, 1);
    // remove from socket link lists
    l.from_socket.links = l.from_socket.links.filter((x) => x !== l);
    l.to_socket.links = l.to_socket.links.filter((x) => x !== l);
    if (cIn) parent.addLink(l.from_socket, cIn);
  }
  for (const l of outgoing) {
    const ifaceId = outIfaceBySock.get(l.from_socket.id)!;
    const cOut = container.outputs.find((s) => s.identifier === ifaceId);
    const pi = parent.links.indexOf(l);
    if (pi >= 0) parent.links.splice(pi, 1);
    l.from_socket.links = l.from_socket.links.filter((x) => x !== l);
    l.to_socket.links = l.to_socket.links.filter((x) => x !== l);
    if (cOut) parent.addLink(cOut, l.to_socket);
  }

  return { container, child };
}

/**
 * Inline a group container back into its parent tree (reverse of makeGroup):
 * splices the child's interior nodes into the parent and rewires across the
 * Group I/O boundary. Returns the inlined nodes.
 */
export function ungroup(parent: NodeTree, container: Node): Node[] {
  const child = (container as unknown as { resolvedTree?: NodeTree }).resolvedTree;
  if (!child) return [];
  const gin = child.nodes.find((n) => n.bl_idname === 'NodeGroupInput');
  const gout = child.nodes.find((n) => n.bl_idname === 'NodeGroupOutput');

  const inlined = child.nodes.filter((n) => n !== gin && n !== gout);
  // Strip every interior socket link that touches Group I/O so no stale
  // back-references survive the move; remember the interior endpoints to
  // rewire afterwards.
  const ginTargets: { ifaceId: string; toSocket: typeof container.inputs[number] }[] = [];
  const goutSources: { ifaceId: string; fromSocket: typeof container.outputs[number] }[] = [];
  for (const l of child.links.slice()) {
    if (gin && l.from_node === gin) {
      ginTargets.push({ ifaceId: l.from_socket.identifier, toSocket: l.to_socket });
      l.from_socket.links = l.from_socket.links.filter((x) => x !== l);
      l.to_socket.links = l.to_socket.links.filter((x) => x !== l);
      continue;
    }
    if (gout && l.to_node === gout) {
      goutSources.push({ ifaceId: l.to_socket.identifier, fromSocket: l.from_socket });
      l.from_socket.links = l.from_socket.links.filter((x) => x !== l);
      l.to_socket.links = l.to_socket.links.filter((x) => x !== l);
      continue;
    }
  }
  // Move interior nodes into parent.
  for (const n of inlined) { n.tree = parent; parent.nodes.push(n); }
  // Move interior links (excluding those touching Group I/O — already stripped).
  for (const l of child.links) {
    if (l.from_node === gin || l.to_node === gout) continue;
    parent.links.push(l);
  }

  // For each container input: connect its upstream source to whatever the
  // matching Group Input output fed inside the child.
  for (const gt of ginTargets) {
    const cIn = container.inputs.find((s) => s.identifier === gt.ifaceId);
    const upstream = cIn ? parent.links.find((l) => l.to_socket === cIn) : undefined;
    if (upstream) parent.addLink(upstream.from_socket, gt.toSocket);
  }
  // For each container output: connect interior source to downstream consumers.
  for (const gs of goutSources) {
    const cOut = container.outputs.find((s) => s.identifier === gs.ifaceId);
    const downstream = cOut ? parent.links.filter((l) => l.from_socket === cOut) : [];
    for (const dl of downstream) parent.addLink(gs.fromSocket, dl.to_socket);
  }

  // Remove the container + its parent links.
  parent.removeNode(container);
  return inlined;
}
