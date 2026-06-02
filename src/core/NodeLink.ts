import { nanoid } from 'nanoid';
import type { Node } from './Node';
import type { NodeSocket } from './NodeSocket';

export class NodeLink {
  readonly id: string = nanoid(10);
  is_muted = false;
  multi_input_sort_id = 0;
  /**
   * Set to true by NodeTree.addLink when the link violates the zone-escape
   * rule (M4): the source is inside a zone but the destination is outside,
   * and the source isn't the zone's Output node. The evaluator skips such
   * links; the UI can render them red.
   */
  escapes_zone = false;

  constructor(
    public from_node: Node,
    public from_socket: NodeSocket,
    public to_node: Node,
    public to_socket: NodeSocket,
  ) {}

  /**
   * A link is valid if the destination socket's poll permits the source kind.
   * The default rule mirrors Blender's behaviour for built-in types:
   *  - same `kind` is always allowed
   *  - SHADER and GEOMETRY only accept their own kind
   *  - numeric kinds (VALUE/INT/BOOLEAN/VECTOR/RGBA) auto-coerce between
   *    one another
   */
  get is_valid(): boolean {
    const a = this.from_socket.kind;
    const b = this.to_socket.kind;
    if (a === b) return true;
    // Reroute / Virtual sockets (CUSTOM, bl_idname NodeSocketVirtual) are
    // type-agnostic: they relay whatever flows through them, so any link to
    // or from one is valid (Blender behaves the same for reroutes).
    if (a === 'CUSTOM' || b === 'CUSTOM') return true;
    if (a === 'SHADER' || b === 'SHADER') return false;
    if (a === 'GEOMETRY' || b === 'GEOMETRY') return false;
    const numeric = new Set(['VALUE', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA']);
    return numeric.has(a) && numeric.has(b);
  }
}
