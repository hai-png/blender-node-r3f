# blender-nodes-r3f

Blender-compatible node system (Shader / Geometry / Compositor / Texture) for
[three.js](https://threejs.org/) and [react-three-fiber](https://r3f.docs.pmnd.rs/).

**Status**: v0.2.0 — 200+ node types, 4 evaluators, Web Worker geometry offload,
TSL/WebGPU pipeline, full compositor, and **automated Blender-to-Three.js bridge**.

## Quick Start

```bash
npm install blender-nodes-r3f three @react-three/fiber @xyflow/react zustand
```

```ts
import {
  bootstrapBuiltins,
  ShaderNodeTree,
  ShaderEvaluator,
  ShaderNodeOutputMaterial,
  ShaderNodeBsdfPrincipled,
  ShaderNodeTexNoise,
  SceneIntegration,
} from 'blender-nodes-r3f';

// 1. Register all built-in nodes, sockets, and executors.
bootstrapBuiltins();

// 2. Create a shader node tree.
const tree = new ShaderNodeTree('MyMaterial');

// 3. Build the graph.
const output = tree.addNode(ShaderNodeOutputMaterial, { location: [400, 0] });
const bsdf   = tree.addNode(ShaderNodeBsdfPrincipled,  { location: [50, 0] });
const noise  = tree.addNode(ShaderNodeTexNoise,        { location: [-250, -120] });

tree.addLink(bsdf.outputs[0]!, output.inputs[0]!);
tree.addLink(noise.outputs[1]!, bsdf.inputs.find(s => s.name === 'Roughness')!);

// 4. Evaluate → three.js material.
tree.depsgraph.setEvaluator(new ShaderEvaluator());
const { color, roughness, metalness } = tree.depsgraph.evaluate()!.output;

// 5. Live-scene integration.
const scene = new SceneIntegration({ canvas: document.querySelector('canvas')! });
scene.setTree(tree);  // auto-updates geometry/material on evaluation

// 6. Clean up.
tree.dispose();
```

---

## Automated Blender-to-Three.js Bridge

The bridge imports **any** `.blend` node tree into three.js —
no manual porting, no shim classes, no glue code.

### Pipeline

```
  blender_exporter.py        addon_transpiler.ts        runtime_loader.ts
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ Export from Blender  │    │ Python → TypeScript  │    │ BNG JSON → NodeTree  │
│                     │    │                     │    │                     │
│ .blend file          │    │ class MyNode(Node):  │    │ {                   │
│   ↓                 │    │   bl_idname = 'X'   │    │   schema: 'BNG/1',  │
│ blender_exporter.py │    │   ↓                 │    │   trees: [...]       │
│   ↓                 │    │ extends bpy.Node {}  │    │ }                   │
│ scene.bng.json      │    │   ↓                 │    │   ↓                 │
│                     │    │ auto-executeGeo()    │    │ loadBngDocument()   │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
                                                             │
                                                             ▼
                                                    ┌─────────────────────┐
                                                    │  Three.js Scene      │
                                                    │                     │
                                                    │  SceneIntegration    │
                                                    │  .setTree(tree)      │
                                                    │  .play()             │
                                                    └─────────────────────┘
```

### Usage

```ts
import { bootstrapBuiltins } from 'blender-nodes-r3f';
import { BlenderBridge, quickLoadBng } from 'blender-nodes-r3f/bridge';
import { SceneIntegration } from 'blender-nodes-r3f';

bootstrapBuiltins();

// ── Option A: One-liner from URL ──
const trees = await quickLoadBng('/scene.bng.json');

// ── Option B: Full bridge (addon transpilation + BNG load) ──
const bridge = new BlenderBridge();

// If the .blend uses custom addon nodes, supply the addon source:
bridge.withAddon(addonPythonSource);

// Load the BNG JSON (supports string or pre-parsed object):
const result = bridge.loadBlendExport(bngJson);

// Trees are immediately evaluable:
const tree = result.trees[0]!;
tree.depsgraph.evaluate();  // → MaterialDescriptor | Geometry | Texture

// Connect to live three.js scene:
const scene = new SceneIntegration({ canvas });
bridge.connectToScene(tree, scene);
scene.play();  // with simulation zones

// Inspect what happened:
console.log(result.report);
// → { treeCount: 2, bridgedCount: 5, addonTranspiled: true, ... }
```

### What It Handles

| Feature | Mechanism |
|---|---|
| **Unknown node types** | Auto-bridged: dynamic `Node` subclass with correct sockets & properties, pass-through executor |
| **Custom Python addons** | `addon_transpiler.ts`: parses `bpy.props.FloatProperty(...)`, `self.inputs.new(...)`, `bl_idname` → TypeScript |
| **Group nodes** | Recursive inlining via `flattenTree()` with shared-tree reference guards |
| **Zone nodes** | Simulation/Repeat/Foreach with per-frame state caching |
| **All 4 tree types** | Shader, Geometry, Compositor, Texture — evaluator auto-selected |
| **Custom executors** | After auto-bridge, add `executeGeo(ctx)` for real behaviour |
| **Round-trip** | `exportDocument()` → JSON → `importDocument()` preserves everything |

### Example: Real Blender Addon → Three.js

```ts
// Real addon: POV-Ray renderer nodes (15 custom classes, ~500 lines of Python)
const addonSource = await fetch('/povray_addon.py').then(r => r.text());

// BNG JSON exported from Blender
const bngJson = await fetch('/scene.bng.json').then(r => r.json());

// Load — everything auto-transpiled and auto-bridged
const bridge = new BlenderBridge();
bridge.withAddon(addonSource);
const result = bridge.loadBlendExport(bngJson);

// result.trees[0] — POV-Ray procedural scene, ready to render
// result.trees[1] — POV-Ray shader, material descriptor ready
// result.report.bridgedIds — empty (all 15 nodes transpiled from addon)
// result.report.addonTranspiled — true

// Save transpiled TS for manual refinement:
fs.writeFileSync('src/addons/povray_nodes.ts', bridge.transpiledAddonTs!);
```

---

## Architecture

```
src/
├── core/          # Node, NodeTree, NodeSocket, NodeLink, Properties
├── registry/      # NodeRegistry, NodeCategory
├── sockets/       # 30 built-in socket types
├── nodes/         # 200+ node definitions (common/shader/geometry/compositor/texture)
├── eval/
│   ├── Depsgraph.ts            # Incremental dirty-propagation engine
│   ├── ShaderEvaluator.ts      # Shader tree → MaterialDescriptor
│   ├── GeometryEvaluator.ts    # Geometry tree → Geometry objects
│   ├── CompositorEvaluator.ts  # WebGL compositor (25 kernel + 35 pixel shaders)
│   ├── TextureEvaluator.ts     # Legacy texture evaluator
│   ├── MathLib.ts              # Shared math/colour/noise library
│   ├── EvalError.ts            # Structured error types
│   ├── CommonExecutors.ts      # Registry dispatch for common nodes
│   ├── shaders/ShaderNodeExecutors.ts   # Per-node shader executors
│   ├── geometry/GeometryNodeExecutors.ts # Per-node geometry executors
│   ├── geometry/GeometryWorkerPool.ts    # Web Worker offload
│   ├── workers/geometry.worker.js        # Worker script
│   ├── compositor/             # Pixel emitters + kernel programs
│   ├── tsl/TSLShaderEvaluator.ts # WebGPU TSL pipeline
│   └── zones/ZoneRunner.ts     # Simulation / Repeat / Foreach drivers
├── bridge/
│   ├── addon_transpiler.ts     # Python → TS transpiler (Layer 1)
│   ├── runtime_loader.ts       # BNG JSON → evaluable trees (Layer 2)
│   ├── blender_bridge.ts       # End-to-end orchestrator (Layer 3)
│   ├── blender_exporter.py     # Blender addon: .blend → BNG JSON
│   ├── bpy_shim.ts             # Python API mirror (for manual ports)
│   ├── importer.ts / exporter.ts / schema.ts
├── bridge.ts                   # Sub-entry: 'blender-nodes-r3f/bridge'
├── integration/
│   └── SceneIntegration.ts     # Tree → live three.js scene
└── ui/                         # React Flow editor + inspector
```

---

## Evaluation Pipeline

```
 NodeTree
    │
    ▼
[Depsgraph]  ← property changes / link changes / frame advance
    │
    ├── dirty-set invalidation   (O(links) downstream propagation)
    ├── microtask-deferred eval  (batches rapid edits)
    └── persistent result cache  (skips re-eval when nothing changed)
    │
    ▼
[System Evaluator]
    │
    ├── topoOrder() via Kahn's  (cycle detection)
    ├── mute passthrough        (computeInternalLinks)
    ├── dispatchNode()          (registry-based, per-bl_idname)
    │   ├── CommonExecutors     (Math, Mix, MapRange, Clamp, etc.)
    │   ├── ShaderNodeExecutors (BSDFs, Textures, Inputs)
    │   └── GeometryNodeExecutors (Primitives, Ops, Zones)
    ├── group flattening        (Group Input/Output pass-through)
    └── zone runner             (Sim / Repeat / Foreach iteration)
    │
    ▼
[EvaluationResult]
    ├── output:      system-specific (MaterialDescriptor | Geometry | ...)
    ├── duration_ms: total wall-clock time
    ├── node_timings: per-node perf
    └── errors:      structured EvalErrorSet
```

---

## Supported Features

| Feature | Status |
|---|---|
| Shader Nodes (80+) | ✅ Complete |
| Geometry Nodes (70+) | ✅ Complete |
| Compositor Nodes (73) | ✅ Complete (25 kernels + 35 pixel emitters) |
| Texture Nodes (legacy) | ✅ Complete |
| Simulation Zones | ✅ |
| Repeat Zones | ✅ |
| Foreach Element Zones | ✅ |
| Node Groups (Make/Ungroup) | ✅ |
| Undo/Redo (BNG snapshots) | ✅ |
| Auto Layout | ✅ |
| Python Addon Transpiler | ✅ |
| BNG Runtime Auto-Bridging | ✅ |
| End-to-End BlenderBridge | ✅ |
| Web Worker Geometry Offload | ✅ |
| TSL / WebGPU Materials | ✅ (browser-only sub-entry) |
| SceneIntegration (live three.js) | ✅ |
| Import/Export (BNG/1 JSON) | ✅ |
| Blender Exporter (Python addon) | ✅ |

## License

MIT — see [LICENSE](./LICENSE).
