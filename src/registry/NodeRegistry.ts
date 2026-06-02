/**
 * NodeRegistry — mirror of bpy.utils.register_class for nodes/sockets/trees.
 *
 *   NodeRegistry.register(MyNode);
 *   NodeRegistry.registerSocket(MySocket);
 *   NodeRegistry.registerTree(MyTree);
 */
import type { Node } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';
import type { NodeTree } from '../core/NodeTree';
import type { NodeTreeKind } from '../core/types';

type AnyNodeCtor = (new () => Node) & {
  bl_idname: string;
  bl_label: string;
  category?: string;
  tree_types: NodeTreeKind[];
};
type AnySocketCtor = (new () => NodeSocket) & {
  bl_idname: string;
  bl_label: string;
};
type AnyTreeCtor = (new (name?: string) => NodeTree) & {
  bl_idname: NodeTreeKind;
  bl_label: string;
};

class _Registry {
  private nodes = new Map<string, AnyNodeCtor>();
  private sockets = new Map<string, AnySocketCtor>();
  private trees = new Map<string, AnyTreeCtor>();
  private listeners = new Set<() => void>();

  register(cls: AnyNodeCtor): void {
    if (!cls.bl_idname) throw new Error('Node class missing static bl_idname');
    if (this.nodes.has(cls.bl_idname)) {
      console.warn(`Node "${cls.bl_idname}" already registered; overwriting.`);
    }
    this.nodes.set(cls.bl_idname, cls);
    this.notify();
  }
  registerSocket(cls: AnySocketCtor): void {
    if (!cls.bl_idname) throw new Error('Socket class missing static bl_idname');
    this.sockets.set(cls.bl_idname, cls);
    this.notify();
  }
  registerTree(cls: AnyTreeCtor): void {
    if (!cls.bl_idname) throw new Error('Tree class missing static bl_idname');
    this.trees.set(cls.bl_idname, cls);
    this.notify();
  }

  unregister(bl_idname: string): void {
    this.nodes.delete(bl_idname);
    this.sockets.delete(bl_idname);
    this.trees.delete(bl_idname);
    this.notify();
  }

  getNode(bl_idname: string): AnyNodeCtor | undefined {
    return this.nodes.get(bl_idname);
  }
  getSocket(bl_idname: string): AnySocketCtor | undefined {
    return this.sockets.get(bl_idname);
  }
  getTree(bl_idname: string): AnyTreeCtor | undefined {
    return this.trees.get(bl_idname);
  }

  listForTree(kind: NodeTreeKind): AnyNodeCtor[] {
    return [...this.nodes.values()].filter((n) => n.tree_types.includes(kind));
  }
  listAllNodes(): AnyNodeCtor[] {
    return [...this.nodes.values()];
  }
  listAllSockets(): AnySocketCtor[] {
    return [...this.sockets.values()];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void {
    for (const f of this.listeners) f();
  }
}

export const NodeRegistry = new _Registry();

/** NodeCategory mirrors nodeitems_utils.NodeCategory + NodeItem. */
export class NodeItem {
  constructor(
    public bl_idname: string,
    public label?: string,
    public settings?: Record<string, unknown>,
  ) {}
}

export class NodeCategory {
  constructor(
    public id: string,
    public label: string,
    public items: NodeItem[],
    public poll?: (treeKind: NodeTreeKind) => boolean,
  ) {}
}

class _Categories {
  private byPack = new Map<string, NodeCategory[]>();
  register(packId: string, cats: NodeCategory[]): void {
    this.byPack.set(packId, cats);
  }
  unregister(packId: string): void {
    this.byPack.delete(packId);
  }
  list(treeKind: NodeTreeKind): NodeCategory[] {
    const out: NodeCategory[] = [];
    for (const cats of this.byPack.values()) {
      for (const c of cats) {
        if (!c.poll || c.poll(treeKind)) out.push(c);
      }
    }
    return out;
  }
}
export const NodeCategories = new _Categories();
