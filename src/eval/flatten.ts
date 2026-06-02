/**
 * Tree flattening — inline Group containers and bypass Reroute nodes to
 * produce a flat working graph that single-pass evaluators (e.g. the
 * Compositor planner) can consume without group/reroute awareness.
 *
 * Blender conceptually *inlines* node groups during evaluation: a group node
 * behaves exactly like pasting its child tree in place, with the container's
 * input sockets feeding the child's Group Input outputs and the child's Group
 * Output inputs feeding the container's outputs. This utility realises that
 * by producing a derived list of nodes + "effective links" that route around
 * Group I/O and Reroute nodes.
 *
 * The result references the *original* Node and NodeSocket objects (so the
 * evaluator's per-socket caches still work); only the link topology is
 * rewritten.
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';

export interface FlatLink {
  from_node: Node;
  from_socket: NodeSocket;
  to_node: Node;
  to_socket: NodeSocket;
}

export interface FlatGraph {
  nodes: Node[];
  links: FlatLink[];
}

function isGroupContainer(n: Node): boolean {
  if ((n as { resolvedTree?: unknown }).resolvedTree !== undefined) return true;
  return /NodeGroup$/.test(n.bl_idname)
    && n.bl_idname !== 'NodeGroupInput'
    && n.bl_idname !== 'NodeGroupOutput';
}
function isReroute(n: Node): boolean { return n.bl_idname === 'NodeReroute'; }
function isGroupInput(n: Node): boolean { return n.bl_idname === 'NodeGroupInput'; }
function isGroupOutput(n: Node): boolean { return n.bl_idname === 'NodeGroupOutput'; }

/**
 * Build a flattened graph from a tree, recursively inlining groups and
 * bypassing reroutes. `depth` guards against accidental recursion cycles.
 */
export function flattenTree(tree: NodeTree, depth = 0): FlatGraph {
  const nodes: Node[] = [];
  const rawLinks: FlatLink[] = [];

  for (const n of tree.nodes) {
    if (isGroupContainer(n)) continue;
    if (isGroupInput(n) || isGroupOutput(n)) continue;
    nodes.push(n);
  }
  for (const l of tree.links) {
    if (!l.is_valid || l.is_muted || l.escapes_zone) continue;
    rawLinks.push({ from_node: l.from_node, from_socket: l.from_socket, to_node: l.to_node, to_socket: l.to_socket });
  }

  // Inline each group container.
  if (depth < 64) {
    for (const container of tree.nodes) {
      if (!isGroupContainer(container)) continue;
      const child = (container as { resolvedTree?: NodeTree }).resolvedTree;
      if (!child) continue;
      const sub = flattenTree(child, depth + 1);
      for (const n of sub.nodes) nodes.push(n);
      for (const l of sub.links) rawLinks.push(l);

      const giInput = child.nodes.find(isGroupInput);
      const giOutput = child.nodes.find(isGroupOutput);

      // Links INTO the container → child interior consumers of the matching
      // Group Input output.
      if (giInput) {
        for (const o of giInput.outputs) {
          const containerIn = container.inputs.find((s) => s.identifier === o.identifier);
          const upstream = containerIn
            ? tree.links.find((l) => l.to_socket === containerIn && l.is_valid && !l.is_muted)
            : undefined;
          for (const cl of child.links) {
            if (cl.from_socket !== o || !cl.is_valid || cl.is_muted) continue;
            if (upstream) {
              rawLinks.push({ from_node: upstream.from_node, from_socket: upstream.from_socket, to_node: cl.to_node, to_socket: cl.to_socket });
            }
          }
        }
      }

      // Container OUTPUT consumers → interior source feeding the matching
      // Group Output input.
      if (giOutput) {
        for (const inSock of giOutput.inputs) {
          const containerOut = container.outputs.find((s) => s.identifier === inSock.identifier);
          if (!containerOut) continue;
          const interiorSrc = child.links.find((l) => l.to_socket === inSock && l.is_valid && !l.is_muted);
          if (!interiorSrc) continue;
          for (const dl of tree.links) {
            if (dl.from_socket !== containerOut || !dl.is_valid || dl.is_muted) continue;
            rawLinks.push({ from_node: interiorSrc.from_node, from_socket: interiorSrc.from_socket, to_node: dl.to_node, to_socket: dl.to_socket });
          }
        }
      }
    }
  }

  // Bypass reroutes: follow each link sourced at a reroute back to the real
  // upstream source.
  const realSource = (fromNode: Node, fromSocket: NodeSocket): { node: Node; socket: NodeSocket } | null => {
    let node = fromNode, socket = fromSocket;
    const guard = new Set<NodeSocket>();
    while (isReroute(node)) {
      if (guard.has(socket)) return null;
      guard.add(socket);
      const input = node.inputs[0];
      if (!input) return null;
      const up = rawLinks.find((l) => l.to_socket === input);
      if (!up) return null;
      node = up.from_node; socket = up.from_socket;
    }
    return { node, socket };
  };

  const links: FlatLink[] = [];
  for (const l of rawLinks) {
    if (isReroute(l.to_node)) continue;
    if (isReroute(l.from_node)) {
      const src = realSource(l.from_node, l.from_socket);
      if (src) links.push({ from_node: src.node, from_socket: src.socket, to_node: l.to_node, to_socket: l.to_socket });
      continue;
    }
    links.push(l);
  }

  const finalNodes = nodes.filter((n) => !isReroute(n));
  return { nodes: finalNodes, links };
}

/** Kahn topological order over a FlatGraph (sources first). */
export function flatTopoOrder(g: FlatGraph): Node[] {
  const indeg = new Map<Node, number>();
  for (const n of g.nodes) indeg.set(n, 0);
  const present = new Set(g.nodes);
  for (const l of g.links) {
    if (!present.has(l.to_node) || !present.has(l.from_node)) continue;
    indeg.set(l.to_node, (indeg.get(l.to_node) ?? 0) + 1);
  }
  const queue: Node[] = [];
  for (const n of g.nodes) if ((indeg.get(n) ?? 0) === 0) queue.push(n);
  const out: Node[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const l of g.links) {
      if (l.from_node !== n || !present.has(l.to_node)) continue;
      const d = (indeg.get(l.to_node) ?? 0) - 1;
      indeg.set(l.to_node, d);
      if (d === 0) queue.push(l.to_node);
    }
  }
  for (const n of g.nodes) if (!out.includes(n)) out.push(n);
  return out;
}
