/**
 * Layer 2 — BNG Runtime Loader
 *
 * Imports a BNG JSON document and produces fully evaluable NodeTrees.
 * For nodes NOT in the built-in registry (custom addon nodes), it
 * auto-generates a "BridgedNode" subclass with correct sockets, properties,
 * and a pass-through executor — no manual shim needed.
 *
 * Usage:
 *   import { loadBngDocument } from 'blender-nodes-r3f/bridge';
 *   const trees = loadBngDocument(bngJson);
 *   const tree = trees[0]!;
 *   tree.depsgraph.setEvaluator(new GeometryEvaluator());
 *   const result = tree.depsgraph.evaluate(); // runs!
 */

import { Node } from '../core/Node';
import { NodeSocket } from '../core/NodeSocket';
import { NodeTree } from '../core/NodeTree';
import { NodeRegistry } from '../registry/NodeRegistry';
import { importDocument as importDocumentRaw } from './importer';
import { registerExecutor } from '../eval/NodeExecute';
import { BngDocument } from './schema';
import type { GeoNodeExecCtx } from '../eval/GeometryEvaluator';
import { constField, isField, liftToField, mapField, zipField } from '../eval/geometry/Field';
import type { Field } from '../eval/geometry/Field';
import type { BngDocumentT, BngTreeT, BngNodeT } from './schema';
import type { NodeTreeKind } from '../core/types';
import type { ValueCache, ExecCtx } from '../eval/NodeExecute';

/* ── Dynamic Node Factory ──────────────────────────────────────────── */

/**
 * Creates a dynamic Node subclass on-the-fly for unknown bl_idnames.
 * The generated class has:
 *   - Correct static fields (bl_idname, bl_label, tree_types)
 *   - Dynamic properties from BNG properties record
 *   - Dynamic sockets from BNG socket definitions
 *   - A pass-through executor that propagates defaults → outputs
 */
function createBridgedNodeClass(
  def: BngNodeT,
  allTrees: readonly BngTreeT[],
): typeof Node {
  const bl_idname = def.bl_idname;
  const bl_label = def.label || def.name || def.bl_idname;

  // Determine tree type
  let treeTypes: NodeTreeKind[] = ['GeometryNodeTree'];
  const parentTree = allTrees.find((t) =>
    t.nodes.some((n) => n.bl_idname === bl_idname),
  );
  if (parentTree) {
    treeTypes = [parentTree.bl_idname];
  }

  // Build properties descriptor (typed union so TS is happy)
  const propDesc: Record<string, { kind: string; default: unknown; size?: 2|3|4; min?: number; max?: number; items?: readonly unknown[] }> = {};
  if (def.properties) {
    for (const [key, val] of Object.entries(def.properties)) {
      if (typeof val === 'number') {
        propDesc[key] = { kind: 'FLOAT', default: val };
      } else if (typeof val === 'boolean') {
        propDesc[key] = { kind: 'BOOL', default: val };
      } else if (typeof val === 'string') {
        propDesc[key] = { kind: 'STRING', default: val };
      } else if (Array.isArray(val) && val.length >= 4) {
        propDesc[key] = { kind: 'COLOR', default: val.slice(0, 4) };
      } else if (Array.isArray(val) && val.length >= 2) {
        propDesc[key] = { kind: 'VECTOR', size: Math.min(val.length, 4) as 2|3|4, default: val.slice() };
      } else {
        propDesc[key] = { kind: 'STRING', default: String(val) };
      }
    }
  }

  // Build socket declarations (for init())
  const inputDefs = (def.inputs ?? []).map((s) => ({
    name: s.name,
    socketType: s.socket_type,
    default_value: s.default_value,
  }));
  const outputDefs = (def.outputs ?? []).map((s) => ({
    name: s.name,
    socketType: s.socket_type,
    default_value: s.default_value,
  }));

  // Socket type → TS class mapping
  const sockMap: Record<string, string> = {
    NodeSocketFloat: 'NodeSocketFloat', NodeSocketFloatFactor: 'NodeSocketFloatFactor',
    NodeSocketFloatAngle: 'NodeSocketFloatAngle', NodeSocketInt: 'NodeSocketInt',
    NodeSocketBool: 'NodeSocketBool', NodeSocketVector: 'NodeSocketVector',
    NodeSocketVectorXYZ: 'NodeSocketVectorXYZ', NodeSocketColor: 'NodeSocketColor',
    NodeSocketString: 'NodeSocketString', NodeSocketShader: 'NodeSocketShader',
    NodeSocketGeometry: 'NodeSocketGeometry', NodeSocketObject: 'NodeSocketObject',
    NodeSocketCollection: 'NodeSocketCollection', NodeSocketMaterial: 'NodeSocketMaterial',
    NodeSocketImage: 'NodeSocketImage', NodeSocketTexture: 'NodeSocketTexture',
    NodeSocketMenu: 'NodeSocketMenu', NodeSocketRotation: 'NodeSocketRotation',
    NodeSocketMatrix: 'NodeSocketMatrix',
  };

  // Create the class dynamically
  const BridgedNode = class extends Node {
    static override bl_idname = bl_idname;
    static override bl_label = bl_label;
    static override category = 'Bridge Import';
    static override tree_types = treeTypes;
    static override properties = propDesc as unknown as import('../core/Properties').PropertyMap;

    override init(): void {
      // Dynamically resolve socket classes from registry
      for (const sockDef of inputDefs) {
        const SockCls = NodeRegistry.getSocket(sockDef.socketType);
        const instance = SockCls
          ? new SockCls()
          : (() => {
              const s = new NodeSocket();
              s.init({ name: sockDef.name });
              return s;
            })();
        if (SockCls) {
          instance.is_output = false;
          instance.node = this as unknown as Node;
          instance.init({ name: sockDef.name });
          (this as unknown as Node).inputs.push(instance);
        } else {
          // Fallback: generic socket
          const s = new NodeSocket();
          s.is_output = false;
          (s as unknown as { node: Node }).node = this as unknown as Node;
          s.init({ name: sockDef.name });
          (this as unknown as Node).inputs.push(s);
        }
      }
      for (const sockDef of outputDefs) {
        const SockCls = NodeRegistry.getSocket(sockDef.socketType);
        if (SockCls) {
          const instance = new SockCls();
          instance.is_output = true;
          (instance as unknown as { node: Node }).node = this as unknown as Node;
          instance.init({ name: sockDef.name });
          (this as unknown as Node).outputs.push(instance);
        } else {
          const s = new NodeSocket();
          s.is_output = true;
          (s as unknown as { node: Node }).node = this as unknown as Node;
          s.init({ name: sockDef.name });
          (this as unknown as Node).outputs.push(s);
        }
      }
    }

    /** Auto-generated pass-through executor. */
    executeGeo(ctx: GeoNodeExecCtx): void {
      // Pass-through: for each output, try to forward a matching input,
      // otherwise use the default value.
      for (const output of (this as unknown as Node).outputs) {
        const matchingInput = (this as unknown as Node).inputs.find(
          (inp) => inp.kind === output.kind && inp.is_linked,
        );
        if (matchingInput) {
          const val = ctx.inputValue(matchingInput.name);
          if (val !== undefined) {
            ctx.setOutputValue(output.name, val);
            continue;
          }
        }
        ctx.setOutputValue(output.name, output.default_value);
      }
    }
  };

  // Install the class name for debugging
  Object.defineProperty(BridgedNode, 'name', { value: `Bridged_${bl_idname}` });

  return BridgedNode as unknown as typeof Node;
}

/* ── BNG Document Loader ────────────────────────────────────────────── */

export interface LoadBngOptions {
  /** When true, nodes not in the built-in registry are auto-registered. */
  autoRegisterUnknown?: boolean;
  /** Whether to auto-generate pass-through executors. */
  generateExecutors?: boolean;
}

export interface LoadBngResult {
  trees: NodeTree[];
  /** Nodes that were auto-registered (unknown in built-in registry). */
  bridgedNodeIds: string[];
  /** Warnings for nodes that couldn't be bridged. */
  warnings: string[];
}

/**
 * Load a BNG JSON document into evaluable NodeTrees.
 *
 * For any node whose bl_idname is NOT in the built-in NodeRegistry,
 * a dynamic "BridgedNode" subclass is created with correct sockets and
 * properties, auto-registered, and given a pass-through executor.
 *
 * This means you can export ANY .blend node tree via blender_exporter.py
 * and load it directly without writing a single line of TypeScript.
 */
export function loadBngDocument(
  json: unknown,
  opts: LoadBngOptions = {},
): LoadBngResult {
  const { autoRegisterUnknown = true, generateExecutors = true } = opts;
  const warnings: string[] = [];
  const bridgedNodeIds: string[] = [];

  // Parse + validate
  const doc = BngDocument.parse(json) as BngDocumentT;

  // Collect all unknown node types
  if (autoRegisterUnknown) {
    const knownIds = new Set<string>();
    for (const cls of NodeRegistry.listAllNodes()) {
      knownIds.add(cls.bl_idname);
    }

    const unknownIds = new Set<string>();
    for (const t of doc.trees) {
      for (const n of t.nodes) {
        if (!knownIds.has(n.bl_idname) && !unknownIds.has(n.bl_idname)) {
          unknownIds.add(n.bl_idname);
        }
      }
    }

    // Create and register BridgedNode classes for each unknown id
    for (const id of unknownIds) {
      const defs = doc.trees.flatMap((t) =>
        t.nodes.filter((n) => n.bl_idname === id),
      );
      if (defs.length === 0) continue;

      const def = defs[0]!;
      try {
        const BridgedClass = createBridgedNodeClass(def, doc.trees);
        NodeRegistry.register(
          BridgedClass as unknown as Parameters<typeof NodeRegistry.register>[0],
        );
        bridgedNodeIds.push(id);

        // Register a pass-through executor
        if (generateExecutors) {
          registerBridgedExecutor(id);
        }
      } catch (err) {
        warnings.push(`Failed to bridge node "${id}": ${(err as Error).message}`);
      }
    }
  }

  // Now import normally — all node types are registered
  const trees = importDocumentRaw(json);

  return { trees, bridgedNodeIds, warnings };
}

/* ── Bridged Executor Generator ────────────────────────────────────── */

function registerBridgedExecutor(bl_idname: string): void {
  registerExecutor(bl_idname, (node: Node, cache: ValueCache, ctx: ExecCtx) => {
    // Pass-through: propagate input values to matching outputs
    const nodeAny = node as unknown as {
      inputs: NodeSocket[];
      outputs: NodeSocket[];
      executeGeo?: (geoctx: GeoNodeExecCtx) => void;
      executeShader?: (cache: ValueCache, ctx: ExecCtx) => void;
    };

    // If the bridged node has custom execute methods, try them
    const customGeo = (node as unknown as { executeGeo?: (geoctx: GeoNodeExecCtx) => void }).executeGeo;
    if (typeof customGeo === 'function') {
      const geoCtx: GeoNodeExecCtx = {
        node,
        inputField: (name: string) => {
          const sock = node.inputs.find((s) => s.name === name || s.identifier === name);
          if (!sock) return constField(0, 'FLOAT');
          const v = ctx.socketValue(sock, cache);
          return isField(v) ? (v as Field) : liftToField(v ?? sock.default_value, 'FLOAT');
        },
        inputValue: (name: string) => {
          const sock = node.inputs.find((s) => s.name === name || s.identifier === name);
          return sock ? ctx.socketValue(sock, cache) : undefined;
        },
        setOutputField: (name: string, field: Field) => {
          const sock = node.outputs.find((s) => s.name === name || s.identifier === name);
          if (sock) cache.set(sock.id, field);
        },
        setOutputValue: (name: string, value: unknown) => {
          const sock = node.outputs.find((s) => s.name === name || s.identifier === name);
          if (sock) cache.set(sock.id, value);
        },
        constField,
        mapField,
        zipField,
      };
      customGeo(geoCtx);
      return;
    }

    // Default pass-through: match inputs to outputs by kind
    const consumedInputs = new Set<NodeSocket>();
    for (const output of node.outputs) {
      // Find first unused compatible input
      const compatibleInput = node.inputs.find(
        (inp) => !consumedInputs.has(inp) && inp.kind === output.kind && inp.is_linked,
      );
      if (compatibleInput) {
        const val = ctx.socketValue(compatibleInput, cache);
        cache.set(output.id, val);
        consumedInputs.add(compatibleInput);
      } else {
        cache.set(output.id, output.default_value);
      }
    }
  });
}

/* ── Convenience: load BNG file path ────────────────────────────────── */

/**
 * Convenience: fetch a BNG JSON URL and load into trees.
 */
export async function fetchBngDocument(
  url: string,
  opts: LoadBngOptions = {},
): Promise<LoadBngResult> {
  const response = await fetch(url);
  const json = await response.json();
  return loadBngDocument(json, opts);
}

/* ── Export bridged addon source ───────────────────────────────────── */

/**
 * After loading BNG JSON, generate the TypeScript source for all bridged
 * nodes so they can be saved as a proper .ts file for manual refinement.
 */
export function exportBridgedAddonSource(result: LoadBngResult): string {
  const lines: string[] = [
    '/** Auto-generated addon bridge from BNG JSON */',
    'import {',
    '  bpy, nodeitems_utils,',
    '  FloatProperty, IntProperty, BoolProperty, StringProperty,',
    '  EnumProperty, FloatVectorProperty, ColorProperty,',
    '  GeoNodeExecCtx,',
    "} from 'blender-nodes-r3f';",
    '',
  ];

  for (const id of result.bridgedNodeIds) {
    const cls = NodeRegistry.getNode(id);
    if (!cls) continue;
    const nodeProps = (cls as unknown as { properties?: Record<string, unknown> }).properties ?? {};
    lines.push(`// ── ${id} (auto-bridged) ──`);
    lines.push(`//   Properties: ${Object.keys(nodeProps).join(', ') || 'none'}`);
    lines.push(`//   To customise: copy this class, add executeGeo(), remove the auto-registration below.`);
    lines.push('');
  }

  lines.push('');
  lines.push('let _autoRegistered = false;');
  lines.push('export function registerAutoBridgedAddon(): void {');
  lines.push('  if (_autoRegistered) return;');
  lines.push('  _autoRegistered = true;');
  for (const id of result.bridgedNodeIds) {
    lines.push(`  // ${id} — already registered by loadBngDocument()`);
  }
  lines.push('}');

  return lines.join('\n');
}
