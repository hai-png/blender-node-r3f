# `blender-nodes-r3f` — Phase 1 deep-read audit

> **Date:** 2026-06-02
> **Reviewer:** Arena.ai Agent
> **Repo:** `hai-png/blender-node-r3f` (cloned to `./blender-node-r3f`)
> **Method:** read every source file, ran `npm install && npm run typecheck && npm test && npm run build` end-to-end.

This document is the **source of truth** for what I observed in the codebase, where the implementation lines up with the stated intent (`docs/RESEARCH.md`, `docs/ARCHITECTURE.md`, `README.md`), and where the gaps are. Implementation work in subsequent phases should reference this audit by section.

---

## 0. Verification of the README's headline claims

| README claim | Actual on `main` | Status |
|---|---|---|
| "176 unique node classes register at runtime" | `NodeRegistry.listAllNodes().length === 176` | ✅ |
| "108 headless smoke tests pass" | `134 passed, 0 failed` | ✅ (claim is stale; **understated**) |
| "strict `tsc` clean" | `tsc -p . --noEmit` exits 0 | ✅ |
| "`vite build` clean" | `vite build` exits 0 (~2.4 MB main chunk) | ✅ |
| "M0–M8 prototype/subset implemented" | All four evaluators present, zones + groups + reroute + mute + interface + history + makeGroup/ungroup + autoLayout + bridge + bpy shim + falloff example | ✅ |
| Library entry points `index` + `tsl` build to ESM + CJS + dts | `tsup` emits 6 files (`index.{js,cjs,d.ts,d.cts}`, `tsl.{js,cjs,d.ts,d.cts}`) | ✅ |
| "176 unique node classes" — counts by tree | Shader 67 · Geometry 90 · Compositor 57 · Texture 34 (with cross-tree shared common nodes) | ✅ |
| README references `docs/PHASE0_AUDIT_2026-06-02.md` | **File does not exist** | ❌ broken link |

So the **shipped baseline is healthier than the README advertises** in two respects (test count, no failing audit doc cited). The single observable inconsistency is the broken phase-0 audit link.

---

## 1. Project shape

```
blender-node-r3f/
├── docs/                          RESEARCH.md, ARCHITECTURE.md            (no ROADMAP / PHASE docs despite refs)
├── src/
│   ├── core/         9 files     Node, NodeSocket, NodeLink, NodeTree,
│   │                              NodeTreeInterface, Properties, trees, types
│   ├── sockets/      1 file (327 LOC)   31 socket subclasses
│   ├── nodes/
│   │   ├── common/      11 files  Math/VectorMath/Mix/MapRange/Clamp/
│   │   │                            Combine-Separate/ColorRamp/Logic/Frame/Group/Value
│   │   ├── shader/       6 files  Shaders/BSDFs/Textures/Inputs/VectorOps
│   │   ├── geometry/     6 files  Primitives/FieldInputs/FieldUtils/Ops/Zones
│   │   ├── compositor/   2 files  Compositor.ts (675 LOC, 57 classes)
│   │   └── texture/      2 files  Texture.ts (196 LOC)
│   ├── eval/
│   │   ├── Depsgraph.ts                       full impl
│   │   ├── ShaderEvaluator.ts                 legacy POJO descriptor path (1100+ LOC)
│   │   ├── GeometryEvaluator.ts               1988 LOC, fields + zones + groups
│   │   ├── CompositorEvaluator.ts             re-export shim
│   │   ├── TextureEvaluator.ts                385 LOC sampler graph + baker
│   │   ├── flatten.ts                         group/reroute inliner
│   │   ├── tsl/TSLShaderEvaluator.ts          1140 LOC real Three.js TSL emitter
│   │   ├── compositor/                        full M5 WebGL pipeline
│   │   │   ├── CompositorEvaluator.ts (882 LOC), CpuComposite, KernelShaders,
│   │   │   ├── PixelGLSL, Quad, TexturePool, types
│   │   ├── geometry/   Field.ts, Geometry.ts, MeshOps.ts
│   │   └── zones/      ZoneRunner.ts, types.ts
│   ├── registry/NodeRegistry.ts               bpy.utils.register_class mirror
│   ├── ui/             7 files                NodeEditor, BlenderNode, AddMenu,
│   │                                            Inspector, store, operators
│   ├── bridge/         5 files                schema (Zod) + import/export +
│   │                                            blender_exporter.py + bpy_shim
│   ├── tsl.ts                                 TSL sub-entry
│   └── index.ts                               public API + bootstrapBuiltins()
├── examples/falloff_addon.ts                  ported-Blender-addon worked example
├── demo/                                      Vite app: App, Viewport, TSLViewport
├── scripts/smoketest.ts                       3157 LOC of behavioural tests
├── .github/workflows/ci.yml                   typecheck → test → build
├── tsup.config.ts, tsconfig.json,
│   tsconfig.lib.json, vite.config.ts
└── package.json, README.md, LICENSE
```

**Totals:** ~23.9 k LOC across 81 source files (excluding lockfile).

---

## 2. Intent vs implementation — section-by-section

### 2.1 Core data model (RESEARCH §2, ARCHITECTURE §1–§7)

| Concept | Module | Implementation quality |
|---|---|---|
| `bpy.types.NodeTree` | `src/core/NodeTree.ts` | **Strong.** Adds beyond spec: zone-escape detection, weak global registry (`_allTreeRefs` w/ `WeakRef`), `addZone()`, cycle-tolerant `topoOrder()`, refresh-group hook, listener bus, microtask-batched eval. |
| `bpy.types.Node` | `src/core/Node.ts` | **Strong.** Declarative `static properties` auto-installed as getter/setter pairs with `update` callbacks; `addInput/addOutput` helpers; `computeInternalLinks()` for mute pass-through (matches Blender's "first compatible input by type"); `findInput/findOutput` by identifier. |
| `bpy.types.NodeSocket` | `src/core/NodeSocket.ts` + `src/sockets/index.ts` | **Strong.** 31 subclasses register, covers every kind in RESEARCH §2.3 including the 2025 sub-types (Factor, Angle, Percentage, Time, Distance, Unsigned, Direction, Euler, Translation, Velocity, Acceleration, Filepath, IntUnsigned). `coerceFrom()` implements implicit conversions. |
| `bpy.types.NodeLink` | `src/core/NodeLink.ts` | **Correct.** `is_valid` enforces type compat (numeric coercion, custom passthrough). Adds `escapes_zone` flag — beyond spec but matches Blender's zone visualisation. |
| `bpy.types.NodeTreeInterface` | `src/core/NodeTreeInterface.ts` | **Spec-compliant.** Sockets + panels, `new_socket`, `new_panel`, `remove`, `move`, `inputs()/outputs()` accessors. |
| `bpy.props.*` | `src/core/Properties.ts` | **Spec-compliant.** Float/Int/Bool/String/Enum/Vector/Color all present; PointerProperty exposed via `bpy_shim` (not the core file — inconsistency, see §4). |
| `NodeRegistry` / `register_class` | `src/registry/NodeRegistry.ts` | **Strong.** `register/unregister/get*/listForTree/listAllNodes`, subscribe-able; `NodeCategory` + `NodeItem` + `NodeCategories` collection — close to `nodeitems_utils`. |

**Verdict:** **Faithful 1:1 mirror of Blender's `bpy.types.*`.** A Blender-savvy developer can read this code and recognise the API immediately. The two beyond-spec additions (zone-escape, weak tree registry) are well-motivated and don't break the mental model.

### 2.2 Depsgraph (RESEARCH §7, ARCHITECTURE §8)

- Injected evaluator (`setEvaluator`) — ✅ matches architecture note that auto-selection was rejected.
- Scene clock (`scene.frame/fps/elapsed`), simulation caches, microtask scheduling, rewind handling — ✅ all present.
- Cycle detection annotated onto the returned topo order — ✅ matches RESEARCH §2.5 ("Blender forbids cycles entirely; surface as runtime error").
- Topology-change → `evaluator.clearPersistentCache?.()` — ✅ a clean lifecycle hook each system evaluator can opt into.

**Documented limitation (correctly disclosed):** evaluators *track* a dirty set but each `evaluate()` still re-walks the full tree. `phase3:` tests do exercise per-node persistent output caching in the Geometry and Shader evaluators (skips clean-node recomputation), so the claim "full-tree re-evaluation" in the README is too pessimistic about its own design. **What's missing is true topological dirty-set propagation that re-executes only the dirty fringe** — see §5.A below.

### 2.3 Shader system

Two evaluators ship:

1. **`ShaderEvaluator` (legacy POJO):** walks back from `ShaderNodeOutputMaterial` and produces a `MaterialDescriptor` (color, metalness, roughness, emissive, opacity). Used by `demo/Viewport.tsx` (WebGL2 fallback). Includes CPU fallbacks for nearly every shader node so a graph can be inspected headlessly — many marked `TSL APPROX` (a misnomer: they're actually the POJO path's approximations, not the TSL path's). 17 BSDFs supported via mix/add closure algebra (`mixDesc`, `addDesc`).
2. **`TSLShaderEvaluator` (primary):** translates the tree into real `three/tsl` nodes and assigns them to a `MeshStandardNodeMaterial`. Lazy-imports `three/webgpu`. Provides `resolveTexture` callback for Image / Environment nodes — ✅ matches the README's TSL section.

**Gaps:**

- Several shader nodes resolve to constants in the legacy evaluator (Voronoi/Wave/Checker/Brick/Gradient/Magic/WhiteNoise/Image/Environment — they emit a fixed RGBA). Tests cover that they *don't throw*; they don't assert correct colour output. The TSL path has the real implementations.
- World Output / Light Output / AOV Output recognised by TSL evaluator (`tsl: world and light outputs are recognized as roots`) but legacy evaluator only handles `ShaderNodeOutputMaterial`. **Inconsistency** between the two paths.
- Curves (RGB Curves, Vector Curves, Float Curve) — **missing entirely** from both paths.
- Shader-To-RGB (EEVEE) — missing.
- Anisotropic / Principled Hair / Principled Volume — registered? Spot-check shows the BSDFs file lists Sheen/Toon/SSS/Translucent/Refraction/Glass/Transparent/Holdout/Background/Add/Mix/VolumeAbsorption/VolumeScatter, but **no Principled Hair, no Principled Volume, no Anisotropic, no Hair, no Emission-Volume Info**. RESEARCH §4.2 lists these as core.

### 2.4 Geometry system

The largest subsystem (1988 LOC evaluator, full `Field<T>` abstraction in `eval/geometry/Field.ts`, mesh ops in `MeshOps.ts`, primitive builders in `Geometry.ts`).

**Implemented:**

- Mesh primitives: Cube/UVSphere/IcoSphere/Cylinder/Cone/Grid/Line/Circle ✅
- Curve primitives: Line/Circle/BezierSegment/Spiral ✅
- Field inputs: Position/Normal/Index/ID/Radius/NamedAttribute ✅
- Operations: SetPosition/Transform/JoinGeometry/CaptureAttribute/Store/RemoveAttr/BoundBox/ConvexHull/MergeByDistance/SubdivisionSurface(Loop)/Triangulate/DistributeOnFaces(Random+Poisson)/MeshToPoints/PointsToVertices/InstanceOnPoints/Realize/Translate/Rotate/ScaleInstances/CurveToMesh/CurveToPoints/Resample/Reverse/Sample/Subdivide/Fill/Fillet curves/SampleIndex/SampleNearest/Proximity/FlipFaces ✅
- Field utilities: AccumulateField, FieldOnDomain, FieldAtIndex, AttributeDomainSize ✅
- Zones (M4): Simulation / Repeat / Foreach Element — with dynamic state-items and partner socket sync ✅
- `executeGeo(ctx)` hook for ported addons (worked `examples/falloff_addon.ts`) ✅

**Coverage vs RESEARCH §4.3:**

| Category in research doc | Implemented? |
|---|---|
| Attribute (Statistic, Capture, DomainSize, Remove, Store, Named, **Blur Attribute**) | All present except **Blur Attribute**, **Attribute Statistic** |
| Input → Constant (Bool/Collection/Color/Image/Int/Material/Object/Rotation/String/Value/Vector) | `Value`/`RGB`/`Vector` only; the 11-way constant pack is missing |
| Input → Scene (Active Camera, Collection Info, Image Info, Is Viewport, Object Info, Scene Time, Self Object) | **All missing** |
| Input → Gizmo (Linear/Dial/Transform) | All missing |
| Input → File (Import OBJ/PLY/STL/CSV/VDB) | All missing |
| Mesh → Topology (Corners-of-Edge, Edges-of-Corner, …) | All missing |
| Mesh → UV (Pack UV Islands, UV Tangent, UV Unwrap) | All missing |
| Mesh → Read (20+ measurement nodes) | None present |
| Mesh → Operations (Dual Mesh, Extrude, Boolean, Mesh-to-Curve/SDF/Volume) | Only Triangulate + Subdivide + SubdivisionSurface(Loop) present |
| Curves → Read (Spline Length, Curve Tangent, Endpoint Selection, …) | None present |
| Curves → Write (Set Radius/Tilt/Cyclic/Type/Resolution/HandleType/Normal) | None present |
| Curves → Operations (Trim, Interpolate, Deform on Surface) | None — only Resample/Reverse/Fill/Fillet/Sample/Subdivide |
| Volume / Grid (25+ nodes) | **None — entire VDB area absent** |
| Material (Replace/Set/MaterialSelection/MaterialIndex) | None |
| Selection (Box/Normal/Sphere) | None |

So Geometry Nodes ships a credible **vertical slice** (primitives, fields, attributes, distribute, instances, basic curves, zones) that runs ported addons, but it is far from RESEARCH §4.3's complete enumeration. The README is honest about being a "subset"; the architecture doc enumerates the full target.

### 2.5 Compositor system

**Implemented well.** This is the most production-ready subsystem:

- Real WebGL pipeline via `THREE.WebGLRenderer`, lazy-allocated, headless-fallback when WebGL is unavailable.
- `TexturePool` recycles `WebGLRenderTarget`s between evaluations.
- `FullScreenQuad` shared.
- **Pixel-wise chain fusion** — the M5 planner greedily collapses adjacent pixel-wise nodes into a single fused fragment shader (`buildPixelFusedShader`), respecting branch points (a node with multiple consumers cannot fuse forward). This is the "ShaderOperation" concept from RESEARCH §3.3.
- Kernel passes (Blur/Glare/Vignette/Pixelate/Translate/Scale/Rotate/Flip/Crop) are individual GLSL programs in `KernelShaders.ts`.
- `cpuComposite` CPU verifier for headless tests.
- Group + Reroute supported via `flattenTree`.

**Gaps vs RESEARCH §4.4:**
- **No matte/keying nodes** (Box/Ellipse/Cryptomatte/Channel Key/Chroma/Color Key/Luminance Key/Difference/Distance/Keying). This is a giant Blender pillar.
- **No defocus, denoise (OIDN), despeckle, dilate/erode, kuwahara, inpaint, sun beams, anti-aliasing**. Only Blur/Glare/Vignette/Pixelate ship.
- **No lens distortion, displace, map UV, plane track, stabilize**.
- **No Tonemap GPU path** (CPU only, in `cpuComposite`).
- **No Color Balance / Color Correction GPU path** (CPU only).
- No movie clip / mask / bokeh image input.
- No File Output node (only Composite / Viewer / Split Viewer).

### 2.6 Texture system (legacy BI textures)

- `TextureEvaluator` compiles to a `(u,v) => RGBA` sampler graph; provides `bakeToDataTexture(sample, w, h) → THREE.DataTexture`.
- Implemented: Output, Coordinates, Noise, Checker, Voronoi, Wave, Magic, Blend, Image, Math, Mix, Color Ramp.
- **Gaps vs RESEARCH §4.5:** Marble, Clouds, Wood, Stucci, Bricks, Distorted Noise, Curve Time, ValToNormal, At, Distance, Translate/Scale/Rotate, Curve RGB, Invert — **none present**.

### 2.7 Bridge (.blend ↔ JSON)

- `bridge/schema.ts` — Zod schemas for socket defs, interface items (sockets + panels), nodes, links, document. **Schema is "BNG/1".** Reasonable.
- `bridge/importer.ts` — two-pass loader (instantiate trees → populate nodes → wire links by identifier). Resolves group containers by id, falls back to name (legacy compatibility). Handles dynamic socket nodes (zones) via `state_items` propagation.
- `bridge/exporter.ts` — round-trip exporter.
- `bridge/blender_exporter.py` — runs **inside Blender** and emits the same schema. Worth a dedicated test (Blender CI) but that's out of scope here.
- `bridge/bpy_shim.ts` — exposes `bpy.types.*`, `bpy.props.*`, `bpy.utils.register_class/unregister_class`, plus `nodeitems_utils.register_node_categories/unregister_node_categories`. Adds `inputs_new()/outputs_new()` Pythonic helpers on `Node.prototype`. **Solid.**

`examples/falloff_addon.ts` proves a real port works end-to-end.

### 2.8 UI

- React Flow 12 host (`NodeEditor.tsx`) with Blender-style keyboard shortcuts (Shift+A, Ctrl+Z/Y, M/H/Ctrl+C/V, Ctrl+G/Alt+G), undo/redo via `History`, autoLayout/makeGroup/ungroup operators.
- `BlenderNode.tsx` — universal renderer with header colour per category, coloured handles by socket kind, inline property editors.
- `AddMenu.tsx` — Shift+A / right-click add menu with search, sectioned by category, addon-registered categories prioritised.
- `Inspector.tsx` — properties sidebar (566 LOC).
- `store.ts` — Zustand store with **per-tree persistence** across tab switching, with explicit `dispose()` of replaced trees and listener-unsub bookkeeping.
- `operators.ts` — `autoLayout` (depth columns), `makeGroup`/`ungroup` (BNG round-trip preserving evaluation), `History` (snapshot-based via JSON serialisation; 100-step limit).

**Polish gaps:**
- The `History` snapshots are full BNG documents — coarse but correct. Per-edit diffs would be cheaper.
- No selection box, no rectangle-select. (React Flow ships this; it may "just work" but no test exercises it.)
- The Inspector renders, but I didn't observe rendering of node-specific custom `draw_buttons` callbacks because none of the built-in nodes implement them.
- No "Search node" command palette (Ctrl-F over node names) — Blender has one.

### 2.9 Build & CI

- `tsup` produces twin (`index`, `tsl`) entry points × twin (`ESM`, `CJS`) formats × twin (`.d.ts`, `.d.cts`) outputs. The TSL sub-entry isolates the `three/webgpu` import. ✅
- `vite build` for the demo works; chunk is large (2.3 MB) because R3F + three + ReactFlow + zustand + zod + the whole library bundle. Manual chunking could split this — non-blocking.
- CI: GitHub Actions on Node 20, runs `typecheck → test → build`. Clean.

### 2.10 Testing

134 tests in one giant smoke runner (`scripts/smoketest.ts`, 3157 LOC). Coverage by phase:

- Shader: principled, emission, mix shader, refraction/sheen/holdout/volume, fresnel, texture pass-through.
- TSL: input emitters, logic emitters, colour emitters, random emitter, missing-texture emitters, world/light outputs, image resolver.
- Geometry: cube, uv sphere, ico sphere, set position, capture attribute, bounding box, distribute (random + Poisson + Poisson on high-tri mesh), instance-on-points + realize, translate instances (LocalSpace), subdivision surface, curve→points (incl. tangent/normal/rotation outputs), resample/reverse (with Selection respect), accumulate field, field-on-domain (POINT↔FACE), attribute-domain-size, flip faces, convex hull, proximity (nearest surface, not vertex), fill/fillet/sample/subdivide curve.
- Compositor: image+blur, mix-rgb fused, invert/gamma/posterize/maprange/combine-separate/valtorgb/splitviewer; CPU path covers ColorBalance, Tonemap (Reinhard), ZCombine.
- Texture: ValToRGB w/ custom stops, image resolver.
- Bridge: round-trip for various trees including cycle detection and curve ops.
- Phase 1 (lifecycle): tree.dispose() removes from `_allTreeRefs`, releases depsgraph listeners, idempotent; refreshGroupNodes uses safe iterator.
- Phase 3 (incremental): geometry evaluator skips clean nodes on second eval, persistent cache full-use, full rebuild on topology change, shader evaluator fast-path, simulation cache survives frame ticks, dirty-set propagation skips unrelated upstream.
- Add-menu / build / operators.

**Test smell:** all 134 cases live in one giant file; there is no per-area split, no test runner with reports, no coverage tooling. The custom `test()` / `assert()` / `eq()` / `close()` micro-harness is fine but limits IDE integration.

---

## 3. Architectural soundness

### 3.1 Where the design is **right**

1. **Per-system evaluator + injected `setEvaluator()` boundary.** Trees stay pure data; evaluators are swappable. The TSL/legacy split for shaders proves the abstraction works.
2. **`Field<T>` as `(ctx, geometry, domain) → TypedArray`.** This is exactly how Blender's MFN system works conceptually, and the implementation supports `liftToField` (constant lifting), `mapField`, `zipField`, `interpolateAttribute` cross-domain.
3. **`flattenTree`/`flatTopoOrder` as the group-inlining + reroute-bypass primitive** shared by Compositor + Texture + headless tooling. Clean and reusable.
4. **`Depsgraph` owns scene clock + sim cache + microtask scheduling.** Aligns with RESEARCH §7 and ARCHITECTURE §8 exactly.
5. **Zone state-items lifted to the Input node, with the Output node mirroring them on demand.** Matches Blender's authoritative-on-Input model.
6. **`computeInternalLinks()` is type-aware** (same-kind preferred, then numeric-compatible), replacing the older "first geometry" heuristic. Test-backed.
7. **Weak global tree registry (`_allTreeRefs`)** for cross-tree group-refresh without leaking on test churn.
8. **Cycle handling is non-throwing.** `topoOrder()` annotates `cycleNodes` and the depsgraph reports them as an error. Matches Blender's "graph is checked at runtime" model.
9. **TSL sub-entry isolates `three/webgpu`** — packaging done right.

### 3.2 Where the design is **rough**

1. **`ShaderEvaluator` (legacy) has divergent behaviour from `TSLShaderEvaluator`.** Many nodes are placeholder constants in the legacy path; the TSL path has the real implementations. The README admits "approximate" but the tests don't pin this down for either path, and the demo's WebGL fallback is therefore objectively worse than the TSL output. **A consumer who picks the wrong evaluator gets a silently worse material.** A unified mid-layer (or auto-fallback that warns when a node is a placeholder) would help.
2. **The Depsgraph dirty-set is *tracked* but only partially exploited.** Shader and Geometry evaluators have a "fast path if dirty is empty" and a per-socket-id persistent cache; Compositor and Texture replan/recompute every call. The architecture promises "Phase 3: true incremental execution" — that's still WIP. Some nodes (curve operations, distribute-points) are still expensive enough that this matters.
3. **Schema versioning is bare.** `schema: "BNG/1"` is the only version anchor; if the BNG shape ever changes, there is no migration path. Need a `schema_version` integer + a `migrate()` chain.
4. **`History` snapshots are full JSON.** For a 200-node graph each push is non-trivial. Pure operator-level undo (record-and-replay editor ops) would be cheaper.
5. **`bridge/blender_exporter.py` is not exercised by CI** — that's a hard problem (would need Blender headless), but at minimum a known-good golden JSON fixture should round-trip through `importDocument → exportDocument` to detect schema drift.
6. **No worker / Comlink path** despite RESEARCH §9 saying "move heavy geometry eval off the main thread". The current evaluators are synchronous on the main thread.
7. **`docs/` is missing the PHASE0_AUDIT, ROADMAP, and zone-design docs referenced by `README.md`.** Three broken doc links.

### 3.3 Where the design diverges from Blender (worth knowing)

| Blender | This repo |
|---|---|
| Cycles + EEVEE use OSL / SVM / GLSL kernel libraries | TSL is the only output target (no OSL emitter; expected — JS world) |
| Field shapes are visual indicators | Replicates the 2025 "fixed shape" model — dashed link styling carries the meaning |
| `interface.new_socket(in_out=…, socket_type='NodeSocketFloat')` | Same call signature, returns a `NodeTreeInterfaceSocket` — identifier-stable |
| `bNode.update()` callback | Implemented as optional method; depsgraph drives invalidation, not the node itself |
| C-side multi-function evaluator over SIMD spans, implicit-sharing CoW | Plain JS `TypedArray` buffers, no CoW. Adequate for the workloads here, would blow up on 10⁶-point geometries |

These are all **intentional** simplifications; none of them break the porting story.

---

## 4. Concrete inconsistencies / bugs / paper-cuts found

The following are minor but worth fixing in implementation phases:

- **A.** `README.md` references `docs/PHASE0_AUDIT_2026-06-02.md` and `docs/ROADMAP.md` — both **do not exist**.
- **B.** `README.md` says "108 headless smoke tests pass". Actual: 134. **Stale stat.**
- **C.** `src/core/Properties.ts` exports Float/Int/Bool/String/Enum/Vector/Color but **omits `PointerProperty`**. It is only declared inside `bridge/bpy_shim.ts` as a one-liner. Inconsistent — port code that uses `PointerProperty` directly from the public package will fail.
- **D.** `ShaderEvaluator` (legacy) recognises only `ShaderNodeOutputMaterial` as the root, not `ShaderNodeOutputWorld` / `ShaderNodeOutputLight` / `ShaderNodeOutputAOV`. The TSL path handles them. The four "Output" classes register but only one of them is meaningful in the legacy path.
- **E.** `ShaderEvaluator` has dozens of `/* TSL APPROX */` comments — but it is the **legacy** evaluator. The comment label is misleading.
- **F.** `src/nodes/geometry/Ops.ts:510` block comment says `Fill/Fillet are still partial; Sample/Subdivide now have executable poly-curve implementations` — the test names say "FillCurve fills a planar closed curve" and "FilletCurve adds points around poly-curve corners". The implementation is in `eval/geometry/MeshOps.ts` (`fillCurve`, `filletCurve`) and is functionally exercised. The "partial" language is OK but worth a clearer status note.
- **G.** `Inspector` is a 566-LOC component; it is imported by the demo but I did not find a unit test verifying its property editors actually mutate node state. Smoke tests are evaluator-focused.
- **H.** The Compositor `unknownKernel` branch silently blits the input — a kernel node that isn't recognised should at minimum surface a warning to `errors`.
- **I.** `ShaderEvaluator.executeGroup` and `GeometryEvaluator`'s equivalent recurse with a `depth > 64` guard. Good. But there is **no per-evaluation recursion budget for ordinary nodes** — a pathological graph (e.g. 10 000 muted reroutes) is bounded only by the topo order length.
- **J.** `src/sockets/index.ts` exports `Rotation` and `Mat4` types but `Vec4` is never `coerceFrom`'d into `Rotation` from a 4-tuple correctly — `NodeSocketRotation.coerceFrom` looks for `'euler' in v` or array length≥3, which mis-handles a literal quaternion `[x,y,z,w]`.
- **K.** `src/core/Node.ts`'s property auto-installer uses `structuredClone(desc.default)`, which works in modern Node/browsers but will fail on environments that lack it (very old). Worth a note in the README's supported environment matrix.
- **L.** Multiple `package.json` "files" entry includes both `dist` and `src` — `src` shipping is unusual for TS libs (often increases install size). Probably intentional for source maps; could be clarified in README.

None of these are blockers; they are the work surface for Phase 2.

---

## 5. Recommended implementation priority for Phase 2+

Ordered by "delivers most value per LOC", referencing the gap labels above:

### 5.A Hygiene & truth alignment (≤ 1 day)
1. Restore (or remove the references to) `docs/PHASE0_AUDIT_2026-06-02.md` and `docs/ROADMAP.md`. **(A)**
2. Update the README's test count from 108 → 134, regenerate the node-count table to reflect current registrations. **(B)**
3. Move `PointerProperty` into `src/core/Properties.ts` and re-export. **(C)**
4. Re-label `TSL APPROX` comments in `ShaderEvaluator` to `LEGACY PATH PLACEHOLDER` (matches reality). **(E)**
5. Add an explicit warning to `errors` in the unknown-kernel compositor branch. **(H)**
6. Tighten `NodeSocketRotation.coerceFrom` to detect 4-element quaternion arrays. **(J)**

### 5.B Test-coverage & correctness shoring (1–2 days)
1. Split `scripts/smoketest.ts` into per-area files. Add vitest (or keep tsx) but emit a coverage report.
2. Add a fixture-based round-trip test that exercises every shipped node category through `importDocument → exportDocument → importDocument` and compares evaluator output.
3. Add a per-node golden image test for the compositor (compare CPU evaluator output against a reference 32×32 PNG).
4. Add a non-throwing assertion that the legacy `ShaderEvaluator` and `TSLShaderEvaluator` emit *the same `colorNode` channels* for a small set of canonical materials (Principled + Emission + Mix).

### 5.C Filling the "obvious missing" node packs (3–5 days each)
1. **Mesh topology + read** nodes (Spline Length, Edge/Face/Corner topology). Required for any real Geometry Nodes addon.
2. **Curves read/write** (Set Curve Radius/Tilt/Cyclic/Type/Resolution/HandleType/Normal; Spline Length / Curve Parameter / Endpoint Selection).
3. **Compositor matte/keying** node category (start with Luminance Key / Chroma Key — these are tractable on GPU).
4. **Shader Curves (RGB Curves / Vector Curves / Float Curve)** — straightforward in both legacy + TSL paths.
5. **Geometry Input → Scene** nodes (Scene Time, Self Object, Object Info, Active Camera) — these are the cheap ones; Volume / VDB is out of scope.

### 5.D Architectural depth (1–2 weeks each)
1. **True incremental Depsgraph propagation.** Compute a dirty *closure* over `from_socket → to_socket` and let evaluators consume `dirty.has(node)` for skip decisions. Add metrics: "n nodes re-evaluated this tick".
2. **Worker offload** of the GeometryEvaluator via Comlink, with a fallback main-thread mode for SSR.
3. **BNG schema versioning**: add `schema_version: 2`, write a `migrate()` chain. Validate that v1 still imports.
4. **Operator-level history** (record edits, not snapshots) for the `History` class.

### 5.E Stretch — Blender parity walls
1. **Volume / VDB** geometry pack — requires a JS VDB lib or a stub backed by `THREE.Texture3D`.
2. **OSL parser → TSL emitter** for Shader code blocks.
3. **WebGPU compositor backend** (currently WebGL only).

---

## 6. Bottom-line assessment

`blender-nodes-r3f` is an **unusually well-scoped subset port** of Blender's node system to TypeScript/three.js. The repo's *intent statements* in `RESEARCH.md` and `ARCHITECTURE.md` are taken seriously by the implementation:

- The runtime API mirrors `bpy.types.*` close enough that a Python addon transliterates to TS by structural translation (the `falloff_addon` example proves this).
- All four evaluators run and pass behavioural tests, including the hardest pieces (zones, groups, fields, fused compositor passes).
- Build, typecheck, library packaging, CI are all healthy.

The gap between **what's shipped** and **what RESEARCH.md aspires to** is squarely in the **breadth of built-in nodes** (especially Geometry's Volume/Topology/UV families and Compositor's matte/filter families) and in **a few well-flagged "future work" pieces** (true incremental eval, worker offload, OSL). None of those are foundational; they are additive.

The biggest **risk** I'd flag is the silent quality gap between the legacy and TSL shader evaluators — that's the one place where the "subset" framing can bite an unsuspecting consumer.

The rest is solid. Pick a target node pack from §5.C, ride the established patterns, and the codebase will scale up to a full Blender mirror over time.

---

*End of Phase 1 audit. Phase 2 (implementation) is gated on user direction — see follow-up question.*
