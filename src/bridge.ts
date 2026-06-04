/**
 * Sub-entry point: import { BlenderBridge, quickLoadBng } from 'blender-nodes-r3f/bridge';
 *
 * This entry exports the complete bridge pipeline: Python addon transpiler,
 * BNG runtime loader (with auto-bridging), and the end-to-end BlenderBridge.
 */

// Re-export bridge tools
export { transpilePythonAddon, transpileFullAddon } from './bridge/addon_transpiler';
export type { TranspiledNode, TranspiledAddon } from './bridge/addon_transpiler';

export { loadBngDocument, fetchBngDocument, exportBridgedAddonSource } from './bridge/runtime_loader';
export type { LoadBngOptions, LoadBngResult } from './bridge/runtime_loader';

export { BlenderBridge, quickLoadBng } from './bridge/blender_bridge';
export type { BridgeReport, PipelineResult } from './bridge/blender_bridge';

// Re-export existing bridge tools
export { importDocument } from './bridge/importer';
export { exportDocument } from './bridge/exporter';
export type { BngDocumentT, BngTreeT, BngNodeT, BngLinkT } from './bridge/schema';
