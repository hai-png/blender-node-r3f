/**
 * NodeTreeInterface — group I/O definition (Blender 4.0+ API).
 * Mirrors bpy.types.NodeTreeInterface.
 */
import { nanoid } from 'nanoid';
import type { InOut } from './types';

export type InterfaceItemKind = 'SOCKET' | 'PANEL';

export interface NodeTreeInterfaceItem {
  readonly id: string;
  kind: InterfaceItemKind;
  name: string;
  description?: string;
  parent?: NodeTreeInterfacePanel | undefined;
}

export class NodeTreeInterfaceSocket implements NodeTreeInterfaceItem {
  readonly id: string = nanoid(10);
  kind: 'SOCKET' = 'SOCKET';
  /** Stable, rename-safe identifier. */
  identifier: string;
  in_out: InOut;
  socket_type: string;
  default_value: unknown;
  hide_value = false;
  parent?: NodeTreeInterfacePanel | undefined;

  constructor(
    public name: string,
    in_out: InOut,
    socket_type: string,
    public description = '',
    identifier?: string,
    default_value: unknown = undefined,
  ) {
    this.in_out = in_out;
    this.socket_type = socket_type;
    this.identifier = identifier ?? `${name}_${this.id}`;
    this.default_value = default_value;
  }
}

export class NodeTreeInterfacePanel implements NodeTreeInterfaceItem {
  readonly id: string = nanoid(10);
  kind: 'PANEL' = 'PANEL';
  default_closed = false;
  /** Child items (sockets or nested panels). */
  items: NodeTreeInterfaceItem[] = [];
  parent?: NodeTreeInterfacePanel | undefined;

  constructor(
    public name: string,
    default_closed = false,
    public description = '',
  ) {
    this.default_closed = default_closed;
  }
}

export class NodeTreeInterface {
  /** Flat list (Blender exposes items_tree as a flat ordered list). */
  items_tree: NodeTreeInterfaceItem[] = [];

  new_socket(opts: {
    name: string;
    description?: string;
    in_out: InOut;
    socket_type: string;
    parent?: NodeTreeInterfacePanel | undefined;
    default_value?: unknown;
    identifier?: string;
  }): NodeTreeInterfaceSocket {
    const sock = new NodeTreeInterfaceSocket(
      opts.name,
      opts.in_out,
      opts.socket_type,
      opts.description ?? '',
      opts.identifier,
      opts.default_value,
    );
    sock.parent = opts.parent;
    if (opts.parent) opts.parent.items.push(sock);
    this.items_tree.push(sock);
    return sock;
  }

  new_panel(
    name: string,
    default_closed = false,
    description = '',
    parent?: NodeTreeInterfacePanel | undefined,
    identifier?: string,
  ): NodeTreeInterfacePanel {
    const panel = new NodeTreeInterfacePanel(name, default_closed, description);
    if (identifier) (panel as unknown as { id: string }).id = identifier;
    panel.parent = parent;
    if (parent) parent.items.push(panel);
    this.items_tree.push(panel);
    return panel;
  }

  remove(item: NodeTreeInterfaceItem): void {
    const idx = this.items_tree.indexOf(item);
    if (idx >= 0) this.items_tree.splice(idx, 1);
    if (item.parent) {
      const c = item.parent.items.indexOf(item);
      if (c >= 0) item.parent.items.splice(c, 1);
    }
  }

  move(item: NodeTreeInterfaceItem, to: number): void {
    const idx = this.items_tree.indexOf(item);
    if (idx < 0) return;
    this.items_tree.splice(idx, 1);
    this.items_tree.splice(to, 0, item);
  }

  inputs(): NodeTreeInterfaceSocket[] {
    return this.items_tree.filter(
      (it): it is NodeTreeInterfaceSocket => it.kind === 'SOCKET' && (it as NodeTreeInterfaceSocket).in_out === 'INPUT',
    );
  }
  outputs(): NodeTreeInterfaceSocket[] {
    return this.items_tree.filter(
      (it): it is NodeTreeInterfaceSocket => it.kind === 'SOCKET' && (it as NodeTreeInterfaceSocket).in_out === 'OUTPUT',
    );
  }
}
