# Architecture — `blender-nodes-r3f`

This document specifies the concrete TypeScript architecture that realises the model laid out in `RESEARCH.md`. It is meant to be detailed enough that any subsystem can be implemented independently against the published interfaces.

```
blender-nodes-r3f/
├── docs/                  # RESEARCH.md, ARCHITECTURE.md, ROADMAP.md
├── src/
│   ├── core/              # Runtime mirror of bpy.types.*
│   ├── sockets/           # Built-in NodeSocket subclasses
│   ├── nodes/             # Built-in node implementations
│   │   ├── common/        # Math, Mix, Group, Frame, Reroute, …
│   │   ├── shader/        # ShaderNodeBsdfPrincipled, ShaderNodeTexImage, …
│   │   ├── geometry/      # GeometryNodeMeshCube, GeometryNodeSetPosition, …
│   │   ├── compositor/    # CompositorNodeBlur, CompositorNodeAlphaOver, …
│   │   └── texture/       # TextureNodeNoise, TextureNodeImage, …
│   ├── eval/              # Per-system evaluators + Depsgraph
│   │   ├── Depsgraph.ts
│   │   ├── ShaderEvaluator.ts
│   │   ├── GeometryEvaluator.ts
│   │   ├── CompositorEvaluator.ts
│   │   ├── TextureEvaluator.ts
│   │   └── zones/
│   ├── registry/          # bpy.utils.register_class equivalents
│   ├── ui/                # React Flow editor + AddMenu + operators + store
│   ├── bridge/            # Blender ↔ JSON exporter/importer + bpy shim
│   └── index.ts
├── demo/                  # Vite app showcasing all four systems
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 1. The five foundational types

```ts
// src/core/types.ts
export type SocketKind =
  | 'VALUE'        // float
  | 'INT'
  | 'BOOLEAN'
  | 'VECTOR'
  | 'ROTATION'
  | 'MATRIX'
  | 'STRING'
  | 'RGBA'
  | 'SHADER'       // BSDF closure handle
  | 'GEOMETRY'     // Geometry container
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

export type DisplayShape = 'CIRCLE' | 'SQUARE' | 'DIAMOND' | 'CIRCLE_DOT' | 'SQUARE_DOT' | 'DIAMOND_DOT';
```

## 2. `NodeSocket` (abstract base)

```ts
// src/core/NodeSocket.ts
export abstract class NodeSocket<T = unknown> {
  static bl_idname: string;     // 'NodeSocketFloat'
  static bl_label : string;
  static kind     : SocketKind;
  static color    : [number,number,number,number];

  id          : string;          // uuid, stable within tree
  identifier  : string;          // stable rename-proof key
  name        : string;          // user-visible label
  description = '';
  is_output   : boolean;
  is_multi_input = false;
  hide        = false;
  hide_value  = false;
  enabled     = true;
  link_limit  = 1;               // 0 = unlimited
  display_shape: DisplayShape = 'CIRCLE';
  default_value!: T;
  value?       : T;              // last evaluated value (for inspection)
  node!       : Node;            // back-reference
  links: NodeLink[] = [];        // managed by NodeTree

  /** True if at least one link connects to this socket. */
  get is_linked() { return this.links.length > 0; }

  /** Subclasses implement type coercion. */
  abstract coerceFrom(other: NodeSocket): T;

  /** Subclasses describe themselves in the React Flow node body. */
  draw?(ctx: DrawContext): React.ReactNode;
}
```

## 3. `Node` (abstract base)

```ts
// src/core/Node.ts
export abstract class Node {
  static bl_idname    : string;
  static bl_label     : string;
  static bl_icon?     : string;
  static bl_width_default = 140;
  static category     : string;      // for Add menu
  static tree_types   : NodeTreeKind[];

  id        : string;                // uuid
  name      : string;                // unique within tree
  label     = '';                    // user override
  location  : [number, number] = [0,0];
  width     = 140;
  height    = 100;
  color     : [number,number,number] = [0.2, 0.2, 0.2];
  use_custom_color = false;
  hide   = false;
  mute   = false;
  select = false;
  parent?: Node;                     // frame parent

  inputs : NodeSocket[] = [];
  outputs: NodeSocket[] = [];
  internal_links: NodeLink[] = [];   // used while muted

  tree!: NodeTree;                   // back-ref injected on add

  abstract init(ctx: InitContext): void;
  copy?(other: Node): void;
  free?(): void;
  update?(): void;                   // after link/property change
  insert_link?(link: NodeLink): boolean;
  draw_buttons?(ctx: DrawContext): React.ReactNode;
  draw_buttons_ext?(ctx: DrawContext): React.ReactNode;
  draw_label?(): string;

  /** Helper used in init(): */
  protected addInput<S extends NodeSocket>(SocketCls: SocketCtor<S>, name: string, opts?: SocketOpts<S>): S;
  protected addOutput<S extends NodeSocket>(SocketCls: SocketCtor<S>, name: string, opts?: SocketOpts<S>): S;
}
```

## 4. `NodeLink`

```ts
// src/core/NodeLink.ts
export class NodeLink {
  id: string;
  from_node  : Node;
  from_socket: NodeSocket;
  to_node    : Node;
  to_socket  : NodeSocket;
  is_muted   = false;
  multi_input_sort_id = 0;
  get is_valid(): boolean;
}
```

## 5. `NodeTree`

```ts
// src/core/NodeTree.ts
export class NodeTree {
  static bl_idname: NodeTreeKind;
  static bl_label : string;

  id   : string;
  name : string;
  nodes: Node[] = [];
  links: NodeLink[] = [];
  interface = new NodeTreeInterface(this);

  addNode<N extends Node>(NodeCls: NodeCtor<N>, init?: Partial<N>): N;
  removeNode(node: Node): void;
  addLink(from: NodeSocket, to: NodeSocket): NodeLink;
  removeLink(link: NodeLink): void;

  /**
   * Topologically sorted forward edges (Kahn's algorithm).
   * On a cycle, does NOT throw; instead, appends the cycle nodes at the end
   * and sets `result.cycleNodes` so evaluators can surface a diagnostic error.
   * Blender forbids cycles entirely; our evaluator surfaces them as errors
   * after the fact rather than at link-time (link-time rejection IS enforced
   * by `NodeTree.addLink()`).
   */
  topoOrder(): Node[] & { cycleNodes?: Node[] };

  /**
   * Convenience: remove all links involving `node` and then remove the node
   * from the tree. Calls `node.free?.()` and emits `node_removed`.
   */
  removeNode(node: Node): void;

  /**
   * Release this tree from the global `_allTreeRefs` registry and clear all
   * listeners. Call when done with a tree (tests, undo snapshots, etc.).
   */
  dispose(): void;
}
```


## 6. `NodeTreeInterface`

```ts
// src/core/NodeTreeInterface.ts
export class NodeTreeInterface {
  items_tree: InterfaceItem[] = [];   // mix of NodeTreeInterfaceSocket and …Panel

  new_socket(opts: {
    name: string;
    description?: string;
    in_out: InOut;
    socket_type: string;          // 'NodeSocketFloat', …
    parent?: NodeTreeInterfacePanel;
  }): NodeTreeInterfaceSocket;

  new_panel(name: string, default_closed?: boolean): NodeTreeInterfacePanel;
  remove(item: InterfaceItem): void;
  move(item: InterfaceItem, to: number): void;
}
```

## 7. Properties

```ts
// src/core/Properties.ts
// Mirror of bpy.props.* — used to declaratively define editable node fields.
export function FloatProperty(opts: { default?: number; min?: number; max?: number; subtype?: string; update?: (n: Node)=>void }): PropertyDescriptor;
export function IntProperty(opts: …): PropertyDescriptor;
export function BoolProperty(opts: …): PropertyDescriptor;
export function StringProperty(opts: …): PropertyDescriptor;
export function EnumProperty(opts: { items: [string,string,string][]; default?: string; update?: (n: Node)=>void }): PropertyDescriptor;
export function FloatVectorProperty(opts: { size?: number; default?: number[]; subtype?: 'COLOR'|'XYZ'|'DIRECTION' }): PropertyDescriptor;
export function PointerProperty(opts: { type: any }): PropertyDescriptor;
```
These attach metadata so the inspector panel renders them automatically and so the JSON serialiser knows what to persist.

## 8. Depsgraph

```ts
// src/eval/Depsgraph.ts
export class Depsgraph {
  scene: SceneTime;                    // frame, fps, elapsed
  simCache: Map<string, SimZoneCache>; // per-zone simulation state

  constructor(public tree: NodeTree) {}

  /** Inject the evaluator. Must be called before evaluate(). */
  setEvaluator(ev: SystemEvaluator): void;

  /** Mark node and all downstream as dirty. */
  invalidate(node: Node): void;
  invalidateAll(): void;

  /** Update scene clock; triggers re-evaluation. Rewinds truncate sim caches. */
  setScene(partial: Partial<SceneTime>): void;
  /** Wipe all simulation caches and reset the clock. */
  resetSimulation(): void;

  /** Run the injected evaluator over the tree. Returns undefined if no evaluator set. */
  evaluate(): EvaluationResult | undefined;

  on(event: 'evaluated', cb: (r: EvaluationResult) => void): () => void;
  dispose(): void;
}
```

Each `NodeTree` has exactly one `Depsgraph`. **The evaluator is injected by the
host via `depsgraph.setEvaluator(ev)` — it is NOT auto-selected from
`tree.bl_idname`.** This lets callers swap the TSL path vs the legacy WebGL
path at runtime. Evaluation is scheduled via `queueMicrotask` so multiple
synchronous edits coalesce into one evaluation tick.


## 9. Per-system evaluators

### 9.1 `ShaderEvaluator`
- Input: `ShaderNodeTree`
- Output: `THREE.NodeMaterial` (a `MeshStandardNodeMaterial` if the tree has a Material Output → Principled BSDF; otherwise a custom shader)
- Walks back from `ShaderNodeOutputMaterial` to compose TSL nodes.
- Each shader node implements `emit(env: ShaderEnv): TSLNode` instead of `evaluate()`.
- BSDF closures are represented by a structured TSL graph (color + roughness + metalness + normal + emissive contributions).

### 9.2 `GeometryEvaluator`
- Input: `GeometryNodeTree` (must have `NodeGroupOutput` exposing a `NodeSocketGeometry`)
- Output: a `Geometry` data structure → converted to `THREE.BufferGeometry` (+ `InstancedMesh` for instances)
- Each geometry node implements either:
  - `execute(ctx: GeoCtx, inputs): { [outputId]: GeoValue }` for data-flow nodes
  - `field(ctx: GeoCtx, inputs): Field<T>` for field nodes
- `Geometry` carries `Mesh`, `Curves`, `PointCloud`, `Volume`, `Instances` components, each with typed attribute spans.
- Lazy materialisation: a `Field` is `(domain, geometry) => TypedArray`. Spans are pooled & reused.

### 9.3 `CompositorEvaluator`
- Input: `CompositorNodeTree` with a `CompositorNodeComposite` or `…Viewer` output
- Output: an HTMLCanvasElement / `WebGLRenderTarget`
- Each compositor node implements:
  - `determineResolution(inputs): [w, h]`
  - `execute(ctx: CompCtx, inputs): Result` where `Result = { texture, width, height, channels }`
- Pixel-wise consecutive nodes are **fused** into a single fragment shader (`ShaderOperation`-equivalent).
- Filter / kernel nodes (blur, glare, denoise) are implemented as dedicated WebGL passes.

### 9.4 `TextureEvaluator`
- Input: `TextureNodeTree`
- Output: a sample function `(u: number, v: number) => RGBA` and/or a baked texture
- Each node has `sample(u, v, derivs): RGBA`

## 10. Zones (Simulation / Repeat / Foreach)

```ts
// src/eval/zones/Zone.ts
export interface ZoneNodePair { input: ZoneInputNode; output: ZoneOutputNode; zone_id: string; }
export abstract class ZoneEvaluator {
  abstract run(pair: ZoneNodePair, ctx: GeoCtx, initialState: GeoValue): GeoValue;
}
export class SimulationZoneEvaluator extends ZoneEvaluator { /* persists state between frames */ }
export class RepeatZoneEvaluator     extends ZoneEvaluator { /* runs N times */ }
export class ForeachZoneEvaluator    extends ZoneEvaluator { /* per element */ }
```

## 11. Registry

```ts
// src/registry/NodeRegistry.ts
export const NodeRegistry = {
  register(cls: NodeCtor<any>): void,
  registerSocket(cls: SocketCtor<any>): void,
  registerTree(cls: typeof NodeTree): void,
  unregister(bl_idname: string): void,
  getNode(bl_idname: string): NodeCtor<any> | undefined,
  getSocket(bl_idname: string): SocketCtor<any> | undefined,
  listForTree(kind: NodeTreeKind): NodeCtor<any>[],
};

// NodeCategory mirrors nodeitems_utils.NodeCategory
export class NodeCategory {
  constructor(public id: string, public label: string, public items: NodeItem[], public poll?: (ctx: AppContext)=>boolean) {}
}
export class NodeItem { constructor(public bl_idname: string, public label?: string, public settings?: Record<string, unknown>) {} }
```

## 12. Bridge (Blender ↔ JS)

### 12.1 `bridge/blender_exporter.py`
Runs **inside Blender**. Walks `bpy.data.node_groups` (or selected trees) and writes JSON:
```json
{
  "schema": "BNG/1",
  "blender_version": "5.1.0",
  "trees": [
    {
      "bl_idname": "GeometryNodeTree",
      "name": "Voxelize",
      "interface": { "items": [ { "kind":"socket","in_out":"INPUT","socket_type":"NodeSocketGeometry","name":"Geometry","identifier":"Input_0" }, … ] },
      "nodes": [
        {
          "id": "n_001", "bl_idname": "GeometryNodeMeshCube", "name": "Cube",
          "location": [0,0], "properties": {},
          "inputs":  [ { "identifier":"Size",      "default_value":[2,2,2] }, … ],
          "outputs": [ { "identifier":"Mesh" } ]
        }, …
      ],
      "links": [ { "from_node":"n_001","from_socket":"Mesh","to_node":"n_002","to_socket":"Geometry" }, … ]
    }
  ]
}
```

### 12.2 `bridge/importer.ts`
Validates the JSON with Zod, then calls the public runtime API:
```ts
const tree = importNodeTree(json);  // returns a fully-wired NodeTree
```
Round-trip safe: `exportNodeTree(tree)` reproduces the same JSON.

### 12.3 `bridge/bpy_shim.ts`
A tiny shim so that ported Python addons can be transliterated near-mechanically. Provides:
```ts
export const bpy = {
  types: { Node, NodeSocket, NodeTree, NodeTreeInterface, …all built-ins… },
  props: { FloatProperty, IntProperty, … },
  utils: { register_class, unregister_class },
};
export const nodeitems_utils = { register_node_categories, unregister_node_categories };
```
With this, a Blender custom-node addon usually requires **only syntactic** changes (Python → TypeScript class), not architectural ones.

## 13. UI

- `src/ui/NodeEditor.tsx` — React Flow 12 host. Each Node renders via `nodeTypes` map keyed by `bl_idname`. Sockets become `Handle`s. Multi-input handles use React Flow's `connectionMode="loose"` + custom validation. Includes an inline `OperatorBar` with Undo/Redo/AutoLayout/Group/Ungroup/Mute/Hide actions and full keyboard shortcuts (Shift+A, Ctrl+Z/Y, M, H, Ctrl+C/V, Ctrl+L, Ctrl+G, Alt+G).
- `src/ui/AddMenu.tsx` — Shift+A / right-click add menu driven by `NodeCategories` registry (addon-registered categories first, static `Node.category` fallback). Supports free-text search.
- `src/ui/BlenderNode.tsx` — universal node renderer: Blender-style header colour per category, coloured handles by socket kind, inline property editors (Float/Int/Bool/Enum/Vector).
- `src/ui/store.ts` — Zustand store with **per-tree persistence**: switching tree tabs does not discard edits. Holds `Map<slotId, NodeTree>` and the active slot. Provides `setTree(id, tree)` and `switchTree(id)`.
- `src/ui/operators.ts` — headless editor operators: `autoLayout`, `makeGroup`, `ungroup`, `History`.

- `src/ui/Inspector.tsx` — standalone Properties Inspector sidebar panel. Displays detailed metadata, interactive properties (Float, Int, Bool, Enum, String, Color), unlinked socket default values (with sub-axis inputs for vectors), and evaluation timings/error warnings.
- Theming: Tailwind and custom inline tokens that match Blender's "Default" theme (dark grey 0x1d1d1d, headers per-category color, dark input boxes).

## 14. R3F viewport (demo)

- `demo/Viewport.tsx`
- Subscribes to `tree.depsgraph.on('evaluated', …)`.
- For **Shader**: assigns the produced `NodeMaterial` to a `MeshStandardMaterial`-shaped mesh (sphere by default).
- For **Geometry**: replaces the contents of a parent `<group>` with the new `BufferGeometry` and any `InstancedMesh` instances.
- For **Compositor**: full-screen quad with the produced texture.
- For **Texture**: applies the procedural sampler to a debug plane.

## 15. Build / packaging

Two separate build targets:

### Library (`npm run build:lib` → `tsup`)
- **Entry points:**
  - `src/index.ts` → `dist/index.js` (ESM) + `dist/index.cjs` (CJS) + `dist/index.d.ts` / `dist/index.d.cts`
  - `src/tsl.ts`   → `dist/tsl.js` (ESM)   + `dist/tsl.cjs` (CJS)   + `dist/tsl.d.ts` / `dist/tsl.d.cts`
- Peer dependencies (`three`, `react`, `@xyflow/react`, `zustand`) are **not bundled**.
- `tsup.config.ts` at root configures entry, format, dts, treeshake, and externals.
- `tsconfig.lib.json` extends the root tsconfig with `rootDir:"src"`, `outDir:"dist"`, `emitDeclarationOnly:true`.

### Package exports map (`package.json`)
```json
"exports": {
  ".":      { "import": "dist/index.js",  "require": "dist/index.cjs" },
  "./tsl":  { "import": "dist/tsl.js",    "require": "dist/tsl.cjs"   }
}
```
The TSL sub-entry isolates the `three/webgpu` import (requires `self`/`navigator.gpu` globals) from the main entry, so Node.js / SSR consumers can import `blender-nodes-r3f` without crashing.

### Demo (`npm run build:demo` → `vite build`)
- Vite root is `demo/`, output goes to `dist-demo/`.
- `vite.config.ts` handles the demo app only; it is not part of the library build.

### CI pipeline (`npm run ci`)
`typecheck → test → build:lib → build:demo`

Node 20+ required.

---

