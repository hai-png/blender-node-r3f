/**
 * Exports runtime NodeTree(s) back to BNG JSON. Round-trippable with importer.
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import type { BngDocumentT, BngTreeT, BngNodeT, BngLinkT } from './schema';

export function exportDocument(trees: NodeTree[], blenderVersion = 'runtime'): BngDocumentT {
  return {
    schema: 'BNG/1',
    blender_version: blenderVersion,
    trees: trees.map(exportTree),
  };
}

function exportTree(tree: NodeTree): BngTreeT {
  return {
    id: tree.id,
    bl_idname: (tree.constructor as unknown as { bl_idname: BngTreeT['bl_idname'] }).bl_idname,
    name: tree.name,
    interface: {
      items: tree.interface.items_tree.map((it) => {
        if (it.kind === 'SOCKET') {
          const s = it as unknown as {
            in_out: 'INPUT' | 'OUTPUT'; socket_type: string; name: string; identifier: string;
            description?: string; default_value?: unknown; parent?: { id: string };
          };
          return {
            kind: 'socket' as const,
            in_out: s.in_out,
            socket_type: s.socket_type,
            name: s.name,
            identifier: s.identifier,
            description: s.description,
            default_value: s.default_value,
            parent: s.parent?.id ?? null,
          };
        }
        const p = it as unknown as {
          name: string; id: string; description?: string; default_closed?: boolean; parent?: { id: string };
        };
        return {
          kind: 'panel' as const,
          name: p.name,
          identifier: p.id,
          description: p.description,
          default_closed: p.default_closed,
          parent: p.parent?.id ?? null,
        };
      }),
    },
    nodes: tree.nodes.map(exportNode),
    links: tree.links.map<BngLinkT>((l) => ({
      from_node: l.from_node.id,
      from_socket: l.from_socket.identifier,
      to_node: l.to_node.id,
      to_socket: l.to_socket.identifier,
      is_muted: l.is_muted || undefined,
    })),
  };
}

function exportNode(n: Node): BngNodeT {
  const propsSchema = (n.constructor as typeof Node).properties;
  const properties: Record<string, unknown> = {};
  for (const k of Object.keys(propsSchema ?? {})) {
    properties[k] = (n as unknown as Record<string, unknown>)[k];
  }
  const nodeTree = (n as unknown as { node_tree?: string }).node_tree ?? null;
  const stateItems = (n as unknown as { state_items?: unknown }).state_items;
  return {
    id: n.id,
    bl_idname: n.bl_idname,
    name: n.name,
    label: n.label || undefined,
    location: n.location,
    width: n.width,
    mute: n.mute || undefined,
    hide: n.hide || undefined,
    properties,
    inputs: n.inputs.map((s) => ({
      identifier: s.identifier,
      name: s.name,
      socket_type: s.bl_idname,
      default_value: s.default_value,
      hide_value: s.hide_value || undefined,
    })),
    outputs: n.outputs.map((s) => ({
      identifier: s.identifier,
      name: s.name,
      socket_type: s.bl_idname,
      default_value: s.default_value,
      hide_value: s.hide_value || undefined,
    })),
    node_tree: nodeTree,
    ...(Array.isArray(stateItems) ? { state_items: structuredClone(stateItems) } : {}),
  };
}
