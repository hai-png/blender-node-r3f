/**
 * The four built-in NodeTree subclasses, mirroring Blender's:
 *   ShaderNodeTree, GeometryNodeTree, CompositorNodeTree, TextureNodeTree.
 */
import { NodeTree } from './NodeTree';
import { NodeRegistry } from '../registry/NodeRegistry';

export class ShaderNodeTree extends NodeTree {
  static override bl_idname = 'ShaderNodeTree' as const;
  static override bl_label = 'Shader Editor';
}
export class GeometryNodeTree extends NodeTree {
  static override bl_idname = 'GeometryNodeTree' as const;
  static override bl_label = 'Geometry Nodes';
}
export class CompositorNodeTree extends NodeTree {
  static override bl_idname = 'CompositorNodeTree' as const;
  static override bl_label = 'Compositor';
}
export class TextureNodeTree extends NodeTree {
  static override bl_idname = 'TextureNodeTree' as const;
  static override bl_label = 'Texture Editor';
}

let _registered = false;
export function registerBuiltinTrees(): void {
  if (_registered) return;
  _registered = true;
  NodeRegistry.registerTree(ShaderNodeTree as unknown as Parameters<typeof NodeRegistry.registerTree>[0]);
  NodeRegistry.registerTree(GeometryNodeTree as unknown as Parameters<typeof NodeRegistry.registerTree>[0]);
  NodeRegistry.registerTree(CompositorNodeTree as unknown as Parameters<typeof NodeRegistry.registerTree>[0]);
  NodeRegistry.registerTree(TextureNodeTree as unknown as Parameters<typeof NodeRegistry.registerTree>[0]);
}
