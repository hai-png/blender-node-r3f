/**
 * Imports a BNG JSON document into runtime NodeTree(s).
 */
import { BngDocument, type BngDocumentT, type BngTreeT } from './schema';
import { NodeRegistry } from '../registry/NodeRegistry';
import { ShaderNodeTree, GeometryNodeTree, CompositorNodeTree, TextureNodeTree } from '../core/trees';
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';

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
    // build interface
    for (const it of t.interface.items) {
      if (it.kind === 'socket') {
        tree.interface.new_socket({
          name: it.name,
          description: it.description ?? '',
          in_out: it.in_out,
          socket_type: it.socket_type,
          default_value: it.default_value,
          identifier: it.identifier,
        });
      } else {
        tree.interface.new_panel(it.name, it.default_closed ?? false, it.description ?? '');
      }
    }
    trees.set(t.id, tree);
  }
  // Second pass: nodes + links
  for (const t of doc.trees) {
    const tree = trees.get(t.id)!;
    populateTree(tree, t, trees);
  }
  return [...trees.values()];
}

function populateTree(tree: NodeTree, src: BngTreeT, allTrees: Map<string, NodeTree>): void {
  // nodes
  const idMap = new Map<string, Node>();
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
    if (n.inputs) {
      for (const sdef of n.inputs) {
        const s = node.findInput(sdef.identifier);
        if (s && sdef.default_value !== undefined) {
          (s.default_value as unknown) = sdef.default_value;
        }
      }
    }
    // Group container resolution
    if (n.node_tree && 'setNodeTree' in node) {
      const child = allTrees.get(n.node_tree);
      if (child) (node as unknown as { setNodeTree(t: NodeTree): void }).setNodeTree(child);
    }
    idMap.set(n.id, node);
  }
  // links (by identifier)
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
