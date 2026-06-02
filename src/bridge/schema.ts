/**
 * BNG (Blender Node Graph) JSON schema, v1.
 * Used by:
 *   - blender_exporter.py (writes from a .blend)
 *   - importer.ts        (reads into NodeTree)
 *   - exporter.ts        (round-trips a runtime NodeTree back to JSON)
 */
import { z } from 'zod';

export const BngSocketDef = z.object({
  identifier: z.string(),
  name: z.string(),
  socket_type: z.string(),
  default_value: z.unknown().optional(),
  hide_value: z.boolean().optional(),
});

export const BngInterfaceItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('socket'),
    in_out: z.enum(['INPUT', 'OUTPUT']),
    socket_type: z.string(),
    name: z.string(),
    identifier: z.string(),
    description: z.string().optional(),
    default_value: z.unknown().optional(),
    parent: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('panel'),
    name: z.string(),
    identifier: z.string(),
    description: z.string().optional(),
    default_closed: z.boolean().optional(),
    parent: z.string().nullable().optional(),
  }),
]);

export const BngNode = z.object({
  id: z.string(),
  bl_idname: z.string(),
  name: z.string(),
  label: z.string().optional(),
  location: z.tuple([z.number(), z.number()]),
  width: z.number().optional(),
  mute: z.boolean().optional(),
  hide: z.boolean().optional(),
  properties: z.record(z.unknown()).optional(),
  inputs: z.array(BngSocketDef).optional(),
  outputs: z.array(BngSocketDef).optional(),
  /** For Group nodes: id of the referenced child tree. */
  node_tree: z.string().nullable().optional(),
});

export const BngLink = z.object({
  from_node: z.string(),
  from_socket: z.string(),     // identifier (rename-safe)
  to_node: z.string(),
  to_socket: z.string(),
  is_muted: z.boolean().optional(),
});

export const BngTree = z.object({
  id: z.string(),
  bl_idname: z.enum(['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree']),
  name: z.string(),
  interface: z.object({ items: z.array(BngInterfaceItem) }),
  nodes: z.array(BngNode),
  links: z.array(BngLink),
});

export const BngDocument = z.object({
  schema: z.literal('BNG/1'),
  blender_version: z.string().optional(),
  trees: z.array(BngTree),
});

export type BngDocumentT = z.infer<typeof BngDocument>;
export type BngTreeT = z.infer<typeof BngTree>;
export type BngNodeT = z.infer<typeof BngNode>;
export type BngLinkT = z.infer<typeof BngLink>;
