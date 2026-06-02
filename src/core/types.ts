/**
 * Cross-cutting type definitions that mirror Blender's enums.
 * See: docs/RESEARCH.md §2 and ARCHITECTURE.md §1.
 */

/** Blender NodeSocket.type enum. */
export type SocketKind =
  | 'VALUE'        // float
  | 'INT'
  | 'BOOLEAN'
  | 'VECTOR'
  | 'ROTATION'
  | 'MATRIX'
  | 'STRING'
  | 'RGBA'
  | 'SHADER'
  | 'GEOMETRY'
  | 'OBJECT'
  | 'COLLECTION'
  | 'MATERIAL'
  | 'IMAGE'
  | 'TEXTURE'
  | 'MENU'
  | 'CUSTOM';

export type InOut = 'INPUT' | 'OUTPUT';

export type NodeTreeKind =
  | 'ShaderNodeTree'
  | 'GeometryNodeTree'
  | 'CompositorNodeTree'
  | 'TextureNodeTree';

/** Blender NodeSocket.display_shape enum. */
export type DisplayShape =
  | 'CIRCLE'
  | 'SQUARE'
  | 'DIAMOND'
  | 'CIRCLE_DOT'
  | 'SQUARE_DOT'
  | 'DIAMOND_DOT';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type RGBA = [number, number, number, number];

/** Attribute domain — Geometry Nodes only. */
export type AttributeDomain =
  | 'POINT'
  | 'EDGE'
  | 'FACE'
  | 'CORNER'
  | 'CURVE'
  | 'INSTANCE'
  | 'LAYER';

/** Convenience constructors. */
export type NodeCtor<N> = { new (): N } & {
  bl_idname: string;
  bl_label: string;
  category?: string;
  tree_types: NodeTreeKind[];
};

export type SocketCtor<S> = { new (): S } & {
  bl_idname: string;
  bl_label: string;
  kind: SocketKind;
  color: RGBA;
};
