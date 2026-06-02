/**
 * Frame, Reroute, Note — pure layout nodes (no sockets that affect data flow,
 * with the exception of Reroute which is a 1:1 pass-through).
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { BoolProperty, FloatProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import { NodeSocketShader } from '../../sockets'; // generic placeholder; reroute uses NodeSocketVirtual semantics
import { NodeSocket } from '../../core/NodeSocket';
import { NodeRegistry } from '../../registry/NodeRegistry';

/** A virtual socket used by Reroute — accepts any kind. */
class NodeSocketVirtual extends NodeSocket {
  static override bl_idname = 'NodeSocketVirtual';
  static override bl_label = 'Any';
  override default_value: unknown = null;
  override coerceFrom(other: NodeSocket): unknown {
    return other.value;
  }
}
NodeRegistry.registerSocket(NodeSocketVirtual as unknown as Parameters<typeof NodeRegistry.registerSocket>[0]);

export class FrameNode extends Node {
  static override bl_idname = 'NodeFrame';
  static override bl_label = 'Frame';
  static override category = 'Layout';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override bl_width_default = 200;
  static override properties = {
    text: StringProperty({ default: '', name: 'Text' }),
    shrink: BoolProperty({ default: true, name: 'Shrink' }),
    label_size: FloatProperty({ default: 20, name: 'Label Size' }),
  };
  override init(_ctx: NodeInitContext): void {
    // Frames have no sockets.
  }
}

export class RerouteNode extends Node {
  static override bl_idname = 'NodeReroute';
  static override bl_label = 'Reroute';
  static override category = 'Layout';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override bl_width_default = 16;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVirtual as unknown as typeof NodeSocketShader, 'Input');
    this.addOutput(NodeSocketVirtual as unknown as typeof NodeSocketShader, 'Output');
  }
}

let _registered = false;
export function registerLayoutNodes(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.register(FrameNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
  NodeRegistry.register(RerouteNode as unknown as Parameters<typeof NodeRegistry.register>[0]);
}
