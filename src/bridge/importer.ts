/**
 * Imports a BNG JSON document into runtime NodeTree(s).
 */
import { BngDocument, type BngDocumentT, type BngTreeT, type BngNodeT } from './schema';
import { NodeRegistry } from '../registry/NodeRegistry';
import { ShaderNodeTree, GeometryNodeTree, CompositorNodeTree, TextureNodeTree } from '../core/trees';
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import type { NodeTreeInterfacePanel, NodeTreeInterfaceItem } from '../core/NodeTreeInterface';

const TREE_CTORS = {
  ShaderNodeTree,
  GeometryNodeTree,
  CompositorNodeTree,
  TextureNodeTree,
} as const;

export function importDocument(json: unknown): NodeTree[] {
  const doc = BngDocument.parse(json) as BngDocumentT;
  // First pass: instantiate empty trees so Group containers can find them by id.
  const trees = new Map<string, NodeTree>();
  for (const t of doc.trees) {
    const TreeCtor = TREE_CTORS[t.bl_idname];
    const tree = new TreeCtor(t.name);
    (tree as unknown as { id: string }).id = t.id;
    buildInterface(tree, t);
    trees.set(t.id, tree);
  }
  // Second pass: nodes + links.
  for (const t of doc.trees) {
    const tree = trees.get(t.id)!;
    populateTree(tree, t, trees);
  }
  return [...trees.values()];
}

function buildInterface(tree: NodeTree, src: BngTreeT): void {
  const byId = new Map<string, NodeTreeInterfaceItem>();
  const pendingParents: { item: NodeTreeInterfaceItem; parentId: string }[] = [];

  for (const it of src.interface.items) {
    if (it.kind === 'panel') {
      const parent = it.parent ? asPanel(byId.get(it.parent)) : undefined;
      const panel = tree.interface.new_panel(
        it.name,
        it.default_closed ?? false,
        it.description ?? '',
        parent,
        it.identifier,
      );
      byId.set(it.identifier, panel);
      if (it.parent && !parent) pendingParents.push({ item: panel, parentId: it.parent });
    } else {
      const parent = it.parent ? asPanel(byId.get(it.parent)) : undefined;
      const sock = tree.interface.new_socket({
        name: it.name,
        description: it.description ?? '',
        in_out: it.in_out,
        socket_type: it.socket_type,
        default_value: it.default_value,
        identifier: it.identifier,
        parent,
      });
      byId.set(it.identifier, sock);
      if (it.parent && !parent) pendingParents.push({ item: sock, parentId: it.parent });
    }
  }

  // Parent references are usually top-down, but the BNG schema permits any
  // item order. Repair late parent links without disturbing items_tree order.
  for (const { item, parentId } of pendingParents) {
    const parent = asPanel(byId.get(parentId));
    if (!parent) continue;
    item.parent = parent;
    if (!parent.items.includes(item)) parent.items.push(item);
  }
}

function asPanel(item: NodeTreeInterfaceItem | undefined): NodeTreeInterfacePanel | undefined {
  return item && item.kind === 'PANEL' ? item as NodeTreeInterfacePanel : undefined;
}

function populateTree(tree: NodeTree, src: BngTreeT, allTrees: Map<string, NodeTree>): void {
  const idMap = new Map<string, Node>();
  const sourceByNode = new Map<Node, BngNodeT>();

  // Nodes first: instantiate and assign scalar properties. Socket defaults are
  // applied later, after dynamic sockets (groups/zones) have been rebuilt.
  for (const n of src.nodes) {
    const NodeCtor = NodeRegistry.getNode(n.bl_idname);
    if (!NodeCtor) {
      console.warn(`Unknown node type "${n.bl_idname}" — skipping.`);
      continue;
    }
    const node = tree.addNode(NodeCtor as unknown as Parameters<typeof tree.addNode>[0], {
      name: n.name,
      location: n.location,
      ...(n.label !== undefined ? { label: n.label } : {}),
    });
    (node as unknown as { id: string }).id = n.id;
    if (n.width) node.width = n.width;
    if (n.mute) node.mute = true;
    if (n.hide) node.hide = true;
    if (n.properties) {
      for (const [k, v] of Object.entries(n.properties)) {
        (node as unknown as Record<string, unknown>)[k] = v;
      }
    }
    if (n.state_items && 'state_items' in node) {
      (node as unknown as { state_items: unknown }).state_items = structuredClone(n.state_items);
    }
    idMap.set(n.id, node);
    sourceByNode.set(node, n);
  }

  // Resolve Group containers after every tree exists. Prefer BNG tree ids, but
  // accept Blender-exporter legacy documents that used a child tree name.
  for (const [node, n] of sourceByNode) {
    if (n.node_tree && 'setNodeTree' in node) {
      const child = allTrees.get(n.node_tree) ?? [...allTrees.values()].find((t) => t.name === n.node_tree);
      if (child) (node as unknown as { setNodeTree(t: NodeTree): void }).setNodeTree(child);
    }
  }

  // Rebuild dynamic zone sockets after zone_id/state_items properties are in
  // place. Inputs first so paired outputs can copy the input's state item list.
  const dynamic = [...sourceByNode.keys()].filter((node) => {
    const ctor = node.constructor as typeof Node & { node_kind?: string };
    return !!ctor.node_kind && typeof (node as unknown as { rebuildSockets?: unknown }).rebuildSockets === 'function';
  });
  for (const node of dynamic.filter((n) => (n.constructor as typeof Node & { node_kind?: string }).node_kind === 'ZONE_INPUT')) {
    (node as unknown as { rebuildSockets(): void }).rebuildSockets();
  }
  for (const node of dynamic.filter((n) => (n.constructor as typeof Node & { node_kind?: string }).node_kind === 'ZONE_OUTPUT')) {
    (node as unknown as { rebuildSockets(): void }).rebuildSockets();
  }

  // Now apply socket defaults for both inputs and outputs. Output defaults are
  // critical for Blender input-style nodes such as RGB/Value.
  for (const [node, n] of sourceByNode) applySocketDefaults(node, n);

  // Links (by rename-safe socket identifier).
  for (const l of src.links) {
    const from = idMap.get(l.from_node);
    const to = idMap.get(l.to_node);
    if (!from || !to) continue;
    const fromS = from.findOutput(l.from_socket);
    const toS = to.findInput(l.to_socket);
    if (!fromS || !toS) continue;
    const link = tree.addLink(fromS, toS);
    if (l.is_muted) link.is_muted = true;
  }
}

function applySocketDefaults(node: Node, n: BngNodeT): void {
  if (n.inputs) {
    for (const sdef of n.inputs) {
      const s = node.findInput(sdef.identifier);
      if (!s) continue;
      if (sdef.default_value !== undefined) (s.default_value as unknown) = sdef.default_value;
      if (sdef.hide_value !== undefined) s.hide_value = sdef.hide_value;
    }
  }
  if (n.outputs) {
    for (const sdef of n.outputs) {
      const s = node.findOutput(sdef.identifier);
      if (!s) continue;
      if (sdef.default_value !== undefined) (s.default_value as unknown) = sdef.default_value;
      if (sdef.hide_value !== undefined) s.hide_value = sdef.hide_value;
    }
  }
}
