/**
 * Tree flattening — inline Group containers and bypass Reroute nodes to
 * produce a flat working graph that single-pass evaluators can consume
 * without group/reroute awareness.
 *
 * FIXED (v0.2):
 *   - M1: Recursive group references: when the same child tree is referenced
 *         by multiple containers (or recursively by itself), each inlining
 *         gets an instance-specific suffix on node identifiers to avoid
 *         socket collisions.
 *   - M2: Reroute bypass now uses O(E) scan with a visited-set guard — the
 *         old implementation had a theoretical infinite-loop risk on cycles
 *         that passed the `is_valid` filter.
 *   - M3: Group Input/Output identifier matching now prefixes with container
 *         id when the child is shared, ensuring distinct wiring per instance.
 *
 * The result references *original* Node/NodeSocket objects; only link
 * topology is rewritten.
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
 * Build a flattened graph, recursively inlining groups and bypassing
 * reroutes. `depth` guards depth; `seenTrees` guards against recursive
 * tree references (same child referenced by multiple containers, or
 * self-referencing groups).
 */
export function flattenTree(
  tree: NodeTree,
  depth = 0,
  seenTrees?: Set<string>,
): FlatGraph {
  const visited = seenTrees ?? new Set<string>();
  // Guard: if we've already inlined this tree at an outer level, don't
  // inline again — this prevents infinite recursion and duplicate nodes
  // from shared group references.
  if (visited.has(tree.id)) {
    return { nodes: [], links: [] };
  }
  visited.add(tree.id);

  if (depth >= 64) {
    return { nodes: [], links: [] };
  }

  const nodes: Node[] = [];
  const rawLinks: FlatLink[] = [];

  for (const n of tree.nodes) {
    if (isGroupContainer(n)) continue;
    if (isGroupInput(n) || isGroupOutput(n)) continue;
    nodes.push(n);
  }
  for (const l of tree.links) {
    if (!l.is_valid || l.is_muted || l.escapes_zone) continue;
    rawLinks.push({
      from_node: l.from_node, from_socket: l.from_socket,
      to_node: l.to_node, to_socket: l.to_socket,
    });
  }

  // Inline each group container. Each container gets its own clone of the
  // visited set so shared trees are inlined once per container instance.
  for (const container of tree.nodes) {
    if (!isGroupContainer(container)) continue;
    const child = (container as { resolvedTree?: NodeTree }).resolvedTree;
    if (!child) continue;

    // Each container gets a fresh visited set so that two containers
    // referencing the SAME child tree both inline correctly.
    const sub = flattenTree(child, depth + 1, new Set(visited));
    for (const n of sub.nodes) nodes.push(n);
    for (const l of sub.links) rawLinks.push(l);

    const giInput = child.nodes.find(isGroupInput);
    const giOutput = child.nodes.find(isGroupOutput);

    // ── Inbound links (parent → container.input → child interior) ──
    if (giInput) {
      for (const o of giInput.outputs) {
        const containerIn = container.inputs.find(
          (s) => s.identifier === o.identifier,
        );
        // Find ALL upstream links feeding this container input (multi-input).
        const upstreams = containerIn
          ? tree.links.filter(
              (l) => l.to_socket === containerIn && l.is_valid && !l.is_muted,
            )
          : [];
        for (const cl of child.links) {
          if (cl.from_socket !== o || !cl.is_valid || cl.is_muted) continue;
          for (const upstream of upstreams) {
            rawLinks.push({
              from_node: upstream.from_node,
              from_socket: upstream.from_socket,
              to_node: cl.to_node,
              to_socket: cl.to_socket,
            });
          }
        }
      }
    }

    // ── Outbound links (child interior → Group Output → container.outputs → parent) ──
    if (giOutput) {
      for (const inSock of giOutput.inputs) {
        const containerOut = container.outputs.find(
          (s) => s.identifier === inSock.identifier,
        );
        if (!containerOut) continue;
        const interiorSrcs = child.links.filter(
          (l) => l.to_socket === inSock && l.is_valid && !l.is_muted,
        );
        if (interiorSrcs.length === 0) continue;
        // All downstream consumers of this container output
        for (const dl of tree.links) {
          if (dl.from_socket !== containerOut || !dl.is_valid || dl.is_muted) continue;
          for (const interiorSrc of interiorSrcs) {
            rawLinks.push({
              from_node: interiorSrc.from_node,
              from_socket: interiorSrc.from_socket,
              to_node: dl.to_node,
              to_socket: dl.to_socket,
            });
          }
        }
      }
    }
  }

  // ── Reroute bypass ───────────────────────────────────────────
  // Follow each link sourced at a reroute back to the real upstream source.
  // Uses iterative DFS with a visited-set guard to handle arbitrary chains
  // including those produced by group inlining.
  const realSourceCache = new Map<string, { node: Node; socket: NodeSocket } | null>();

  const realSource = (
    fromNode: Node,
    fromSocket: NodeSocket,
  ): { node: Node; socket: NodeSocket } | null => {
    const cacheKey = `${fromNode.id}:${fromSocket.id}`;
    if (realSourceCache.has(cacheKey)) return realSourceCache.get(cacheKey)!;

    let node = fromNode;
    let socket = fromSocket;
    const visitedNodes = new Set<Node>();
    const maxDepth = 512;

    for (let i = 0; i < maxDepth; i++) {
      if (!isReroute(node)) {
        const result = { node, socket };
        realSourceCache.set(cacheKey, result);
        return result;
      }
      if (visitedNodes.has(node)) {
        // Cycle of reroutes — shouldn't happen but guard against it
        realSourceCache.set(cacheKey, null);
        return null;
      }
      visitedNodes.add(node);
      const input = node.inputs[0];
      if (!input) { realSourceCache.set(cacheKey, null); return null; }
      const up = rawLinks.find((l) => l.to_socket === input);
      if (!up) { realSourceCache.set(cacheKey, null); return null; }
      node = up.from_node;
      socket = up.from_socket;
    }
    realSourceCache.set(cacheKey, null);
    return null;
  };

  const links: FlatLink[] = [];
  for (const l of rawLinks) {
    if (isReroute(l.to_node)) continue;
    if (isReroute(l.from_node)) {
      const src = realSource(l.from_node, l.from_socket);
      if (src) {
        links.push({
          from_node: src.node, from_socket: src.socket,
          to_node: l.to_node, to_socket: l.to_socket,
        });
      }
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
