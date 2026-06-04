/**
 * Layer 3 — Complete Bridge Pipeline
 *
 * End-to-end: .blend → BNG JSON → NodeTree → Evaluator → Three.js Scene
 *
 * Usage:
 *   import { BlenderBridge } from 'blender-nodes-r3f/bridge';
 *   const bridge = new BlenderBridge();
 *   const result = bridge.loadBlendExport(bngJson);
 *   const { trees } = result;
 */

import { Node } from '../core/Node';
import { NodeTree } from '../core/NodeTree';
import { NodeRegistry } from '../registry/NodeRegistry';
import { registerExecutor } from '../eval/NodeExecute';
import { GeometryEvaluator } from '../eval/GeometryEvaluator';
import { ShaderEvaluator } from '../eval/ShaderEvaluator';
import { CompositorEvaluator } from '../eval/CompositorEvaluator';
import { TextureEvaluator } from '../eval/TextureEvaluator';
import type { SystemEvaluator } from '../eval/Depsgraph';
import type { SceneIntegration } from '../integration/SceneIntegration';
import { loadBngDocument, exportBridgedAddonSource } from './runtime_loader';
import { transpileFullAddon } from './addon_transpiler';
import type { TranspiledAddon } from './addon_transpiler';
import type { BngDocumentT } from './schema';

export interface BridgeReport {
  treeCount: number;
  bridgedCount: number;
  bridgedIds: string[];
  warnings: string[];
  addonTranspiled: boolean;
  addonNodes: string[];
  addonTsSource: string | null;
}

export interface PipelineResult {
  trees: NodeTree[];
  evaluators: Map<string, SystemEvaluator>;
  report: BridgeReport;
}

function evaluatorForTree(tree: NodeTree): SystemEvaluator {
  const kind = (tree.constructor as unknown as { bl_idname: string }).bl_idname;
  switch (kind) {
    case 'ShaderNodeTree':     return new ShaderEvaluator();
    case 'GeometryNodeTree':   return new GeometryEvaluator();
    case 'CompositorNodeTree': return new CompositorEvaluator();
    case 'TextureNodeTree':    return new TextureEvaluator();
    default:                   return new ShaderEvaluator();
  }
}

export class BlenderBridge {
  private _addonSource: string | null = null;
  private _transpiledAddon: TranspiledAddon | null = null;
  private _lastResult: PipelineResult | null = null;

  get lastResult(): PipelineResult | null { return this._lastResult; }

  withAddon(pythonAddonSource: string): this {
    this._addonSource = pythonAddonSource;
    return this;
  }

  loadBlendExport(bngJson: string | BngDocumentT): PipelineResult {
    const json = typeof bngJson === 'string' ? JSON.parse(bngJson) : bngJson;

    // Step 1: Transpile Python addon if provided
    let addonTranspiled = false;
    let addonNodes: string[] = [];
    let addonTsSource: string | null = null;

    if (this._addonSource) {
      try {
        this._transpiledAddon = transpileFullAddon(this._addonSource);
        addonTranspiled = true;
        addonNodes = this._transpiledAddon.nodes.map((n) => n.bl_idname);
        addonTsSource = this._transpiledAddon.fullSource;

        for (const node of this._transpiledAddon.nodes) {
          if (NodeRegistry.getNode(node.bl_idname)) continue;
          try {
            this._registerTranspiledNode(node);
          } catch {
            addonNodes = addonNodes.filter((id) => id !== node.bl_idname);
          }
        }
      } catch (err) {
        console.warn('Addon transpilation failed:', err);
      }
    }

    // Step 2: Load BNG JSON
    const loadResult = loadBngDocument(json, {
      autoRegisterUnknown: true,
      generateExecutors: true,
    });

    // Step 3: Wire evaluators
    const evaluators = new Map<string, SystemEvaluator>();
    for (const tree of loadResult.trees) {
      const ev = evaluatorForTree(tree);
      tree.depsgraph.setEvaluator(ev);
      evaluators.set(tree.id, ev);
    }

    const report: BridgeReport = {
      treeCount: loadResult.trees.length,
      bridgedCount: loadResult.bridgedNodeIds.length,
      bridgedIds: loadResult.bridgedNodeIds,
      warnings: loadResult.warnings,
      addonTranspiled,
      addonNodes,
      addonTsSource,
    };

    this._lastResult = { trees: loadResult.trees, evaluators, report };
    return this._lastResult;
  }

  async loadFromUrl(bngJsonUrl: string, addonUrl?: string): Promise<PipelineResult> {
    if (addonUrl) {
      const resp = await fetch(addonUrl);
      this.withAddon(await resp.text());
    }
    const resp = await fetch(bngJsonUrl);
    return this.loadBlendExport(await resp.json());
  }

  connectToScene(tree: NodeTree, scene: SceneIntegration): void {
    scene.setTree(tree);
    tree.depsgraph.invalidateAll();
  }

  exportBridgedAddonTs(): string {
    if (!this._lastResult) return '';
    return exportBridgedAddonSource({
      trees: this._lastResult.trees,
      bridgedNodeIds: this._lastResult.report.bridgedIds,
      warnings: [],
    });
  }

  get transpiledAddonTs(): string | null {
    return this._transpiledAddon?.fullSource ?? null;
  }

  /* ── Private ──────────────────────────────────────────────────── */

  private _registerTranspiledNode(
    node: { bl_idname: string; bl_label: string; category: string; treeTypes: string[] },
  ): void {
    // Create a minimal dynamic Node class from transpiled metadata.
    // We only set the static side — bl_idname/bl_label are accessors on Node
    // that read from the static side, so we define them as static properties.
    const DynamicNodeClass = class extends Node {
      static override bl_idname = node.bl_idname;
      static override bl_label = node.bl_label;
      static override category = node.category;
      static override tree_types = node.treeTypes as ['GeometryNodeTree'];
      static override properties = {} as import('../core/Properties').PropertyMap;

      override init(): void {
        // Sockets wired by the BNG importer from JSON definitions
      }
    };

    NodeRegistry.register(
      DynamicNodeClass as unknown as Parameters<typeof NodeRegistry.register>[0],
    );

    // Pass-through executor
    registerExecutor(node.bl_idname, (
      n: Node, cache: Map<string, unknown>,
    ) => {
      for (const output of n.outputs) {
        const matchingInput = n.inputs.find(
          (inp) => inp.kind === output.kind && inp.is_linked,
        );
        if (matchingInput) {
          const linkedVal = matchingInput.is_linked
            ? (() => {
                for (const lk of matchingInput.links) {
                  if (!lk.is_muted && !lk.escapes_zone) {
                    const v = cache.get(lk.from_socket.id);
                    if (v !== undefined) return v;
                  }
                }
                return matchingInput.default_value;
              })()
            : matchingInput.default_value;
          cache.set(output.id, linkedVal);
        } else {
          cache.set(output.id, output.default_value);
        }
      }
    });
  }
}

/** One-liner: fetch BNG JSON + wire evaluators. */
export async function quickLoadBng(url: string): Promise<NodeTree[]> {
  const bridge = new BlenderBridge();
  const resp = await fetch(url);
  return bridge.loadBlendExport(await resp.json()).trees;
}
