# Architecture

This document describes the internal architecture of `blender-nodes-r3f`.

## Core Data Model (`src/core/`)

The core classes mirror Blender's Python API:

```
NodeTree          → bpy.types.NodeTree
Node              → bpy.types.Node
NodeSocket        → bpy.types.NodeSocket
NodeLink          → (implicit in Blender)
NodeTreeInterface → bpy.types.NodeTreeInterface
```

### NodeTree

- Owns `nodes[]`, `links[]`, and a `NodeTreeInterface`
- Maintains `outAdj: Map<Node, Set<NodeLink>>` and `inAdj: Map<Node, Set<NodeLink>>` for O(1) fan-out/fan-in lookups
- Maintains `zoneIndex: Map<zone_id, {input, output}>` for O(1) zone pair lookups
- `topoOrder()` uses Kahn's algorithm with cycle detection. Cyclic nodes are appended at the end and the result array exposes `cycleNodes`
- `addLink()` enforces: socket direction, link limits, cycle prevention, and zone-escape rules
- `addZone()` creates paired Simulation/Repeat/Foreach Input+Output nodes with the default state link
- WeakRef-based tree registry (`_allTreeRefs`) for cross-tree group refresh with GC compatibility
- `dispose()` for explicit cleanup (tests, undo snapshots)

### Node

- Static `bl_idname`, `bl_label`, `bl_icon`, `bl_width_default`, `tree_types`
- Static `properties: PropertyMap` for declarative RNA-style properties
- Constructor installs reactive getters/setters for each declared property, with automatic depsgraph invalidation and event emission
- `addInput<S>(SocketCls, name, opts)` / `addOutput<S>(SocketCls, name, opts)` — type-safe socket creation
- `computeInternalLinks()` — Blender-compatible mute pass-through routing
- Lifecycle hooks: `init()`, `copy()`, `free()`, `update()`, `insert_link()`

### NodeSocket

- 30 built-in types (`NodeSocketFloat`, `NodeSocketVector`, `NodeSocketColor`, etc.)
- Each subtype has distinct `kind`, `color`, and `coerceFrom()` logic
- `coerceFrom(other)` — type coercion (float→vec3 broadcasts, vec3→color appends alpha, etc.)
- `resolve()` — returns linked value or default
- `link_limit = 0` for multi-input sockets (unlimited connections)

### NodeLink

- `is_valid` getter — validates socket compatibility (same-kind always ok, shader↔shader only, geometry↔geometry only, numeric types auto-coerce)
- `escapes_zone` — set by NodeTree when a link violates zone containment rules
- `is_muted` — muted links are skipped by evaluators

### Properties (`Properties.ts`)

Mirrors `bpy.props.*`:
- `FloatProperty({default, min, max, subtype, update})`
- `IntProperty`, `BoolProperty`, `StringProperty`
- `EnumProperty({items: [...]})`
- `FloatVectorProperty({size: 2|3|4, subtype})`
- `ColorProperty`, `PointerProperty`

Each is installed as a reactive getter/setter on the node instance.

## Depsgraph (`src/eval/Depsgraph.ts`)

- **One per NodeTree**, created at tree construction time
- **Dirty-set propagation**: `invalidate(node)` marks the node and all downstream nodes dirty via link traversal
- **Microtask-deferred**: `schedule()` uses `queueMicrotask()` so rapid consecutive edits are batched
- **Persistent caching**: if no nodes are dirty and the tree hasn't changed, returns the previous result immediately
- **Scene-time tracking**: `setScene({frame, fps, elapsed})` updates the scene clock and triggers re-eval. If the user rewinds, simulation caches are invalidated from that frame forward
- **Topology-clear**: on node/link add/remove, the evaluator's persistent cache is cleared

## Evaluators

### ShaderEvaluator → MaterialDescriptor

Walks the tree in topological order, executing each node. Produces a `MaterialDescriptor` POJO:

```ts
interface MaterialDescriptor {
  color: RGBA;       // [r, g, b, a] 0-1
  metalness: number;  // 0-1
  roughness: number;  // 0-1
  emissive: Vec3;     // [r, g, b]
  emissive_strength: number;
  opacity: number;
}
```

BSDF nodes produce descriptors; Add Shader sums them; Mix Shader blends them. Texture nodes produce procedural values via the shared `MathLib` noise functions.

### GeometryEvaluator → Geometry

Processes field-producing nodes (FIELD kind) and data-flow nodes (DATA kind) separately:
- FIELD nodes produce `Field<T>` values (lazy, context-bound)
- DATA nodes consume Geometry + Fields and produce new Geometry
- Materialisation happens inside each data-flow node handler

The evaluator has a large inline dispatch chain (`if (node instanceof ...)`) that will be incrementally migrated to the registry-based `GeometryNodeExecutors` pattern.

### Registry-Based Dispatch (`NodeExecute.ts`)

The new dispatch pattern:

```ts
// Registration (in node definition or executor module):
registerExecutor('GeometryNodeMeshCube', (node, cache, ctx) => {
  const size = ctx.socketValue(node.inputs[0], cache);
  // ... compute ...
  cache.set(node.outputs[0].id, geometry);
});

// Dispatch (in evaluator):
if (dispatchNode(node, cache, execCtx)) return; // Found and executed
// fallback to inline instanceof chain...
```

**Registered executors**: CommonExecutors (Math, VectorMath, Mix, MapRange, Clamp, ColorRamp, Curves, Compare, Switch, etc.), ShaderNodeExecutors (all BSDFs, textures, inputs), GeometryNodeExecutors (primitives, transforms, common ops).

### CompositorEvaluator

Largely a re-export of `CpuComposite.ts`. The compositor pipeline:
1. Flatten the tree (inline groups, bypass reroutes)
2. Build a compositor plan (nodes in topo order with input/output buffers)
3. Execute each step: some nodes have pixel-level emitters, others have GLSL kernel shaders

Currently CPU-only. Many node emitters are stubs.

### TextureEvaluator

Evaluates legacy Blender texture node trees. Produces a `SampleFn(x, y)` that returns `[r, g, b, a]` at a given UV coordinate.

## Zone System (`src/eval/zones/`)

### ZoneRunner

Drives the interior of Simulation / Repeat / Foreach zones:

1. **Locate** the paired Input/Output nodes via `findPair()`
2. **Collect interior** nodes (forward-reachable from Input AND backward-reachable from Output)
3. **Run the zone loop**:
   - **Simulation**: read initial state from Input's lower row; for each frame, seed the interior, run it, collect the next state into SimZoneCache
   - **Repeat**: iterate N times, feeding each iteration's state forward
   - **Foreach**: slice per-element state from the input geometry, run the interior for each element, aggregate results (join geometries)

### SimZoneCache

Per-zone, per-frame state storage. Survives across `evaluate()` calls so animation playback works. Calling `invalidateFrom(frame)` when the user rewinds ensures clean restart.

## Bridge System (`src/bridge/`)

### BNG/1 Schema

Zod-validated JSON format:

```ts
z.object({
  schema: z.literal('BNG/1'),
  blender_version: z.string().optional(),
  trees: z.array(BngTree),
})
```

Each tree contains nodes, links, and interface items. Group nodes reference child trees by ID. Zone state items carry dynamic socket declarations.

### Importer / Exporter

`importDocument(json)` → `NodeTree[]`
`exportDocument(trees)` → `BngDocumentT`

Both handle: group I/O socket matching by identifier, zone state items, property serialization, interface items.

### Python Exporter (`blender_exporter.py`)

A Blender addon that exports `.blend` node trees to BNG JSON. Must be installed in Blender's addons directory.

### bpy_shim

Provides Python-flavoured API surface for ported addons:
- `bpy.types.Node`, `bpy.types.NodeSocket`, `bpy.types.NodeTree`
- `bpy.props.FloatProperty(...)`, etc.
- `bpy.utils.register_class(cls)`
- `nodeitems_utils.NodeCategory`, `nodeitems_utils.NodeItem`
- `inputs_new(type, name)` / `outputs_new(type, name)` — Pythonic socket creation

## Shared Math Library (`src/eval/MathLib.ts`)

Centralised, pure math functions used by all evaluators:

| Category | Functions |
|---|---|
| Interpolation | `lerp`, `clamp01`, `smooth01`, `fract`, `clamp`, `remap` |
| Vectors | `rsqrt`, `normalize3`, `safeDiv` |
| Hashing | `ihash2`, `ihash3` (PCG/Wang-style, deterministic) |
| Noise | `valueNoise2`, `valueNoise3`, `fbm3`, `voronoiF1F2` |
| Colour | `rgbToHsv`, `hsvToRgb`, `rgbToHsl`, `hslToRgb`, `hue2rgb` |
| BSDF | `schlickFresnel`, `ggxDistrib`, `smithG` |
| Matrices | `IDENTITY_4X4` |

## Error Handling (`src/eval/EvalError.ts`)

Structured errors replace the old `Map<string, string>` pattern:

```ts
interface EvalError {
  severity: 'WARN' | 'ERROR';
  nodeId: string;
  nodeName: string;
  code: string;       // machine-readable (see ErrorCode enum)
  message: string;    // human-readable
  detail?: unknown;   // stack, intermediate values
}
```

Standard error codes: `NOT_IMPLEMENTED`, `MISSING_INPUT`, `TYPE_MISMATCH`, `INVALID_PROPERTY`, `CYCLE_DETECTED`, `ZONE_FAILURE`, `INVALID_GEOMETRY`, `MISSING_RESOURCE`, `INTERNAL`, `MUTED_PASSTHROUGH`.

## UI Layer (`src/ui/`)

- **NodeEditor.tsx** — React Flow integration; renders nodes, handles drag/select/connect
- **BlenderNode.tsx** — per-node React component with socket circles, labels, and property controls
- **Inspector.tsx** — property panel for selected nodes
- **store.ts** — Zustand store wrapping the active NodeTree; supports multiple tree slots with per-slot persistence
- **operators.ts** — pure headless-testable tree manipulations: `autoLayout()`, `makeGroup()`, `ungroup()`, `History` (snapshot-based undo/redo via BNG JSON)

## Design Decisions

1. **CPU-first geometry**: All geometry processing runs on CPU using TypedArrays. WebGPU compute shaders would be the natural upgrade path for production use.

2. **MaterialDescriptor vs TSL**: The shader evaluator produces a simple POJO rather than three.js TSL nodes. This keeps the library usable without `three/webgpu`. The TSL evaluator is a separate sub-entry.

3. **Registry-based dispatch**: New executors use `registerExecutor()` + `dispatchNode()`. The old instanceof chains in ShaderEvaluator and GeometryEvaluator are being incrementally migrated.

4. **BNG JSON for undo**: Rather than implementing a command pattern, undo/redo serialises the entire tree to BNG JSON. Simple, robust, and tied to the bridge round-trip guarantees.

5. **WeakRef tree registry**: `NodeTree._allTreeRefs` uses `WeakRef` so trees are garbage-collectible. The deprecated `_allTrees` getter remains for backward compat.

## Known Limitations

- Geometry operations are CPU-only; large meshes will be slow
- The compositor is partially implemented; many nodes are stubs
- No multi-threading or Web Worker offload
- The TSL/WebGPU pipeline is a separate, browser-only sub-entry
- The Python exporter requires Blender to be installed
