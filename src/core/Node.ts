/**
 * Node — base class mirroring bpy.types.Node.
 *
 *   class MyNode(bpy.types.Node):
 *       bl_idname = 'MyCustomNode'
 *       bl_label  = 'My Node'
 *       def init(self, ctx):
 *           self.inputs.new('NodeSocketFloat', 'In')
 *           self.outputs.new('NodeSocketFloat', 'Out')
 *
 * Becomes:
 *
 *   class MyNode extends Node {
 *     static bl_idname = 'MyCustomNode';
 *     static bl_label  = 'My Node';
 *     static tree_types: NodeTreeKind[] = ['ShaderNodeTree'];
 *     init() {
 *       this.addInput(NodeSocketFloat, 'In');
 *       this.addOutput(NodeSocketFloat, 'Out');
 *     }
 *   }
 *   NodeRegistry.register(MyNode);
 */
import { nanoid } from 'nanoid';
import type { NodeTreeKind, NodeCtor, SocketCtor, Vec2, Vec3 } from './types';
import type { NodeTree } from './NodeTree';
import type { PropertyMap } from './Properties';
import { NodeSocket, type SocketInit } from './NodeSocket';
import type { NodeLink } from './NodeLink';

export interface NodeInitContext {
  tree: NodeTree;
}

export class Node {
  /** Override in subclasses. */
  static bl_idname: string = 'Node';
  static bl_label: string = 'Node';
  static bl_icon?: string;
  static bl_width_default: number = 140;
  static category: string = 'Misc';
  static tree_types: NodeTreeKind[] = [];
  /** Declarative property schema; auto-installed by the constructor. */
  static properties: PropertyMap = {};

  readonly id: string = nanoid(10);
  name = '';
  label = '';
  location: Vec2 = [0, 0];
  width = 140;
  height = 100;
  color: Vec3 = [0.2, 0.2, 0.2];
  use_custom_color = false;
  hide = false;
  mute = false;
  select = false;
  parent?: Node | undefined;

  inputs: NodeSocket[] = [];
  outputs: NodeSocket[] = [];
  /** Used during mute pass-through to route inputs → outputs. */
  internal_links: NodeLink[] = [];

  tree!: NodeTree;

  constructor() {
    // Install declarative properties as reactive instance fields. Blender RNA
    // properties call their `update` callback and tag the owning node tree for
    // re-evaluation when assigned; mirror that for direct TS assignments such
    // as `node.operation = 'MULTIPLY'`.
    const props = (this.constructor as typeof Node).properties;
    for (const [key, desc] of Object.entries(props)) {
      let value: unknown = structuredClone(desc.default);
      Object.defineProperty(this, key, {
        enumerable: true,
        configurable: true,
        get: () => value,
        set: (next: unknown) => {
          value = next;
          desc.update?.(this);
          if (this.tree) {
            this.tree.emit({ type: 'property_changed', node: this, key });
            this.tree.depsgraph.invalidate(this);
          }
        },
      });
    }
    this.width = (this.constructor as typeof Node).bl_width_default;
  }

  /** Override to add sockets. Default: no sockets. */
  init(_ctx: NodeInitContext): void {
    // override in subclasses
  }

  /** Optional lifecycle hooks (mirror Blender). */
  copy?(other: Node): void;
  free?(): void;
  update?(): void;
  insert_link?(link: NodeLink): boolean;

  /** Helper: add an input socket of class `SocketCls`. */
  protected addInput<S extends NodeSocket>(
    SocketCls: SocketCtor<S>,
    name: string,
    opts: Omit<SocketInit<unknown>, 'name'> = {},
  ): S {
    const sock = new SocketCls();
    sock.is_output = false;
    sock.node = this;
    sock.init({ name, ...opts } as SocketInit<unknown>);
    this.inputs.push(sock);
    return sock;
  }

  /** Helper: add an output socket of class `SocketCls`. */
  protected addOutput<S extends NodeSocket>(
    SocketCls: SocketCtor<S>,
    name: string,
    opts: Omit<SocketInit<unknown>, 'name'> = {},
  ): S {
    const sock = new SocketCls();
    sock.is_output = true;
    sock.node = this;
    sock.init({ name, ...opts } as SocketInit<unknown>);
    this.outputs.push(sock);
    return sock;
  }

  /**
   * Compute the muted pass-through routing (Blender's `internal_links`).
   *
   * When a node is muted, Blender routes each output to the first compatible
   * input by socket type, in declaration order, so the graph keeps flowing.
   * We mirror that: for each output socket, pick the first *unused* input
   * socket whose `kind` matches (or is numeric-coercible). Returns a map of
   * output.id -> input socket (or undefined when nothing routes).
   *
   * Consumed by every evaluator's mute handler, replacing the previous
   * ad-hoc "first geometry / first socket" heuristics.
   */
  computeInternalLinks(): Map<string, NodeSocket | undefined> {
    const numeric = new Set(['VALUE', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA']);
    const compatible = (a: NodeSocket, b: NodeSocket): boolean => {
      if (a.kind === b.kind) return true;
      return numeric.has(a.kind) && numeric.has(b.kind);
    };
    const out = new Map<string, NodeSocket | undefined>();
    const usedInputs = new Set<NodeSocket>();
    for (const o of this.outputs) {
      const pick =
        this.inputs.find((i) => !usedInputs.has(i) && i.kind === o.kind) ??
        this.inputs.find((i) => !usedInputs.has(i) && compatible(i, o));
      if (pick) usedInputs.add(pick);
      out.set(o.id, pick);
    }
    return out;
  }

  /** Find a socket by identifier (rename-safe). */
  findInput(identifier: string): NodeSocket | undefined {
    return this.inputs.find((s) => s.identifier === identifier);
  }
  findOutput(identifier: string): NodeSocket | undefined {
    return this.outputs.find((s) => s.identifier === identifier);
  }

  get bl_idname(): string {
    return (this.constructor as typeof Node).bl_idname;
  }
  get bl_label(): string {
    return (this.constructor as typeof Node).bl_label;
  }
}

/** Helper for registry typings. */
export type AnyNodeCtor = NodeCtor<Node>;
