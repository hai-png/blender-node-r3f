# Phase 1 — Systematic Readthrough, Verification, and Gap Register
_Date: 2026-06-02_

This document is the **fresh, repo-local audit** produced after cloning the repository, inventorying the first-party files, reading the docs and implementation, and running the project verification commands.

It is written as the **phase-zero handoff for actual implementation work**: first establish what is really present, what is only claimed, what is approximated, and what is structurally exposed but not actually executable.

---

## 1. Scope and method

### Actions performed

1. Cloned `https://github.com/hai-png/blender-node-r3f` into the local workspace.
2. Inventoried the repository structure.
3. Read the project docs in:
   - `README.md`
   - `docs/ARCHITECTURE.md`
   - `docs/RESEARCH.md`
   - `docs/ROADMAP.md`
   - `docs/M2_M3_FIELDS.md`
   - `docs/M4_ZONES.md`
   - `docs/M5_COMPOSITOR.md`
   - `docs/PHASE0_AUDIT_2026-06-02.md`
4. Read the implementation in the critical runtime layers:
   - `src/core/*`
   - `src/registry/*`
   - `src/sockets/*`
   - `src/eval/*`
   - `src/eval/geometry/*`
   - `src/eval/compositor/*`
   - `src/eval/zones/*`
   - `src/bridge/*`
   - `src/ui/*`
   - `src/index.ts`, `src/tsl.ts`
   - node packs under `src/nodes/*`
   - demo app under `demo/*`
   - smoke tests in `scripts/smoketest.ts`
   - addon example in `examples/falloff_addon.ts`
5. Ran verification commands:
   - `npm ci`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
6. Cross-checked **registry exposure vs evaluator support** to find nodes that are available in the UI / registry but not actually executed in a given tree.

### Important framing

This repo is already a **real prototype**, not a scaffold. However, several subsystems still rely on a mix of:
- semantic approximation,
- intentional stubs,
- broad registry exposure that exceeds evaluator support,
- and demo/package shortcuts.

That distinction matters, because the repo's intent is not merely “prototype breadth”; it is:

> a Blender-like node runtime on top of three.js / R3F / TSL, with addon-porting structure and architecture close enough to Blender that the project’s research intent is meaningfully realized.

This audit measures the codebase against that stronger claim.

---

## 2. Repository inventory

At the time of this audit, the repo contained **91 first-party files** before adding this document (excluding `.git`, `node_modules`, and build output).

### Top-level
- `.github/workflows/ci.yml`
- `.gitignore`
- `LICENSE`
- `README.md`
- `package-lock.json`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`

### Demo
- `demo/App.tsx`
- `demo/TSLViewport.tsx`
- `demo/Viewport.tsx`
- `demo/index.html`
- `demo/main.tsx`

### Docs
- `docs/ARCHITECTURE.md`
- `docs/M2_M3_FIELDS.md`
- `docs/M4_ZONES.md`
- `docs/M5_COMPOSITOR.md`
- `docs/PHASE0_AUDIT_2026-06-02.md`
- `docs/RESEARCH.md`
- `docs/ROADMAP.md`

### Example
- `examples/falloff_addon.ts`

### Tests
- `scripts/smoketest.ts`

### Core runtime
- `src/core/Node.ts`
- `src/core/NodeLink.ts`
- `src/core/NodeSocket.ts`
- `src/core/NodeTree.ts`
- `src/core/NodeTreeInterface.ts`
- `src/core/Properties.ts`
- `src/core/trees.ts`
- `src/core/types.ts`

### Registry / sockets
- `src/registry/NodeRegistry.ts`
- `src/sockets/index.ts`

### Bridge
- `src/bridge/blender_exporter.py`
- `src/bridge/bpy_shim.ts`
- `src/bridge/exporter.ts`
- `src/bridge/importer.ts`
- `src/bridge/schema.ts`

### Evaluators and eval infra
- `src/eval/CompositorEvaluator.ts`
- `src/eval/Depsgraph.ts`
- `src/eval/GeometryEvaluator.ts`
- `src/eval/ShaderEvaluator.ts`
- `src/eval/TextureEvaluator.ts`
- `src/eval/flatten.ts`
- `src/eval/compositor/CompositorEvaluator.ts`
- `src/eval/compositor/CpuComposite.ts`
- `src/eval/compositor/KernelShaders.ts`
- `src/eval/compositor/PixelGLSL.ts`
- `src/eval/compositor/Quad.ts`
- `src/eval/compositor/TexturePool.ts`
- `src/eval/compositor/types.ts`
- `src/eval/geometry/Field.ts`
- `src/eval/geometry/Geometry.ts`
- `src/eval/geometry/MeshOps.ts`
- `src/eval/tsl/TSLShaderEvaluator.ts`
- `src/eval/zones/ZoneRunner.ts`
- `src/eval/zones/types.ts`

### Node packs
#### Common
- `src/nodes/common/Clamp.ts`
- `src/nodes/common/ColorRamp.ts`
- `src/nodes/common/CombineSeparate.ts`
- `src/nodes/common/Frame.ts`
- `src/nodes/common/Group.ts`
- `src/nodes/common/Logic.ts`
- `src/nodes/common/MapRange.ts`
- `src/nodes/common/Math.ts`
- `src/nodes/common/MixColor.ts`
- `src/nodes/common/Value.ts`
- `src/nodes/common/VectorMath.ts`
- `src/nodes/common/index.ts`

#### Shader
- `src/nodes/shader/BSDFs.ts`
- `src/nodes/shader/Inputs.ts`
- `src/nodes/shader/Shaders.ts`
- `src/nodes/shader/Textures.ts`
- `src/nodes/shader/VectorOps.ts`
- `src/nodes/shader/index.ts`

#### Geometry
- `src/nodes/geometry/FieldInputs.ts`
- `src/nodes/geometry/FieldUtils.ts`
- `src/nodes/geometry/Ops.ts`
- `src/nodes/geometry/Primitives.ts`
- `src/nodes/geometry/Zones.ts`
- `src/nodes/geometry/index.ts`

#### Compositor
- `src/nodes/compositor/Compositor.ts`
- `src/nodes/compositor/index.ts`

#### Texture
- `src/nodes/texture/Texture.ts`
- `src/nodes/texture/index.ts`

### UI
- `src/ui/AddMenu.tsx`
- `src/ui/BlenderNode.tsx`
- `src/ui/NodeEditor.tsx`
- `src/ui/operators.ts`
- `src/ui/store.ts`

### Public entrypoints
- `src/index.ts`
- `src/tsl.ts`

---

## 3. Verification results

### Install
`npm ci` ✅ passed

Observed package health notes:
- 2 moderate vulnerabilities reported by npm audit
- deprecated transitive dependency: `three-mesh-bvh@0.7.8`

### Typecheck
`npm run typecheck` ✅ passed

### Tests
`npm test` ✅ passed

Result:
- **90 passed / 0 failed**

### Build
`npm run build` ✅ passed

Observed build note:
- demo bundle is large
  - main JS chunk ≈ **2.34 MB raw**
  - ≈ **645 KB gzip**
- Vite warns about large chunk size

### Runtime registration counts
Verified by bootstrapping the registry:
- total unique registered node classes: **176**
- `ShaderNodeTree`: **67**
- `GeometryNodeTree`: **90**
- `CompositorNodeTree`: **57**
- `TextureNodeTree`: **34**

---

## 4. Stage-by-stage verification

## M0 — Foundations

### Verified present
- coherent `Node`, `NodeSocket`, `NodeLink`, `NodeTree`, `NodeTreeInterface`
- property descriptor system with reactive assignment invalidation
- node/socket/tree registry
- built-in socket pack
- depsgraph object with dirty tracking and scene/simulation state
- event bus from tree to UI
- cycle reporting in `NodeTree.topoOrder()` + surfaced through `Depsgraph.evaluate()`
- group interface refresh mechanics
- `NodeTree.addZone()` convenience constructor

### Verified limitation
- dirty tracking exists, but evaluators still do **full-tree evaluation**
- no true incremental execution yet

### Verdict
**M0 is functionally real and stable for a prototype, but the depsgraph is not yet architecturally complete relative to the research intent.**

---

## M1 — Common + Shader

### Verified present
- broad common-node substrate exists in `src/nodes/common/*`
- legacy `ShaderEvaluator` produces usable `MeshStandardMaterial`-style descriptors
- `TSLShaderEvaluator` is real and substantial, not a placeholder
- group recursion, reroute, and mute are supported in both shader paths
- major BSDFs, input nodes, procedural textures, and vector ops are present

### Verified limitations
#### Legacy shader path
Still uses numerous explicit approximations/stubs for:
- procedural textures
- scene/input semantics
- color utility nodes
- vector/displacement normals path

#### TSL path
TSL is much stronger than the legacy path, but it still contains approximation-heavy emitters for:
- object/light/camera semantics
- some procedural texture fidelity
- some BSDF approximations (`Glass`, `Toon`, `Subsurface`, `Background`, volumes)

### Newly verified gap: TSL coverage is **not fully complete** for all registered shader nodes
Contrary to the current `docs/PHASE0_AUDIT_2026-06-02.md`, the TSL emitter table does **not** cover every registered shader-tree node.

Missing registered shader-tree nodes in `TSLShaderEvaluator`:
- `FunctionNodeBooleanMath`
- `FunctionNodeCompare`
- `FunctionNodeRandomValue`
- `GeometryNodeSwitch`
- `ShaderNodeCombineColor`
- `ShaderNodeSeparateColor`

These nodes are registered into the shader tree and exposed through the registry/UI, but they have no TSL emitter. They therefore fall back to literal defaults in the TSL path.

### Newly verified gap: legacy shader path also misses some registered common nodes
Missing registered shader-tree nodes in `ShaderEvaluator`:
- `FunctionNodeBooleanMath`
- `FunctionNodeCompare`
- `FunctionNodeRandomValue`
- `GeometryNodeSwitch`

### Verdict
**M1 is broad and real, but not fully closed. The largest remaining issue is not only semantic approximation, but also actual evaluator coverage mismatch for some shared/common nodes.**

---

## M2 / M3 — Geometry

### Verified present
Geometry remains the strongest subsystem in the repository.

Implemented and meaningfully working:
- geometry container with mesh / curves / points / instances
- field model with lazy materialisation and interpolation helpers
- attribute access/capture/store/remove flow
- mesh primitives and curve primitives
- set position / transform / join / bbox / convex hull / merge by distance / subdivision / triangulate
- distribute points / instance on points / realize instances
- curve to mesh / curve to points / resample / reverse
- sample index / sample nearest / proximity
- zone integration
- custom-node `executeGeo(ctx)` extension hook
- viewport rendering for mesh / point cloud / curves / instances

### Verified explicit stubs
Still intentionally stubbed in `GeometryEvaluator.ts`:
- `GeometryNodeFillCurve`
- `GeometryNodeFilletCurve`
- `GeometryNodeSampleCurve`
- `GeometryNodeSubdivideCurve`

### Newly verified gap: geometry-tree registry exposure exceeds evaluator support
The geometry tree registers shader-style texture nodes, but `GeometryEvaluator` does not implement them.

Registered in `GeometryNodeTree` but not executed by `GeometryEvaluator`:
- `ShaderNodeTexNoise`
- `ShaderNodeTexImage`
- `ShaderNodeTexEnvironment`
- `ShaderNodeTexVoronoi`
- `ShaderNodeTexWave`
- `ShaderNodeTexChecker`
- `ShaderNodeTexBrick`
- `ShaderNodeTexGradient`
- `ShaderNodeTexMagic`
- `ShaderNodeTexWhiteNoise`

This is important because:
- the research doc explicitly treats texture nodes as part of Geometry Nodes utility coverage,
- the nodes are registered into the geometry tree,
- and the Add menu can expose them,
- but the evaluator does not currently execute them.

### Verdict
**Geometry is the strongest implemented subsystem, but it still has both explicit curve stubs and a real support-matrix mismatch for registered geometry-tree texture nodes.**

---

## M4 — Zones

### Verified present
- simulation zone pairing and cache replay
- repeat zone iteration
- foreach-element zone iteration
- `zone_id` pairing
- zone-escape marking in links
- outer-evaluator skip of zone interiors
- `ZoneRunner` with topo-restricted interior evaluation
- scene clock and cache ownership in `Depsgraph`

### Verdict
**M4 is genuinely implemented at prototype level and is one of the repo’s differentiators.**

---

## M5 — Compositor

### Verified present
- real WebGL render-target evaluator
- planner/fusion machinery
- kernel passes for blur/glare/vignette/pixelate/translate/scale/rotate/flip/crop
- CPU reference compositor for solid-color / single-pixel parity checking
- split-viewer handling
- external texture resolver hook
- headless-safe fallback behavior

### Verified limitation
The CPU compositor still does **not** explicitly implement:
- `CompositorNodeAlphaOver`
- `CompositorNodeSetAlpha`
- `CompositorNodeHueSat`

So the project’s headless reference path still does not validate every claimed pixel-wise compositor node.

### Newly verified gap: compositor-tree registry exposure exceeds evaluator support
The compositor tree includes a broad set of shared/common node ids, but the compositor planner/evaluator does not support all of them.

Registered in `CompositorNodeTree` but not supported by the current compositor evaluator path:
- `FunctionNodeBooleanMath`
- `FunctionNodeCompare`
- `FunctionNodeRandomValue`
- `GeometryNodeSwitch`
- `ShaderNodeClamp`
- `ShaderNodeCombineColor`
- `ShaderNodeCombineXYZ`
- `ShaderNodeMapRange`
- `ShaderNodeMath`
- `ShaderNodeMix`
- `ShaderNodeRGB`
- `ShaderNodeSeparateColor`
- `ShaderNodeSeparateXYZ`
- `ShaderNodeTexNoise`
- `ShaderNodeValToRGB`
- `ShaderNodeValue`
- `ShaderNodeVectorMath`

These are registry/menu-visible but not compositor-evaluable in the current pipeline.

### Verdict
**M5 is substantial and real, but the CPU verifier is still incomplete and the compositor registry currently over-promises evaluator support.**

---

## M6 — Texture

### Verified present
- sampler-graph compilation
- texture-specific node set
- image resolver hook
- baking to `DataTexture`
- group/reroute flattening support

### Newly verified gap: texture-tree registry exposure exceeds evaluator support
The texture tree registers shared/common node ids that the `TextureEvaluator` does not execute.

Registered in `TextureNodeTree` but not supported by the current texture evaluator path:
- `FunctionNodeBooleanMath`
- `FunctionNodeCompare`
- `FunctionNodeRandomValue`
- `GeometryNodeSwitch`
- `ShaderNodeClamp`
- `ShaderNodeCombineColor`
- `ShaderNodeCombineXYZ`
- `ShaderNodeMapRange`
- `ShaderNodeMath`
- `ShaderNodeMix`
- `ShaderNodeRGB`
- `ShaderNodeSeparateColor`
- `ShaderNodeSeparateXYZ`
- `ShaderNodeTexNoise` (shared/common shader-style noise node, not `TextureNodeNoise`)
- `ShaderNodeValToRGB`
- `ShaderNodeValue`
- `ShaderNodeVectorMath`

Note the subtle but important distinction:
- `TextureNodeNoise`, `TextureNodeMath`, `TextureNodeValToRGB`, etc. **are** implemented.
- their **shared/common** counterparts (`ShaderNodeMath`, `ShaderNodeValToRGB`, etc.) are still registered into the texture tree but are **not** executed by `TextureEvaluator`.

### Verdict
**M6 is solid for its texture-specific nodes, but the tree’s exposed registry surface is currently larger than its actual executable surface.**

---

## M7 — Bridge / addon compatibility

### Verified present
- Blender JSON exporter
- Zod schema
- importer and exporter
- group-node tree reference round-trip
- interface panel hierarchy round-trip
- `bpy` shim and `nodeitems_utils` shim
- custom geometry-node addon port example
- `executeGeo(ctx)` extension point for addon behavior

### Verified limitation
The compatibility story is **structural / mechanical**, not automatic:
- no Python→TS translator
- behavior still needs evaluator hooks
- parity depends on evaluator support in the relevant tree

### Verdict
**M7 is credible for manual/mechanical addon porting, not full automatic Blender addon execution parity.**

---

## M8 — UI / editor polish

### Verified present
- node editor with React Flow
- colored sockets, dashed shader links, animated geometry links
- inline property and socket editors
- Add menu with search
- keyboard shortcuts for undo/redo, auto-layout, mute/hide, copy/paste
- headless operator implementations in `src/ui/operators.ts`

### Verified limitations
- `makeGroup` / `ungroup` exist but are not wired into the editor UI
- `getGroupCtors()` exists in `NodeEditor.tsx` but is unused
- no dedicated inspector panel
- demo tree switching rebuilds trees and discards edits
- no persistent multi-tree session model
- old tree subscriptions in Zustand store are not explicitly unsubscribed

### Verdict
**M8 has useful operator groundwork, but the editor/app layer is still not complete enough to claim Blender-like workflow parity.**

---

## 5. Critical cross-cutting findings

## A. The single biggest architectural issue is **registry/evaluator mismatch**
The repo currently registers many nodes into a tree that the corresponding evaluator does not actually support.

This is not just a docs issue. It affects:
- Add menu correctness
- user expectations
- bridge/import safety for imported Blender graphs
- addon portability
- the honesty of milestone claims

This mismatch appears in several places:
- shader tree: some common nodes registered but not executed by legacy and/or TSL paths
- geometry tree: shader texture nodes registered but not executed
- compositor tree: many common/shared nodes registered but not executed
- texture tree: many common/shared nodes registered but not executed

### Why this matters
Architecturally, the project should do **one** of the following:
1. implement those nodes in the evaluator,
2. gate them from tree registration/UI until implemented,
3. or explicitly mark them as non-executable compatibility declarations.

Right now the codebase often does none of the three.

---

## B. Existing audit docs are helpful but not fully reliable
The current `docs/PHASE0_AUDIT_2026-06-02.md` is useful, but it misses the evaluator-coverage mismatches above.

Most notably, its statement that the current registered shader node set has complete TSL emitter coverage is not accurate.

---

## C. The repo already has enough depth that the next phase should be **closure**, not more breadth
Breadth is no longer the main issue.

The main issue is now **parity closure**:
- support matrix correctness,
- removal of dead registry exposure,
- filling stubs,
- tightening shader/compositor correctness,
- making UI and package layers align with the runtime.

---

## 6. Current gap register

Ordered by impact on the project’s stated research/architecture intent.

### GAP-1 — Registry/UI exposes nodes that evaluators do not execute
This is the most important structural gap.

### GAP-2 — TSL shader path still has both fidelity gaps and missing common-node emitters
Missing emitter coverage for:
- Boolean Math
- Compare
- Random Value
- Switch
- Combine Color
- Separate Color

### GAP-3 — Legacy shader path still misses common-node execution and remains approximation-heavy
Missing execution for:
- Boolean Math
- Compare
- Random Value
- Switch

### GAP-4 — Geometry tree exposes texture nodes without evaluator support
Missing geometry-side execution for shader texture nodes registered into the geometry tree.

### GAP-5 — CPU compositor parity is incomplete
Missing explicit CPU support for:
- Alpha Over
- Set Alpha
- Hue/Sat

### GAP-6 — Geometry curve stubs remain open
Still stubbed:
- Fill Curve
- Fillet Curve
- Sample Curve
- Subdivide Curve

### GAP-7 — UI/editor wiring is incomplete
- make group / ungroup not surfaced
- no inspector panel
- destructive demo tree switching
- no persistent session model

### GAP-8 — Packaging is not library-ready
- `main` points to `src/index.ts`
- no `exports` map
- no library artifact layout
- demo-oriented Vite build only

### GAP-9 — Depsgraph is not yet truly incremental
Dirty tracking exists, but evaluator execution is still full-tree.

---

## 7. Recommended phased implementation order

## Phase 2 — Support-matrix correction
**Goal:** make registry exposure honest before deeper fidelity work.

Two viable strategies:

### Strategy A — strict correctness first
- remove unsupported `tree_types` registrations from nodes not yet executable in a given tree
- hide unsupported nodes from AddMenu / registry listings
- keep docs conservative

### Strategy B — parity-first
- keep registrations
- implement the missing evaluator cases so tree exposure becomes true

### Recommendation
Use a hybrid:
1. **immediately gate obviously unsupported nodes from the editor UI**
2. **then implement the missing evaluator coverage**

That avoids presenting dead nodes while implementation is in progress.

Concrete Phase 2 tasks:
- add evaluator-coverage tests that compare registry exposure to support tables
- fix TSL common-node gaps
- fix legacy shader common-node gaps
- decide whether geometry/compositor/texture shared/common nodes should be executed or de-registered per tree

## Phase 3 — Shader parity closure
- improve TSL fidelity for procedural textures and scene/input semantics
- improve legacy shader approximations where reasonable
- add direct tests for missing common/shared nodes in both shader paths

## Phase 4 — Geometry closure
- implement `SubdivideCurve`
- implement `SampleCurve`
- implement `FilletCurve`
- implement `FillCurve`
- then add geometry-tree texture-node execution or narrow registration

## Phase 5 — Compositor closure
- complete CPU parity for `AlphaOver`, `SetAlpha`, `HueSat`
- add parity tests against GPU conventions
- decide whether compositor should support common/shared node aliases or stop registering them

## Phase 6 — Texture closure
- decide whether shared/common nodes in texture trees should be aliased to texture equivalents or removed from exposure
- add tests so the registry and evaluator cannot drift again

## Phase 7 — UI/editor completion
- wire make group / ungroup
- add inspector panel
- preserve per-tree edits in demo/app state
- add a persistent multi-tree session model

## Phase 8 — Packaging / release readiness
- add library build output
- add `exports` map
- publishable entrypoints
- demo code splitting / bundle-size reduction
- dependency/audit cleanup

---

## 8. Bottom-line assessment

`blender-node-r3f` is already a **serious implementation prototype**.

### Strongest parts
- geometry fields and zones
- compositor GPU pipeline architecture
- bridge/import-export story
- addon-porting shim structure
- runtime core model

### Most important unfinished work
- support-matrix honesty and closure
- shader parity cleanup
- explicit geometry curve stub completion
- CPU compositor parity
- UI/app/package completion

### Short honest summary
- **Core runtime:** strong
- **Geometry:** strongest subsystem
- **Zones:** genuinely implemented
- **Compositor:** substantial and real
- **Texture:** solid in its own node set
- **Bridge/shim:** credible
- **Shader:** broad but still incomplete and approximate
- **Cross-tree node exposure:** currently over-broad relative to evaluator support
- **UI/package:** still prototype-level

---

## 9. Recommended immediate next move

**Do not jump straight into ad hoc feature additions.**

The correct next implementation phase is:

> **Phase 2 — support-matrix correction and evaluator parity guardrails**

That gives us a trustworthy foundation for the later feature-completion phases.

Specifically, the first implementation tranche should likely be:
1. add registry-vs-evaluator support tests,
2. close the missing TSL/common-node cases,
3. close the missing legacy shader/common-node cases,
4. decide for geometry/compositor/texture whether to implement or temporarily hide unsupported cross-tree nodes.

That will convert the repo from “broad prototype with hidden dead edges” into a much more honest and implementation-ready base.
