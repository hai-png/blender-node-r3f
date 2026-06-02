/**
 * blender-nodes-r3f — Blender-compatible node system for three.js / R3F.
 *
 * Public entry point. Side-effect free: calling `bootstrapBuiltins()` is
 * what populates the NodeRegistry. Consumers can choose to register only
 * the systems they need.
 */
export * from './core/types';
export * from './core/Properties';
export { Node } from './core/Node';
export { NodeSocket } from './core/NodeSocket';
export { NodeLink } from './core/NodeLink';
export { NodeTree } from './core/NodeTree';
export { NodeTreeInterface, NodeTreeInterfaceSocket, NodeTreeInterfacePanel } from './core/NodeTreeInterface';
export {
  ShaderNodeTree, GeometryNodeTree, CompositorNodeTree, TextureNodeTree,
  registerBuiltinTrees,
} from './core/trees';

export * from './sockets';
export { registerBuiltinSockets } from './sockets';

export * from './nodes/common';
export * from './nodes/shader';
export * from './nodes/geometry';
export * from './nodes/compositor';
export * from './nodes/texture';

export { Depsgraph, type SystemEvaluator, type EvaluationResult } from './eval/Depsgraph';
export { ShaderEvaluator, type MaterialDescriptor } from './eval/ShaderEvaluator';
// The TSL evaluator imports `three/webgpu`, which requires `self` (browser
// only). Import it from its sub-entry to keep Node/CLI consumers happy:
//   import { TSLShaderEvaluator } from 'blender-nodes-r3f/tsl';
export { GeometryEvaluator, type GeoNodeExecCtx } from './eval/GeometryEvaluator';
export {
  CompositorEvaluator,
  type CompositorEvaluatorOptions,
  type EvaluatedComposite,
  type CompositorPlan,
  type CompositorPlanStep,
} from './eval/CompositorEvaluator';
export { TextureEvaluator, bakeToDataTexture, type SampleFn } from './eval/TextureEvaluator';
export { cpuComposite } from './eval/compositor/CpuComposite';
export { flattenTree, flatTopoOrder } from './eval/flatten';

export { Geometry, MeshComponent, InstancesComponent, buildCube, buildUVSphere, buildIcosphere } from './eval/geometry/Geometry';

export { NodeRegistry, NodeCategory, NodeCategories, NodeItem } from './registry/NodeRegistry';

export { autoLayout, makeGroup, ungroup, History } from './ui/operators';
export { Inspector } from './ui/Inspector';
export { bpy, nodeitems_utils } from './bridge/bpy_shim';
export { importDocument } from './bridge/importer';
export { exportDocument } from './bridge/exporter';
export type { BngDocumentT, BngTreeT, BngNodeT, BngLinkT } from './bridge/schema';

import { registerBuiltinSockets } from './sockets';
import { registerBuiltinTrees } from './core/trees';
import { registerCommonNodes } from './nodes/common';
import { registerShaderNodes } from './nodes/shader';
import { registerGeometryNodes } from './nodes/geometry';
import { registerCompositorNodes } from './nodes/compositor';
import { registerTextureNodes } from './nodes/texture';
import { registerCommonExecutors } from './eval/CommonExecutors';
import { NodeTree as _NodeTree } from './core/NodeTree';
import { NodeRegistry as _NodeRegistry } from './registry/NodeRegistry';

// Re-export the registry-based dispatch helpers so consumers can register
// custom node executors without reaching into eval/ internals.
export { registerExecutor, getExecutor, dispatchNode } from './eval/NodeExecute';
export { registerCommonExecutors } from './eval/CommonExecutors';

/**
 * One-call bootstrap. Registers every built-in socket, tree, and node.
 * Call this once at app startup.
 */
let _bootstrapped = false;
export function bootstrapBuiltins(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;
  registerBuiltinSockets();
  registerBuiltinTrees();
  registerCommonNodes();
  registerShaderNodes();
  registerGeometryNodes();
  registerCompositorNodes();
  registerTextureNodes();
  // Wire registry-based executors for common nodes. Evaluators that opt into
  // dispatchNode() will use these instead of inlining instanceof chains.
  registerCommonExecutors();
  // Install the registry hook so NodeTree.addZone() can find zone classes
  // without core/ depending on the registry module.
  _NodeTree._registryLookup = (id: string) => {
    const c = _NodeRegistry.getNode(id);
    return c as unknown as (new () => import('./core/Node').Node) | undefined;
  };
}
