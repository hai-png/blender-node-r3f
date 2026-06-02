# Gap analysis and implementation progress — `blender-node-r3f`

Date: 2026-06-02  
Repo: <https://github.com/hai-png/blender-node-r3f>

## Implementation progress since the Phase 0 baseline

The Phase 0 baseline below is preserved for traceability. Since that baseline, the following gaps have been addressed:

- BNG bridge now round-trips output socket defaults, interface panel parent hierarchy, and dynamic zone `state_items`.
- Blender exporter now emits stable tree ids and group node references by id; importer still accepts legacy name references as a fallback.
- Declarative `bpy.props`-style node properties now emit `property_changed` and invalidate their depsgraph on direct assignment.
- Zone escape flags are recomputed after topology edits.
- Texture procedural nodes now respect coordinate inputs/defaults.
- Compositor GPU path now materialises constant results to image targets when required, avoids null samplers for kernels, and aligns Gamma/Brightness-Contrast GLSL with the CPU conventions.
- Compositor planner now uses socket-specific output mappings and aliases fused multi-output pixel-node channels for downstream scalar consumers.
- Compositor Color Ramp now supports custom stops/interpolation in CPU and GLSL paths.
- Split Viewer now has CPU constant-frame behavior and GPU composition support.
- Pixel fusion now conservatively breaks at branch points to avoid collapsing sibling branches into a single linear output.
- Legacy shader descriptor evaluator now covers additional registered BSDF/volume closures (Refraction, Sheen, Toon, Subsurface, Holdout, Volume Absorption/Scatter) with documented PBR approximations.
- TSL shader evaluator now handles Mapping rotation, Vector Rotate, Displacement, Vector Displacement, and additional BSDF/volume closure approximations.
- Foreach Element zones now respect the Selection input for iteration filtering.
- Geometry Convex Hull node/evaluator support has been added with a naive robust boundary-triangle implementation for modest meshes/point clouds.
- Smoke tests increased from 53 to 67 and currently pass.

---

# Phase 0 critical analysis — `blender-node-r3f`

Date: 2026-06-02  
Repo: <https://github.com/hai-png/blender-node-r3f>  
Audit mode: clone, read source/docs, run existing checks, compare implementation against documented research/architecture/roadmap intent.  
Implementation changes intentionally deferred; this document is the phase-0 baseline for phased remediation.

## 1. Executive summary

The project is a credible and unusually broad prototype of a Blender-like node runtime for Three.js/R3F. It has a coherent core model (`Node`, `NodeSocket`, `NodeTree`, `NodeLink`, `NodeTreeInterface`), a registry/shim layer, four tree kinds, real geometry evaluation for the declared geometry subset, a compositor WebGL pipeline skeleton with pixel fusion, a texture sampler graph, and headless smoke tests.

However, the README/roadmap currently overstate completion. The project passes its own smoke tests and type/build checks, but several documented promises are only partially implemented or implemented through simplifying shims. The highest-risk gaps are:

1. **Bridge round-trip is not faithful enough for real `.blend` node groups**: output socket defaults are not imported/exported correctly by the TS round-trip path; Blender group references are exported by name while the TS importer expects tree ids; interface panel hierarchy is not reconstructed.
2. **Shader coverage is substantially incomplete versus the registered shader node list**: many registered shader/input/texture/vector nodes fall back to defaults in both the legacy evaluator and/or TSL evaluator. `ShaderNodeMapping` explicitly skips rotation.
3. **Compositor implementation needs semantic hardening**: constant outputs are not materialised to GPU images at output/kernel boundaries, CPU and GLSL disagree for Gamma/Brightness-Contrast, multi-output pixel nodes are not properly represented in the planner, Split Viewer is declared but not implemented as a split, ColorRamp is black→white only, and the headless path returns a constant RGBA rather than the documented small CPU image.
4. **Core reactivity and validation are incomplete**: property `update` callbacks are declared but not wired as setters; dirty sets are passed but evaluators largely do full evaluations; cycles are silently tolerated; zone-escape flags can become stale after later topology edits.
5. **Texture evaluator ignores coordinate inputs for most procedural nodes** and uses a UV-gradient placeholder for image textures; ColorRamp is black→white only.
6. **Docs are internally inconsistent**: README links to a missing `docs/GAP_ANALYSIS.md`; README says `~169` nodes while runtime registration reports 168; `docs/M2_M3_FIELDS.md` lists Convex Hull as an M3 deliverable but no Convex Hull node is present; `docs/ROADMAP.md` still lists UI chrome TODOs.

Bottom line: **M0 foundations, M2/M3 geometry subset, M4 zones subset, M6 texture subset, M7 shim/example, and M8 headless operators exist and are test-backed. M1/M5 and the bridge need deeper semantic work before the project can honestly claim “fully achieved as in the research and architecture.”**

## 2. Commands run and verification results

```bash
git clone https://github.com/hai-png/blender-node-r3f.git
cd blender-node-r3f
npm install
npm test
npm run build
```

Observed results:

- `npm install`: succeeds.
  - Warning: deprecated `three-mesh-bvh@0.7.8` via dependencies.
  - `npm audit`: 2 moderate vulnerabilities reported by npm after install.
- `npm test`: succeeds.
  - `53 passed, 0 failed`.
- `npm run build`: succeeds.
  - `tsc -p . --noEmit` passes.
  - `vite build` passes.
  - Warning: demo bundle is large (`index-*.js` about 2.3 MB, 636 KB gzip).
- Runtime registration count using `bootstrapBuiltins()`:
  - Total registered node classes: **168**.
  - Per tree availability count, including common nodes reused across trees:
    - `ShaderNodeTree`: 67
    - `GeometryNodeTree`: 85
    - `CompositorNodeTree`: 54
    - `TextureNodeTree`: 34

## 3. Documented intent, reconstructed from docs

### 3.1 Research intent

`docs/RESEARCH.md` frames the project as a Blender-compatible node system with:

- Blender-like core types: `NodeTree`, `Node`, `NodeSocket`, `NodeLink`, `NodeTreeInterface`.
- Four evaluation models:
  - Shader trees → GPU shader codegen.
  - Geometry trees → field/multi-function style evaluator.
  - Compositor trees → image-buffer DAG.
  - Texture trees → per-sample callbacks.
- Common nodes, shader nodes, geometry nodes, compositor nodes, texture nodes.
- Group nodes and modern interface sockets.
- Special Geometry Nodes zones: Simulation, Repeat, Foreach.
- Dependency graph, drivers/animation concepts, and `.blend` import via a wire format.

### 3.2 Architecture intent

`docs/ARCHITECTURE.md` maps those Blender concepts into TypeScript modules and explicitly expects:

- Registry-driven node/socket/tree registration.
- Core runtime compatibility with `bpy.types.*` and `bpy.props.*`.
- Per-system evaluators.
- A bridge (`blender_exporter.py`, importer/exporter, `bpy_shim.ts`).
- A UI/editor stack built on React Flow/Zustand/R3F.

### 3.3 Roadmap intent

`docs/ROADMAP.md` marks M1–M8 as shipped, but still acknowledges:

- UI chrome is partial: copy/paste, marquee select, search palette, minimap/overview, keyboard shortcuts, drag-to-group are still TODO.
- Some texture and compositor image behavior is placeholder/headless-safe.

## 4. Milestone implementation matrix

| Milestone | Documented intent | Current implementation status | Critical notes |
|---|---|---|---|
| M0 Foundations | Core node graph, sockets, registry, properties, depsgraph, bridge shim skeleton | **Mostly implemented** | Core exists and is coherent. Property update callbacks are not wired through accessors; cycles are not reported; dirty evaluation is not genuinely incremental. |
| M1 Common + Shader | Common nodes and shader evaluator/TSL | **Partially implemented** | Many common nodes work. Shader node declarations are broad, but legacy and TSL evaluators cover only a subset. Several registered shader nodes silently emit defaults. |
| M2 Geometry foundations | Mesh primitives, field basics, set/transform/join/bounding etc. | **Implemented for declared subset** | Tests cover meaningful geometry paths. Convex Hull appears in M2/M3 doc but no node exists. |
| M3 Geometry advanced | instances, curves, sampling/proximity, fields | **Mostly implemented for project subset** | Strong coverage compared with other systems. Some algorithms are approximations, which is acceptable if documented. |
| M4 Zones | Simulation, Repeat, Foreach, state items, zone escape rule | **Implemented as functional subset** | Repeat/simulation tests pass. Foreach selection input is declared but not used; aggregation/domain semantics are simplified. Existing zone-escape flags can become stale after topology changes. |
| M5 Compositor | WebGL render-target pipeline, pixel fusion, kernels, headless CPU evaluator | **Pipeline exists but semantic gaps remain** | Planner/fusion exists. CPU path is constant-only; GPU/CPU mismatch exists; multi-output and constant materialization gaps; Split Viewer declared but not functionally implemented. |
| M6 Texture | legacy texture sampler graph, bake to `DataTexture` | **Implemented as sampler subset** | Procedurals work for simple UV inputs; most nodes ignore coordinate input sockets; image node is placeholder. |
| M7 Bridge/addon compatibility | BNG schema, Blender exporter, TS importer/exporter, `bpy` shim, addon example | **Partially implemented** | Shim and example work. Real `.blend` group references/defaults/panel hierarchy need fixes. |
| M8 Polish | editor operators, UI polish | **Operators implemented; UI chrome partial** | `History`, `makeGroup`, `ungroup`, `autoLayout` are tested. UI TODOs remain. |

## 5. System-by-system findings

### 5.1 Core graph/runtime

Relevant files:

- `src/core/Node.ts`
- `src/core/NodeSocket.ts`
- `src/core/NodeLink.ts`
- `src/core/NodeTree.ts`
- `src/core/NodeTreeInterface.ts`
- `src/core/Properties.ts`
- `src/core/trees.ts`
- `src/core/types.ts`
- `src/registry/NodeRegistry.ts`
- `src/sockets/index.ts`
- `src/eval/Depsgraph.ts`

What is implemented well:

- Blender-like class surface is present.
- `Node.computeInternalLinks()` gives a consistent mute pass-through rule.
- `NodeLink.is_valid` handles same-kind, numeric coercions, shader/geometry strictness, and virtual/reroute sockets.
- `NodeTree.addNode`, `addLink`, `removeNode`, `removeLink`, `topoOrder`, `refreshGroupNodes`, and `addZone` provide a usable graph API.
- Registry and category APIs mirror the Blender addon flow well enough for transliteration.
- Socket type coverage is broad.

Gaps / risks:

1. **Property update callbacks are inert.** `Properties.ts` declares `update?: (node) => void`, and `Node` installs defaults, but no accessor/setter calls `update` or invalidates the depsgraph when a property field changes. This weakens the Blender-style property model and interface reactivity claims.
2. **Dirty-set evaluation is mostly nominal.** `Depsgraph` computes dirty sets, but evaluators generally traverse full topo order. This is correct but not incremental as described.
3. **Cycles are silently swallowed.** `NodeTree.topoOrder()` comments that Blender forbids cycles, but if a cycle exists it returns a partial order without recording an error. `flatTopoOrder()` appends cyclic leftovers. This can hide invalid graphs.
4. **Zone-escape marking can go stale.** `link.escapes_zone` is computed on `addLink()`. If later links/nodes change zone reachability, existing flags are not recomputed globally.
5. **`NodeTreeInterface` hierarchy is limited.** Panels exist and store children, but bridge import/export does not fully restore parent relationships.
6. **Packaging is not production-ready.** `package.json` has `main: "src/index.ts"` and no `exports`/library build. This is acceptable for a Vite/TS source demo, but not for a published npm library consumed by plain Node/bundlers without TS handling.

### 5.2 Common nodes

Relevant files:

- `src/nodes/common/*.ts`

What is implemented:

- Value/RGB/Vector, Math, Vector Math, Mix, Map Range, Clamp, ColorRamp, Combine/Separate XYZ/Color, Boolean Math, Compare, Switch, Random Value, Frame, Reroute, Group I/O/container nodes.
- Common nodes register across multiple tree kinds.
- Smoke tests cover common Math, Mix, ColorRamp, CombineXYZ, group/mute/reroute behavior.

Gaps / risks:

- The evaluator support differs by system. A common node can be registered for a tree but still be a default/no-op in a particular evaluator if not explicitly handled.
- Reroute uses a virtual socket shim, which is acceptable, but it is a compatibility shim rather than a full Blender reroute type model.

### 5.3 Shader system

Relevant files:

- `src/nodes/shader/*.ts`
- `src/eval/ShaderEvaluator.ts`
- `src/eval/tsl/TSLShaderEvaluator.ts`
- `src/tsl.ts`

What is implemented:

- Many shader nodes are declared and registered.
- Legacy `ShaderEvaluator` produces a simple material descriptor and is test-backed for Principled BSDF, Emission, Mix Shader, and common-value inputs.
- TSL evaluator exists in a separate sub-entry to avoid Node/SSR import issues and registers emitters for a useful subset.
- Group evaluation exists in both shader evaluators.

Critical gaps:

1. **Registered shader coverage exceeds evaluator coverage.** Examples of registered shader nodes that are absent or default-fallback in TSL include Refraction, Translucent, Sheen, Toon, Subsurface, Holdout, Volume Absorption/Scatter, Output World/Light, Image/Environment/Voronoi/Wave/Brick/Magic textures, Attribute/Layer Weight/Object Info/Camera Data/Light Path, Vector Rotate, Vector Displacement, Displacement, Combine/Separate Color. Some are also absent in the legacy evaluator.
2. **`ShaderNodeMapping` skips rotation.** The TSL evaluator comment states rotation is skipped in the M1 minimal implementation.
3. **Closure semantics are approximate.** Several BSDFs are mapped to `MeshStandardNodeMaterial`-style descriptors rather than Blender-equivalent closures. This is pragmatic but should not be documented as full Blender shader parity.
4. **Texture/image shader nodes are not fully backed by real texture resources.** For shader fidelity, image/environment texture resolving needs a resource API parallel to compositor `resolveTexture`.

### 5.4 Geometry system

Relevant files:

- `src/nodes/geometry/*.ts`
- `src/eval/GeometryEvaluator.ts`
- `src/eval/geometry/*.ts`

What is implemented well:

- Geometry has the best implementation depth in the repository.
- Declared primitives and many ops are explicitly handled in `GeometryEvaluator`.
- Field pipeline exists with `Field<T>`, constants, position/normal/index/id/radius/named attributes, anonymous attributes, mapping/zipping/lifting, and field utilities.
- Mesh ops cover cube/sphere/cylinder/cone/grid/lines/circles, transform/join, merge by distance, subdivision, triangulation, distribute points, instances, curves, sampling/proximity, flip faces.
- Ported addon hook (`executeGeo(ctx)`) is wired and tested.

Gaps / risks:

1. **Convex Hull is documented but absent.** `docs/M2_M3_FIELDS.md` lists Convex Hull as an M3 data-flow op, but no node/evaluator implementation exists.
2. **Some algorithms are approximations.** This is acceptable for a web runtime but needs explicit documentation by node.
3. **Field domain fidelity is simplified in places.** Some conversions/domains are approximated, especially non-point domains.
4. **Test coverage is broad but still smoke-level.** Tests assert counts and representative behavior, not Blender fixture parity.

### 5.5 Zone system

Relevant files:

- `src/nodes/geometry/Zones.ts`
- `src/eval/zones/*.ts`
- `src/core/NodeTree.ts` zone helpers

What is implemented:

- Paired zone input/output classes exist for Simulation, Repeat, Foreach.
- `NodeTree.addZone()` creates pairs and default geometry state links.
- Simulation caches live in `Depsgraph.simCache` and persist across evaluations.
- Repeat and Simulation have meaningful tests.
- Zone-escape links are flagged and skipped by topo order/evaluators.

Gaps / risks:

1. **Foreach selection socket is not used.** The node declares `Selection`, but `runForeachZone()` iterates all elements of the selected domain.
2. **Foreach slicing is simplified.** Geometry state items pass the full geometry into each iteration rather than an actual isolated element. Aggregation joins geometry outputs and keeps last scalar/vector value.
3. **Zone pairing/state-item serialization is not handled in BNG schema.** The bridge does not preserve zone-specific `state_items` explicitly.
4. **Escape-link state can become stale** after topology edits as noted in core findings.

### 5.6 Compositor system

Relevant files:

- `src/nodes/compositor/Compositor.ts`
- `src/eval/CompositorEvaluator.ts`
- `src/eval/compositor/*.ts`

What is implemented:

- Declares a practical M5 compositor node subset.
- Has a WebGL render-target pipeline with `TexturePool`, `FullScreenQuad`, kernel shaders, and fused pixel GLSL generation.
- Planner can fuse simple pixel-wise chains and break on kernels; smoke tests verify this structurally.
- Headless `cpuComposite()` verifies constant pixel math for selected nodes.

Critical gaps:

1. **Headless path is not the documented CPU image emulator.** Docs claim a small image/`Uint8ClampedArray` mock renderer; implementation returns `texture: null` plus a constant `cpuColor` for constant subtrees.
2. **Direct constants are not materialised to images.** In browser/GPU mode, `RGB → Composite` or `Value/Color → kernel/output` can produce no final texture because `OUTPUT` only captures `IMAGE` results, and kernels receive `null` sampler uniforms for non-image inputs.
3. **CPU and GLSL disagree.** `CompositorNodeGamma` CPU uses `pow(c, gamma)` while GLSL uses `pow(c, 1/gamma)`. Brightness/Contrast scaling also differs between CPU and GLSL.
4. **Multi-output pixel nodes are not properly planned.** The planner maps a node id to one `(opId, outId)` and fused ops produce one output. Nodes such as Separate Color, Z Combine, ColorRamp Alpha, RGBToBW scalar outputs need socket-specific output tracking.
5. **Split Viewer is declared but not functionally split.** `evaluate()` only special-cases `Composite` and `Viewer`, not `SplitViewer` logic.
6. **Color Ramp is only black→white.** No stops/interpolation equivalent to common `ColorRampNode`.
7. **Kernel options are partial.** Blur ignores `size_y`/filter mode semantics; Glare exposes more types than implemented; Crop/Scale/Rotate are simplified.
8. **No GPU pixel-read tests.** Existing tests validate planner structure and CPU constants, not rendered pixel equivalence.

### 5.7 Texture system

Relevant files:

- `src/nodes/texture/Texture.ts`
- `src/eval/TextureEvaluator.ts`

What is implemented:

- Legacy `TextureNodeTree` exists.
- Noise, Checker, Voronoi, Wave, Magic, Blend, Image placeholder, Math, MixRGB, ColorRamp placeholder, Coordinates, Output are declared/evaluated.
- `bakeToDataTexture()` produces a Three `DataTexture`.

Gaps / risks:

1. **Coordinate inputs are mostly ignored.** Procedural nodes sample the function arguments `(u, v)` directly rather than linked `Coords` sockets. Checker reads colors/scale but not `Coords`.
2. **Image node is a UV-gradient placeholder.** No real image decode/resource resolver exists.
3. **ColorRamp is black→white only.** No configurable stops/interpolation.
4. **Math/Mix coverage is intentionally narrow.** Only selected ops/blend modes are implemented.

### 5.8 Bridge and addon compatibility

Relevant files:

- `src/bridge/schema.ts`
- `src/bridge/importer.ts`
- `src/bridge/exporter.ts`
- `src/bridge/bpy_shim.ts`
- `src/bridge/blender_exporter.py`
- `examples/falloff_addon.ts`

What is implemented:

- BNG/1 schema exists with Zod validation.
- TS importer/exporter round-trip topology/properties in smoke tests.
- Blender exporter can serialize node groups from Blender.
- `bpy` and `nodeitems_utils` shim supports mechanical addon translation.
- The falloff addon demonstrates registering a custom geometry node and `executeGeo(ctx)`.

Critical gaps:

1. **TS exporter omits output default values; importer ignores output defaults.** This breaks nodes whose user-editable value lives on output sockets (`RGB`, `Value`, several Blender input nodes). The schema supports socket defaults, but the implementation does not use outputs correctly.
2. **Blender exporter writes group references by `n.node_tree.name`; importer expects tree id.** `_serialize_tree()` assigns random ids to trees, so real group node references will not resolve unless name coincidentally equals id.
3. **Interface panel hierarchy is serialized but not reconstructed.** Importer does not restore `parent` relationships for sockets/panels.
4. **Zone state items are not serialized.** Dynamically added zone items would be lost or reconstructed only from node class defaults.
5. **External datablock references are serialized as ad hoc objects** and not resolved on import.
6. **Unknown nodes are skipped.** This is resilient, but it can break topology. A placeholder unknown node type may be needed for faithful visual import.

### 5.9 UI/editor/operators/demo

Relevant files:

- `src/ui/*.tsx`, `src/ui/*.ts`
- `demo/*.tsx`, `demo/index.html`, `vite.config.ts`
- `scripts/smoketest.ts`

What is implemented:

- React Flow editor exists with node rendering, handles, add menu, store, and simple operator hooks.
- R3F viewport and TSL viewport demos exist.
- Headless operators `History`, `makeGroup`, `ungroup`, `autoLayout` are tested.
- Demo trees exercise shader, geometry, compositor, texture, zones.

Gaps / risks:

- Roadmap-acknowledged UI TODOs remain: copy/paste, marquee select, search palette, minimap/overview, keyboard shortcuts, drag-to-group.
- Demo compositor uses a placeholder image path and headless placeholder behavior.
- Build output is demo-oriented, not a library package.

## 6. Documentation inconsistencies to fix

1. `README.md` links to `docs/GAP_ANALYSIS.md`, but that file is absent.
2. `README.md` says “M0–M8 implemented” and “full M5 spec”; current audit shows important partials.
3. `README.md` section title “What ships through M1” contains M1–M8 content.
4. Runtime registered node count is 168, while README says `~169`.
5. `docs/M2_M3_FIELDS.md` lists Convex Hull as M3 deliverable; not implemented.
6. `docs/M5_COMPOSITOR.md` headless CPU image-emulator description does not match implementation.
7. `docs/ROADMAP.md` marks M8 polish as shipped but still lists UI chrome TODOs; this should be explicitly “operators shipped; UI polish open.”

## 7. Recommended phased remediation plan

### Phase 1 — Truthful baseline, tests, and docs

- Add/rename this audit into `docs/GAP_ANALYSIS.md` or link README to this file.
- Adjust README/ROADMAP claims from “fully implemented” to “implemented subset” where appropriate.
- Add a node coverage table generated from registry + evaluator emitter support.
- Add tests that intentionally fail for the known critical gaps before fixing them:
  - RGB/Value output defaults survive BNG export/import.
  - Blender-style group reference id/name fixture resolves correctly.
  - Compositor CPU vs GLSL formulas are aligned at expression level.
  - SplitViewer is recognized.
  - Texture coordinate links affect output.

### Phase 2 — Bridge fidelity

- Export and import output socket defaults.
- Fix Blender exporter to use stable tree ids and group node references by id.
- Restore interface panel parent hierarchy.
- Serialize/deserialize zone `state_items`.
- Add unknown-node placeholder preservation mode.
- Add fixtures representing real Blender node groups.

### Phase 3 — Core correctness/reactivity

- Implement property accessors or a `setProperty()` API that invokes `update` callbacks and invalidates depsgraph.
- Recompute zone escape flags after topology edits.
- Report cycles as graph errors.
- Decide whether dirty evaluation is a real goal; either implement incremental evaluation or document full-eval behavior.
- Improve multi-output link identity utilities for planners.

### Phase 4 — Shader fidelity

- Generate an evaluator coverage matrix for all registered shader nodes.
- Implement missing TSL emitters or mark nodes as declared-only.
- Implement Mapping rotation.
- Add texture resource resolution for shader Image/Environment nodes.
- Add tests for every shader node category.

### Phase 5 — Compositor completion

- Materialise constants to 1×1 or full-size render targets where image inputs are required.
- Fix CPU/GLSL parity for Gamma and Brightness/Contrast.
- Redesign planner output mapping to be socket-specific, not node-specific.
- Implement Split Viewer output behavior.
- Implement real ColorRamp stops/interpolation.
- Decide whether headless path should produce a real CPU image buffer/DataTexture-like object; update docs/tests accordingly.
- Add browser/WebGL pixel tests if feasible.

### Phase 6 — Texture completion

- Make all procedural nodes respect linked Coordinates input.
- Add an image-resource resolver and/or async decode path.
- Implement configurable ColorRamp.
- Expand Math/Mix modes or document supported subset.

### Phase 7 — Geometry/zones polish

- Either implement Convex Hull or remove it from M2/M3 deliverables.
- Implement Foreach selection filtering.
- Improve per-element geometry slicing and aggregation semantics.
- Document approximation level per mesh/curve operation.

### Phase 8 — UI/package hardening

- Finish roadmap UI chrome or clearly mark it out of scope.
- Add library build output, `exports`, declarations, and package entry-point strategy.
- Address npm audit findings where possible.
- Add CI scripts for typecheck/test/build/audit.

## 8. File-by-file inventory and role notes

| File | Lines | Role / audit note |
|---|---:|---|
| `.gitignore` | 2 | Ignore rules; minimal. |
| `LICENSE` | 21 | MIT license. |
| `README.md` | 136 | Project overview; overstates completion; links missing `docs/GAP_ANALYSIS.md`. |
| `package.json` | 34 | Scripts/dependencies; source TS `main`, no library exports. |
| `package-lock.json` | 3339 | Dependency lock; install succeeds, npm reports 2 moderate vulnerabilities. |
| `tsconfig.json` | 28 | Strict TypeScript config; typecheck passes. |
| `vite.config.ts` | 20 | Demo build config; build emits large bundle warning. |
| `docs/ARCHITECTURE.md` | 386 | Architecture mapping; broadly matches module layout. |
| `docs/RESEARCH.md` | 342 | Research/intended Blender model; aspirational vs implemented subset. |
| `docs/ROADMAP.md` | 121 | Milestone plan; still has UI TODO; some shipped claims need qualification. |
| `docs/M2_M3_FIELDS.md` | 132 | Geometry field design; lists Convex Hull not implemented. |
| `docs/M4_ZONES.md` | 194 | Zone design; implementation exists with simplified Foreach semantics. |
| `docs/M5_COMPOSITOR.md` | 160 | Compositor design; headless CPU image description does not match implementation. |
| `src/index.ts` | 87 | Public API and `bootstrapBuiltins`; good central export, TSL isolated. |
| `src/tsl.ts` | 11 | TSL sub-entry; appropriate browser/WebGPU isolation. |
| `src/core/types.ts` | 71 | Shared types. |
| `src/core/Properties.ts` | 205 | Property descriptors; update callbacks declared but not invoked by setters. |
| `src/core/NodeSocket.ts` | 102 | Base socket model. |
| `src/core/Node.ts` | 162 | Base node model; installs property defaults and mute routing. |
| `src/core/NodeLink.ts` | 45 | Link model/validation/zone escape flag. |
| `src/core/NodeTreeInterface.ts` | 120 | Interface sockets/panels; hierarchy needs bridge restoration. |
| `src/core/NodeTree.ts` | 328 | Main graph API, topo sort, zones, refresh; cycle/escape recompute gaps. |
| `src/core/trees.ts` | 33 | Four tree classes. |
| `src/registry/NodeRegistry.ts` | 127 | Node/socket/tree registry and categories. |
| `src/sockets/index.ts` | 316 | Built-in socket classes; broad coverage. |
| `src/nodes/common/Value.ts` | 63 | Value/RGB/Vector nodes. |
| `src/nodes/common/Math.ts` | 137 | Math node. |
| `src/nodes/common/VectorMath.ts` | 135 | Vector Math node. |
| `src/nodes/common/MixColor.ts` | 152 | Mix node for float/vector/color. |
| `src/nodes/common/MapRange.ts` | 77 | Map Range. |
| `src/nodes/common/Clamp.ts` | 40 | Clamp. |
| `src/nodes/common/ColorRamp.ts` | 77 | Configurable common ColorRamp. |
| `src/nodes/common/CombineSeparate.ts` | 80 | Combine/separate XYZ/color. |
| `src/nodes/common/Logic.ts` | 164 | Boolean/Compare/Switch/Random. |
| `src/nodes/common/Frame.ts` | 58 | Frame and virtual-socket reroute shim. |
| `src/nodes/common/Group.ts` | 171 | Group input/output/container nodes. |
| `src/nodes/common/index.ts` | 37 | Common registration exports. |
| `src/nodes/shader/Shaders.ts` | 154 | Shader output, Principled, Emission, TexCoord, Noise, Mix, world/light outputs. |
| `src/nodes/shader/BSDFs.ts` | 196 | Many BSDF/volume declarations; evaluator coverage partial. |
| `src/nodes/shader/Textures.ts` | 208 | Shader texture declarations; several not emitted by TSL/legacy. |
| `src/nodes/shader/Inputs.ts` | 126 | Shader input declarations; several not emitted. |
| `src/nodes/shader/VectorOps.ts` | 129 | Shader vector ops; mapping rotation skipped, several outputs approximate/default. |
| `src/nodes/shader/index.ts` | 23 | Shader node registration. |
| `src/nodes/geometry/Primitives.ts` | 201 | Geometry primitive declarations. |
| `src/nodes/geometry/FieldInputs.ts` | 106 | Field input declarations. |
| `src/nodes/geometry/FieldUtils.ts` | 100 | Field utility declarations. |
| `src/nodes/geometry/Ops.ts` | 550 | Geometry operation declarations. |
| `src/nodes/geometry/Zones.ts` | 298 | Zone node declarations. |
| `src/nodes/geometry/index.ts` | 20 | Geometry registration. |
| `src/nodes/compositor/Compositor.ts` | 598 | Compositor declarations; SplitViewer/ColorRamp semantics partial. |
| `src/nodes/compositor/index.ts` | 2 | Compositor exports. |
| `src/nodes/texture/Texture.ts` | 196 | Texture declarations. |
| `src/nodes/texture/index.ts` | 2 | Texture exports. |
| `src/eval/Depsgraph.ts` | 121 | Dirty scheduling, scene time, simulation cache. |
| `src/eval/ShaderEvaluator.ts` | 386 | Legacy descriptor shader evaluator; subset only. |
| `src/eval/tsl/TSLShaderEvaluator.ts` | 677 | TSL evaluator; useful subset, missing many registered nodes. |
| `src/eval/GeometryEvaluator.ts` | 1185 | Main geometry evaluator; strongest subsystem. |
| `src/eval/TextureEvaluator.ts` | 236 | Texture sampler evaluator; ignores most coordinate inputs. |
| `src/eval/CompositorEvaluator.ts` | 30 | Public compositor re-export and legacy plan types. |
| `src/eval/flatten.ts` | 164 | Group/reroute flattening utility. |
| `src/eval/geometry/Field.ts` | 403 | Field runtime; domain approximation in places. |
| `src/eval/geometry/Geometry.ts` | 674 | Geometry container and primitive builders. |
| `src/eval/geometry/MeshOps.ts` | 973 | Geometry operations; approximation level should be documented. |
| `src/eval/zones/types.ts` | 84 | Zone types/cache/time. |
| `src/eval/zones/ZoneRunner.ts` | 429 | Zone evaluator; Foreach simplifications. |
| `src/eval/compositor/types.ts` | 108 | Compositor result types. |
| `src/eval/compositor/TexturePool.ts` | 89 | WebGL render-target pooling. |
| `src/eval/compositor/Quad.ts` | 42 | Fullscreen quad helper. |
| `src/eval/compositor/KernelShaders.ts` | 243 | Kernel shader programs. |
| `src/eval/compositor/PixelGLSL.ts` | 263 | Pixel GLSL emitters; CPU/GPU parity issues. |
| `src/eval/compositor/CpuComposite.ts` | 228 | Constant-only CPU compositor. |
| `src/eval/compositor/CompositorEvaluator.ts` | 780 | Main WebGL compositor; planner/output gaps. |
| `src/bridge/schema.ts` | 81 | BNG schema. |
| `src/bridge/importer.ts` | 99 | BNG importer; ignores output defaults/panel parents. |
| `src/bridge/exporter.ts` | 90 | Runtime BNG exporter; omits output defaults. |
| `src/bridge/bpy_shim.ts` | 126 | `bpy`/`nodeitems_utils` shim; works for example. |
| `src/bridge/blender_exporter.py` | 221 | Blender exporter; group references by name/id mismatch. |
| `src/ui/store.ts` | 39 | Zustand store. |
| `src/ui/operators.ts` | 254 | Headless editor operators; tested. |
| `src/ui/AddMenu.tsx` | 72 | Add menu UI. |
| `src/ui/BlenderNode.tsx` | 289 | Node UI rendering. |
| `src/ui/NodeEditor.tsx` | 129 | React Flow editor shell. |
| `demo/index.html` | 13 | Demo HTML. |
| `demo/main.tsx` | 10 | Demo entry. |
| `demo/App.tsx` | 389 | Demo tree setup and app UI. |
| `demo/Viewport.tsx` | 255 | WebGL/R3F viewport. |
| `demo/TSLViewport.tsx` | 92 | WebGPU/TSL viewport. |
| `examples/falloff_addon.ts` | 75 | Ported addon example; tested. |
| `scripts/smoketest.ts` | 1278 | 53 headless smoke tests; useful but not exhaustive. |

## 9. Immediate next decision

Recommended next step is **Phase 1**: update docs/claims and add failing coverage tests for the critical gaps before changing implementation. After that, implement fixes in the order: bridge fidelity → core reactivity/validation → compositor correctness → shader coverage → texture coordinates/resources → zone polish.
