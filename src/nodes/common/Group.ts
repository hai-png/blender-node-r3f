/**
 * Group I/O + Group container nodes.
 *
 *   NodeGroupInput  - exposes the parent tree's interface inputs as outputs
 *   NodeGroupOutput - exposes the parent tree's interface outputs as inputs
 *   <System>NodeGroup - a node that "instances" another NodeTree, exposing
 *                      its interface as the node's sockets.
 *
 * The actual recursive evaluation is performed by each system evaluator —
 * see `src/eval/*Evaluator.ts`.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeRegistry } from '../../registry/NodeRegistry';
import type { NodeTree } from '../../core/NodeTree';
import type { NodeSocket } from '../../core/NodeSocket';

export class NodeGroupInput extends Node {
  static override bl_idname = 'NodeGroupInput';
  static override bl_label = 'Group Input';
  static override category = 'Group';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];

  override init(ctx: NodeInitContext): void {
    this.refreshFromInterface(ctx.tree);
  }

  refreshFromInterface(tree: NodeTree): void {
    const prev = new Map(this.outputs.map((s) => [s.identifier, s]));
    const next: NodeSocket[] = [];
    for (const sock of tree.interface.inputs()) {
      const existing = prev.get(sock.identifier);
      if (existing && existing.bl_idname === sock.socket_type) {
        existing.name = sock.name;
        next.push(existing); // preserves links
        continue;
      }
      const SockCls = NodeRegistry.getSocket(sock.socket_type);
      if (!SockCls) continue;
      const out = new SockCls();
      out.is_output = true;
      out.node = this;
      out.init({ name: sock.name, identifier: sock.identifier, default_value: sock.default_value });
      next.push(out as NodeSocket);
    }
    this.outputs = next;
  }
}

export class NodeGroupOutput extends Node {
  static override bl_idname = 'NodeGroupOutput';
  static override bl_label = 'Group Output';
  static override category = 'Group';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];

  override init(ctx: NodeInitContext): void {
    this.refreshFromInterface(ctx.tree);
  }

  refreshFromInterface(tree: NodeTree): void {
    const prev = new Map(this.inputs.map((s) => [s.identifier, s]));
    const next: NodeSocket[] = [];
    for (const sock of tree.interface.outputs()) {
      const existing = prev.get(sock.identifier);
      if (existing && existing.bl_idname === sock.socket_type) {
        existing.name = sock.name;
        next.push(existing);
        continue;
      }
      const SockCls = NodeRegistry.getSocket(sock.socket_type);
      if (!SockCls) continue;
      const ins = new SockCls();
      ins.is_output = false;
      ins.node = this;
      ins.init({ name: sock.name, identifier: sock.identifier, default_value: sock.default_value });
      next.push(ins as NodeSocket);
    }
    this.inputs = next;
  }
}

/**
 * Group container. `node_tree` is a soft reference (by name/id) to a child
 * NodeTree of the same kind. The evaluator recursively evaluates the child
 * tree with this node's inputs.
 */
export class NodeGroupBase extends Node {
  static override properties = {
    node_tree: StringProperty({ default: '', name: 'Tree' }),
  };
  declare node_tree: string;
  /** Resolved at evaluation time. */
  resolvedTree?: NodeTree;

  override init(_ctx: NodeInitContext): void {
    // Sockets get filled when a tree reference is set via `setNodeTree()`.
  }

  setNodeTree(child: NodeTree): void {
    this.resolvedTree = child;
    this.node_tree = child.id;
    this.refreshSockets();
  }

  /**
   * Rebuild this container's sockets from the referenced child tree's
   * interface, preserving existing sockets (and their links) by identifier.
   * Call after the child interface changes.
   */
  refreshSockets(): void {
    const child = this.resolvedTree;
    if (!child) return;
    const build = (defs: ReturnType<NodeTree['interface']['inputs']>, isOut: boolean, prevList: NodeSocket[]): NodeSocket[] => {
      const prev = new Map(prevList.map((x) => [x.identifier, x]));
      const next: NodeSocket[] = [];
      for (const sock of defs) {
        const existing = prev.get(sock.identifier);
        if (existing && existing.bl_idname === sock.socket_type) {
          existing.name = sock.name;
          next.push(existing);
          continue;
        }
        const SockCls = NodeRegistry.getSocket(sock.socket_type);
        if (!SockCls) continue;
        const s = new SockCls();
        s.is_output = isOut;
        s.node = this;
        s.init({ name: sock.name, identifier: sock.identifier, default_value: sock.default_value });
        next.push(s as NodeSocket);
      }
      return next;
    };
    this.inputs = build(child.interface.inputs(), false, this.inputs);
    this.outputs = build(child.interface.outputs(), true, this.outputs);
  }
}

export class ShaderNodeGroup extends NodeGroupBase {
  static override bl_idname = 'ShaderNodeGroup';
  static override bl_label = 'Group';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
  static override category = 'Group';
}
export class GeometryNodeGroup extends NodeGroupBase {
  static override bl_idname = 'GeometryNodeGroup';
  static override bl_label = 'Group';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static override category = 'Group';
}
export class CompositorNodeGroup extends NodeGroupBase {
  static override bl_idname = 'CompositorNodeGroup';
  static override bl_label = 'Group';
  static override tree_types: NodeTreeKind[] = ['CompositorNodeTree'];
  static override category = 'Group';
}
export class TextureNodeGroup extends NodeGroupBase {
  static override bl_idname = 'TextureNodeGroup';
  static override bl_label = 'Group';
  static override tree_types: NodeTreeKind[] = ['TextureNodeTree'];
  static override category = 'Group';
}

let _registered = false;
export function registerGroupNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [NodeGroupInput, NodeGroupOutput, ShaderNodeGroup, GeometryNodeGroup, CompositorNodeGroup, TextureNodeGroup]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
