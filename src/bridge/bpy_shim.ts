/**
 * bpy_shim — a near-mechanical translation target for ported Blender Python
 * addons. Provides the same identifier surface (`bpy.types.Node`,
 * `bpy.props.FloatProperty`, `bpy.utils.register_class`, `nodeitems_utils`,
 * …) so a Python addon's class definitions translate to TS classes with
 * minimal structural change.
 *
 * Example Python:
 *   class MyNode(bpy.types.Node):
 *       bl_idname = 'MyCustomNode'
 *       my_float: bpy.props.FloatProperty(default=1.0)
 *       def init(self, ctx):
 *           self.inputs.new('NodeSocketFloat', 'In')
 *
 * Translated TS:
 *   class MyNode extends bpy.types.Node {
 *     static bl_idname = 'MyCustomNode';
 *     static tree_types = ['ShaderNodeTree'] as const;
 *     static properties = { my_float: bpy.props.FloatProperty({ default: 1.0 }) };
 *     init() { this.inputs_new('NodeSocketFloat', 'In'); }
 *   }
 *   bpy.utils.register_class(MyNode);
 */
import { Node } from '../core/Node';
import { NodeSocket } from '../core/NodeSocket';
import { NodeTree } from '../core/NodeTree';
import { NodeTreeInterface } from '../core/NodeTreeInterface';
import {
  FloatProperty, IntProperty, BoolProperty, StringProperty,
  EnumProperty, FloatVectorProperty, ColorProperty, PointerProperty,
} from '../core/Properties';
import { NodeRegistry, NodeCategory, NodeCategories, NodeItem } from '../registry/NodeRegistry';
import * as Sockets from '../sockets';

/**
 * Mixin: gives a Node subclass a Python-flavoured `inputs_new(type, name)` /
 * `outputs_new(type, name)` API, mirroring `self.inputs.new(...)`.
 *
 * Why methods rather than ports of `inputs` as a Collection? Because
 * Collection.new() in Python returns a freshly-constructed socket; we
 * already expose the underlying `addInput/addOutput` helpers. The shim
 * just exposes them under the Pythonic name.
 */
function attachPyHelpers(NodeCtor: typeof Node): void {
  const proto = NodeCtor.prototype as unknown as {
    inputs_new(type: string, name: string, opts?: Record<string, unknown>): NodeSocket;
    outputs_new(type: string, name: string, opts?: Record<string, unknown>): NodeSocket;
  };
  if ((proto as { inputs_new?: unknown }).inputs_new) return;
  proto.inputs_new = function (this: Node, type: string, name: string, opts: Record<string, unknown> = {}): NodeSocket {
    const SockCls = NodeRegistry.getSocket(type);
    if (!SockCls) throw new Error(`Unknown socket type "${type}" in inputs_new()`);
    const sock = new SockCls();
    sock.is_output = false;
    sock.node = this;
    sock.init({ name, ...opts });
    this.inputs.push(sock);
    return sock;
  };
  proto.outputs_new = function (this: Node, type: string, name: string, opts: Record<string, unknown> = {}): NodeSocket {
    const SockCls = NodeRegistry.getSocket(type);
    if (!SockCls) throw new Error(`Unknown socket type "${type}" in outputs_new()`);
    const sock = new SockCls();
    sock.is_output = true;
    sock.node = this;
    sock.init({ name, ...opts });
    this.outputs.push(sock);
    return sock;
  };
}
attachPyHelpers(Node);

export const bpy = {
  types: {
    Node,
    NodeSocket,
    NodeTree,
    NodeTreeInterface,
    /** Spread of all built-in sockets so ported code can say bpy.types.NodeSocketFloat */
    ...Sockets,
  },
  props: {
    FloatProperty,
    IntProperty,
    BoolProperty,
    StringProperty,
    EnumProperty,
    FloatVectorProperty,
    ColorProperty,
    PointerProperty,
  },
  utils: {
    register_class(cls: unknown): void {
      // Detect category by inheritance.
      if ((cls as typeof Node).prototype instanceof Node) {
        NodeRegistry.register(cls as Parameters<typeof NodeRegistry.register>[0]);
      } else if ((cls as typeof NodeSocket).prototype instanceof NodeSocket) {
        NodeRegistry.registerSocket(cls as Parameters<typeof NodeRegistry.registerSocket>[0]);
      } else if ((cls as typeof NodeTree).prototype instanceof NodeTree) {
        NodeRegistry.registerTree(cls as Parameters<typeof NodeRegistry.registerTree>[0]);
      } else {
        console.warn('register_class: unknown class kind', cls);
      }
    },
    unregister_class(cls: unknown): void {
      const id = (cls as { bl_idname?: string }).bl_idname;
      if (id) NodeRegistry.unregister(id);
    },
  },
};

export const nodeitems_utils = {
  NodeCategory,
  NodeItem,
  register_node_categories(packId: string, cats: NodeCategory[]): void {
    NodeCategories.register(packId, cats);
  },
  unregister_node_categories(packId: string): void {
    NodeCategories.unregister(packId);
  },
};
