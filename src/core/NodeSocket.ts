/**
 * NodeSocket — base class mirroring bpy.types.NodeSocket.
 *
 * Subclasses live in `src/sockets/` and register themselves through
 * the NodeRegistry under their `bl_idname`.
 */
import { nanoid } from 'nanoid';
import type { DisplayShape, RGBA, SocketKind } from './types';
import type { Node } from './Node';
import type { NodeLink } from './NodeLink';

export interface SocketInit<T = unknown> {
  name: string;
  identifier?: string;
  description?: string;
  default_value?: T;
  hide_value?: boolean;
  hide?: boolean;
  enabled?: boolean;
  link_limit?: number;
  display_shape?: DisplayShape;
  is_multi_input?: boolean;
}

export class NodeSocket<T = unknown> {
  /** Override in subclasses. */
  static bl_idname: string = 'NodeSocket';
  static bl_label: string = 'Socket';
  static kind: SocketKind = 'CUSTOM';
  static color: RGBA = [0.5, 0.5, 0.5, 1];

  /** Stable per-tree id. */
  readonly id: string = nanoid(10);
  /** Stable across renames (Blender uses this for link migration). */
  identifier!: string;
  name!: string;
  description = '';
  is_output = false;
  is_multi_input = false;
  hide = false;
  hide_value = false;
  enabled = true;
  /** 0 = unlimited (multi-input). */
  link_limit = 1;
  display_shape: DisplayShape = 'CIRCLE';
  default_value!: T;
  /** Last evaluated value (Blender's socket inspection). */
  value?: T;

  /** Back-references — populated by NodeTree.addNode / addLink. */
  node!: Node;
  links: NodeLink[] = [];

  init(opts: SocketInit<T>): void {
    this.name = opts.name;
    this.identifier = opts.identifier ?? opts.name;
    this.description = opts.description ?? '';
    if (opts.default_value !== undefined) this.default_value = opts.default_value;
    if (opts.hide !== undefined) this.hide = opts.hide;
    if (opts.hide_value !== undefined) this.hide_value = opts.hide_value;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.link_limit !== undefined) this.link_limit = opts.link_limit;
    if (opts.display_shape !== undefined) this.display_shape = opts.display_shape;
    if (opts.is_multi_input !== undefined) {
      this.is_multi_input = opts.is_multi_input;
      if (opts.is_multi_input && opts.link_limit === undefined) this.link_limit = 0;
    }
  }

  get is_linked(): boolean {
    return this.links.length > 0;
  }

  /**
   * Coerce a value coming from another socket type into this socket's type.
   * Subclasses implement type coercion (e.g. float→vec3 = vec3(f,f,f)).
   * Default: pass-through.
   */
  coerceFrom(other: NodeSocket): T {
    return other.value as T;
  }

  /**
   * Returns the effective value: either the linked source's coerced value
   * (resolved by the evaluator before calling this) or `default_value`.
   */
  resolve(): T {
    if (this.is_linked && this.value !== undefined) return this.value;
    return this.default_value;
  }

  /** Subclass identity helpers. */
  get bl_idname(): string {
    return (this.constructor as typeof NodeSocket).bl_idname;
  }
  get kind(): SocketKind {
    return (this.constructor as typeof NodeSocket).kind;
  }
  get color(): RGBA {
    return (this.constructor as typeof NodeSocket).color;
  }
}
