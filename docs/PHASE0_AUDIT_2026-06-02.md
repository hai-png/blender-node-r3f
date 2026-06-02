# Phase 0 Audit — `blender-node-r3f`
_Date: 2026-06-02_

This document is the **current, verified baseline** after cloning the repo, inventorying the first-party files, reading the architecture/research/docs, reading the core/evaluator/bridge/UI implementation, and running the project health checks.

It is intended to be the handoff document for the next implementation phases.

---

## 1. Scope and method

### What I did

1. Cloned the repository.
2. Inventoried all **first-party project files** (excluding `.git`, `node_modules`, and build artifacts).
3. Read the project docs in `README.md` and `docs/`.
4. Deep-read the key runtime modules:
   - `src/core/*`
   - `src/eval/*`
   - `src/bridge/*`
   - `src/ui/*`
   - `src/index.ts`
   - `demo/*`
5. Spot-checked node packs against evaluator coverage:
   - `src/nodes/shader/*`
   - `src/nodes/geometry/*`
   - `src/nodes/compositor/*`
   - `src/nodes/texture/*`
6. Ran verification commands:
   - `npm ci`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
7. Performed a manual cycle-detection verification on top of the smoke tests.

### Important note

The older `docs/MASTER_AUDIT.md` is now **partly stale**. Several issues listed there are already fixed in the current codebase. This document supersedes it as the current baseline.

---

## 2. Repository inventory

There are **90 first-party files** in the repo after excluding `.git`, `node_modules`, and `dist-demo`.

### Top-level

- `.gitignore`
- `LICENSE`
- `README.md`
- `package-lock.json`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`

### Demo app

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
- `docs/MASTER_AUDIT.md`
- `docs/RESEARCH.md`
- `docs/ROADMAP.md`

### Example addon port

- `examples/falloff_addon.ts`

### Test harness

- `scripts/smoketest.ts`

### Bridge

- `src/bridge/blender_exporter.py`
- `src/bridge/bpy_shim.ts`
- `src/bridge/exporter.ts`
- `src/bridge/importer.ts`
- `src/bridge/schema.ts`

### Core runtime

- `src/core/Node.ts`
- `src/core/NodeLink.ts`
- `src/core/NodeSocket.ts`
- `src/core/NodeTree.ts`
- `src/core/NodeTreeInterface.ts`
- `src/core/Properties.ts`
- `src/core/trees.ts`
- `src/core/types.ts`

### Evaluators and shared eval infra

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

### Public entrypoints

- `src/index.ts`
- `src/tsl.ts`

### Node packs — common

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

### Node packs — compositor

- `src/nodes/compositor/Compositor.ts`
- `src/nodes/compositor/index.ts`

### Node packs — geometry

- `src/nodes/geometry/FieldInputs.ts`
- `src/nodes/geometry/FieldUtils.ts`
- `src/nodes/geometry/Ops.ts`
- `src/nodes/geometry/Primitives.ts`
- `src/nodes/geometry/Zones.ts`
- `src/nodes/geometry/index.ts`

### Node packs — shader

- `src/nodes/shader/BSDFs.ts`
- `src/nodes/shader/Inputs.ts`
- `src/nodes/shader/Shaders.ts`
- `src/nodes/shader/Textures.ts`
- `src/nodes/shader/VectorOps.ts`
- `src/nodes/shader/index.ts`

### Node packs — texture

- `src/nodes/texture/Texture.ts`
- `src/nodes/texture/index.ts`

### Registry / sockets / UI

- `src/registry/NodeRegistry.ts`
- `src/sockets/index.ts`
- `src/ui/AddMenu.tsx`
- `src/ui/BlenderNode.tsx`
- `src/ui/NodeEditor.tsx`
- `src/ui/operators.ts`
- `src/ui/store.ts`

---

## 3. Verification results

### Install

- `npm ci` completed successfully.
- Notable package health findings:
  - **2 moderate vulnerabilities** reported by `npm audit`
  - deprecated transitive dependency: `three-mesh-bvh@0.7.8`

### Type-check

- `npm run typecheck` ✅ passed

### Build

- `npm run build` ✅ passed
- Vite produced a demo bundle with a large main chunk:
  - `index-C_x3JS6H.js` ≈ **2.33 MB** raw
  - ≈ **644 KB gzip**
- Vite emitted a chunk-size warning.

### Tests

- `npm test` result: **89 passed, 0 failed**
- The earlier ESM smoke-test issue in `geom: FilletCurve stub passes geometry through`
  has been fixed by removing the stray CommonJS `require(...)` from
  `scripts/smoketest.ts`.

### Manual verification beyond smoke tests

I also manually created a two-node cycle in a shader tree (`Math -> Math -> Math`) and verified:

- `NodeTree.topoOrder()` annotates `cycleNodes`
- `Depsgraph.evaluate()` adds an `__cycle__` error

So cycle reporting is currently real, even though the smoke tests do not meaningfully construct a cycle.

---

## 4. Current status by milestone

## M0 — Foundations

### Implemented well

- Core types exist and are coherent:
  - `Node`
  - `NodeSocket`
  - `NodeLink`
  - `NodeTree`
  - `NodeTreeInterface`
- Property decorators exist and are used.
- Socket registry / node registry / tree registry are implemented.
- Depsgraph exists and tracks dirty nodes.
- Cycle reporting now works.
- Group interface refresh is implemented.
- Zone helpers are wired into `NodeTree.addZone()`.

### Still incomplete / limited

- Dirty propagation exists, but **all evaluators still ignore the `dirty` subset** and do full-tree evaluation.
- Packaging is still source-project oriented, not library-oriented.

### Verdict

**M0 is functionally solid as a prototype runtime, but not yet finished as a production library substrate.**

---

## M1 — Common + Shader

## Common nodes

### Implemented

The common node layer is broad and credible:

- Math
- Vector Math
- Mix
- Clamp
- Map Range
- Combine / Separate XYZ and color
- Color Ramp
- Logic / Compare / Switch-like utilities
- Frame / Reroute
- Group I/O and Group container support

### Verdict

**Common node support is strong.**

## ShaderEvaluator (legacy / descriptor path)

### Good news

The legacy `ShaderEvaluator` is broader than the old audit suggested. It now handles nearly all registered shader node ids, and many previously missing node types are present.

### What is still only approximate

A lot of shader support is **present but still semantic shim / approximation**, especially for CPU-side or descriptor-side evaluation:

- Procedural texture nodes in `ShaderEvaluator` often return simplified constants or coarse placeholders:
  - `ShaderNodeTexVoronoi`
  - `ShaderNodeTexWave`
  - `ShaderNodeTexChecker`
  - `ShaderNodeTexBrick`
  - `ShaderNodeTexGradient`
  - `ShaderNodeTexMagic`
  - `ShaderNodeTexWhiteNoise`
  - `ShaderNodeTexImage`
  - `ShaderNodeTexEnvironment`
- Scene/input data nodes are still approximated:
  - `ShaderNodeUVMap`
  - `ShaderNodeAttribute`
  - `ShaderNodeFresnel`
  - `ShaderNodeLayerWeight`
  - `ShaderNodeObjectInfo`
  - `ShaderNodeCameraData`
  - `ShaderNodeLightPath`
  - `ShaderNodeTexCoord`
- Utility color nodes exist but several are intentionally marked `TSL APPROX` in comments even in the legacy evaluator path:
  - `ShaderNodeHueSaturation`
  - `ShaderNodeBrightContrast`
  - `ShaderNodeInvert`
  - `ShaderNodeGamma`
  - `ShaderNodeMixRGB`

### Verdict

**Legacy shader support is broad, but not physically/semantically faithful.** It is a working compatibility layer, not Blender-equivalent shading.

## TSLShaderEvaluator

### Implemented well

The TSL path is real and non-trivial. It is not a placeholder architecture-only file.

Implemented emitter coverage includes:

- value/color/vector basics
- math / vector math / map range / clamp / combine / separate
- `ShaderNodeValToRGB`
- `ShaderNodeUVMap`
- `ShaderNodeTexCoord`
- `ShaderNodeNewGeometry`
- `ShaderNodeFresnel`
- `ShaderNodeTexNoise`
- `ShaderNodeTexChecker`
- `ShaderNodeTexGradient`
- `ShaderNodeTexWhiteNoise`
- mapping / normal map / bump / vector rotate / displacement
- major BSDFs including Principled, Diffuse, Glossy, Refraction, Glass, Transparent, Translucent, Sheen, Toon, SSS, Emission, Background, Holdout, Volume Absorption, Volume Scatter, Mix/Add Shader

### Emitter coverage (verified by source scan)

The previously missing TSL emitters have now been added. For the current
registered shader node set, **TSL emitter coverage is complete**, including:

- shader input nodes (`Attribute`, `CameraData`, `LayerWeight`, `LightPath`, `ObjectInfo`)
- procedural / sampled texture nodes (`Voronoi`, `Wave`, `Brick`, `Magic`, `Image`, `Environment`)
- material-adjacent output roots (`Output Material`, `Output World`, `Output Light`)

The remaining work in the TSL path is now primarily **semantic fidelity**, not
raw emitter absence.

### Semantic caveat

Even several present TSL emitters are **approximations**, not Blender-equivalent implementations, especially:

- Glass
- Toon
- Subsurface Scattering
- Background

### Verdict

**TSL is impressive and real, but M1 is not fully complete relative to the research/README intent.**

---

## M2 / M3 — Geometry foundations and advanced geometry

### Implemented well

Geometry is one of the strongest parts of the repo.

Implemented and coherent:

- geometry container model
- field system
- field inputs (`Position`, `Normal`, `Index`, `ID`, `Radius`, named attrs)
- attribute capture/store/remove/read patterns
- mesh primitives
- curve primitives
- point distribution
- instances and realize
- curve-to-points / curve-to-mesh / reverse / resample
- subdivision surface
- bounding box / convex hull / flip faces / merge by distance / triangulate
- groups / reroutes / mute integration
- viewport integration for mesh / curves / points / instances

### Explicit remaining geometry stubs

These are currently intentionally stubbed in `GeometryEvaluator.ts`:

- `GeometryNodeFillCurve`
  - returns empty geometry
- `GeometryNodeFilletCurve`
  - pass-through stub
- `GeometryNodeSampleCurve`
  - returns zero/default fields
- `GeometryNodeSubdivideCurve`
  - pass-through stub

### Not shipped despite research ambition

- `Mesh Boolean` is not part of the current shipped implementation
- broader curve ops remain intentionally incomplete
- volume / grid / OpenVDB-style work is not present

### Verdict

**Geometry is the most substantial subsystem in the repo, but it still contains explicit algorithmic stubs where the research target is much larger.**

---

## M4 — Zones

### Implemented well

Zones are not superficial; they are genuinely implemented:

- Simulation Input / Output
- Repeat Input / Output
- Foreach Element Input / Output
- `zone_id` pairing
- topology-aware zone escape detection
- `NodeTree.addZone()` convenience constructor
- simulation caches in `Depsgraph`
- `ZoneRunner` interior execution
- foreach selection support

### What changed vs older audit

The older audit claimed foreach selection was ignored. That is no longer true.

Current `ZoneRunner.ts` contains explicit `__selection` handling and skips unselected elements.

### Verdict

**M4 is genuinely shipped at prototype level.**

---

## M5 — Compositor

### Implemented well

The compositor is real and deeper than a mock:

- WebGL render-target pipeline exists
- planner exists
- pixel-wise fusion exists
- kernel passes exist for blur / glare / vignette / pixelate / translate / scale / rotate / flip / crop
- split viewer GPU composition exists
- CPU reference evaluator exists
- headless-safe fallback exists

### Pixel/GPU coverage is stronger than old audit suggested

Present in `PixelGLSL.ts`:

- `CompositorNodeZcombine`
- `CompositorNodeValToRGB`
- `CompositorNodeColorBalance`
- `CompositorNodeHueCorrect`
- `CompositorNodeTonemap`

These were previously listed as missing in the older audit, but they are now implemented.

### Remaining compositor gaps

#### 1. CPU evaluator parity gap

`cpuComposite()` does **not** currently implement explicit cases for:

- `CompositorNodeAlphaOver`
- `CompositorNodeSetAlpha`
- `CompositorNodeHueSat`

These are registered and have GPU-side pixel emitters, but the CPU reference path is incomplete here.

This matters because the project explicitly uses the CPU path as a headless correctness backstop.

#### 2. Image / neighbourhood limitations in CPU mode

The CPU compositor is still fundamentally a **solid-color / single-pixel reference path**, not a full CPU image compositor.

That is fine as a design choice, but it should be documented more explicitly.

### Verdict

**M5 is substantially implemented, but the headless CPU verifier is not yet complete enough to validate all claimed pixel-wise compositor nodes.**

---

## M6 — Texture

### Implemented well

Texture support is consistent and in good shape for the documented scope:

- sampler-graph compilation
- coordinates / noise / checker / voronoi / wave / magic / blend / image / math / mix / val-to-rgb
- image resolver API exists
- `bakeToDataTexture()` exists
- custom color ramp stops are supported

### Verdict

**M6 is one of the cleaner, more internally consistent milestones.**

---

## M7 — Bridge and addon compatibility

### Implemented well

- Blender-side exporter exists: `src/bridge/blender_exporter.py`
- schema exists
- importer exists
- exporter exists
- round-trip tests exist
- `bpy` shim exists and is plausible for mechanical addon translation
- worked addon port exists: `examples/falloff_addon.ts`

### Caveat

The compatibility story is structurally good, but still **manual** in the exact way the README says:

- no automatic Python→TS translation
- behavior hooks still need evaluator-specific implementation

### Verdict

**M7 is valid for “mechanical porting with manual behavior hooks”, not for automatic addon execution parity.**

---

## M8 — Polish / editor UX

### Already present (and older docs understate this)

The UI is ahead of what older docs claim. It already includes:

- search in Add menu
- undo / redo shortcuts and toolbar buttons
- auto-layout shortcut and toolbar button
- copy / paste shortcuts
- mute / hide shortcuts and toolbar buttons
- delete via React Flow delete keys

### Still missing / incomplete

#### 1. Grouping operators are not wired into the UI

`makeGroup()` / `ungroup()` exist and are tested, but `NodeEditor.tsx` does not expose them in the toolbar or keyboard layer.

#### 2. No dedicated inspector panel

Properties are edited inline in nodes; there is still no separate Blender-style inspector/properties panel.

#### 3. Demo tree switching is destructive

`demo/App.tsx` rebuilds a fresh demo tree whenever `activeId` or `useTSL` changes. That means switching trees **discards edits** instead of preserving one live tree per system.

#### 4. Multi-tree app model is demo-only

The demo is still oriented around a single active tree in Zustand, not a persistent project/session model.

### Verdict

**M8 tooling is partially implemented and materially better than the old roadmap implies, but still incomplete at the application UX layer.**

---

## 5. Documentation drift (important)

This repo currently has a meaningful docs-vs-code mismatch.

## README drift

Verified issues in `README.md`:

- referenced `docs/GAP_ANALYSIS.md`, which did **not exist**
  - fixed in Phase 1 by pointing README at the verified phase-0 audit
- previously said **169 node classes** register at runtime
  - current verified unique count is **176**
- previously said **67 headless smoke tests pass**
  - current result is **90 passed, 0 failed**

## ROADMAP drift

`docs/ROADMAP.md` still lists several UI items as TODO that now exist, including:

- copy/paste
- search palette in Add menu
- some shortcut wiring

## MASTER_AUDIT drift

`docs/MASTER_AUDIT.md` is now partially obsolete. Several gaps listed there are already closed, including:

- cycle reporting
- foreach selection support
- texture image resolver
- texture color ramp custom stops
- compositor `ColorBalance`
- compositor `Tonemap`
- compositor `ZCombine`
- compositor GPU split viewer composition
- various shader-side additions

### Verdict

**Before implementation continues, docs need a synchronization pass.**

---

## 6. Package / build / release state

### Current reality

- `package.json` points `main` at `src/index.ts`
- there is no package `exports` map
- there is no library-mode build output
- a basic GitHub Actions workflow now exists for `npm ci`, `typecheck`,
  `test`, and `build`
- the demo builds, but the package is still not publication-ready as a reusable npm library

### Verdict

**The repo currently behaves more like a source/demo workspace than a packaged library.**

---

## 7. Current high-priority gap register

Ordered by impact on the stated research intent.

### GAP-1 — TSL shader fidelity is still incomplete

**Why it matters:** the project’s core pitch is Blender-style nodes on top of
Three/TSL/R3F. The missing TSL emitters have now been closed, but several of
those emitters still use **approximate semantics** rather than Blender-faithful
implementations.

Current TSL follow-up work is mainly about:

- improving `TexImage` / `TexEnvironment` sampling behavior and host resource integration
- refining procedural texture fidelity (`Voronoi`, `Wave`, `Brick`, `Magic`)
- improving scene/input semantics (`ObjectInfo`, `CameraData`, `LayerWeight`, `LightPath`)
- clarifying the scope of `World` / `Light` outputs versus full Blender world/light shading

### GAP-2 — Shader semantics remain approximate in the legacy path

Even where the legacy `ShaderEvaluator` covers the node id, many nodes still return constants or coarse approximations instead of real Blender-like behavior.

### GAP-3 — CPU compositor parity is incomplete

Missing explicit CPU support for:

- `CompositorNodeAlphaOver`
- `CompositorNodeSetAlpha`
- `CompositorNodeHueSat`

### GAP-4 — Geometry curve stubs remain open

Explicit stubs still present for:

- `GeometryNodeFillCurve`
- `GeometryNodeFilletCurve`
- `GeometryNodeSampleCurve`
- `GeometryNodeSubdivideCurve`

### GAP-5 — UI operator wiring is incomplete

Headless-tested operators exist but not fully surfaced in the editor UX:

- make group
- ungroup
- persistent multi-tree session handling
- dedicated inspector-style panel

### GAP-6 — Packaging / CI / release hygiene is incomplete

- no library build
- no exports map
- CI is now present, but only as a basic verification workflow
- audit issues remain
- demo bundle is oversized

### GAP-7 — Smoke test harness has one broken ESM test

This is small but should be fixed immediately because it obscures whether the test suite is actually green.

---

## 8. Recommended phased implementation plan

This is the order I recommend for actual work.

## Phase 1 — Baseline hygiene and docs sync ✅ completed

1. Fixed the failing smoke test (`require` -> ESM import)
2. Updated README counts and repaired the broken doc link
3. Updated ROADMAP to match current UI reality more closely
4. Marked `MASTER_AUDIT.md` as superseded by the newer baseline audit
5. Added CI for `npm ci`, `typecheck`, `test`, and `build`

**Why first:** it gives us a trustworthy baseline before feature work.

## Phase 2 — TSL shader parity closure (in progress)

The missing TSL emitters have now been added, including the previously absent
shader input and texture nodes. The phase is no longer about *coverage gaps*;
it is now about **fidelity refinement**:

- improve semantic accuracy of the new input/texture emitters
- strengthen real texture/environment resource integration
- keep extending focused smoke/integration coverage for the TSL path

**Why second:** this is the most direct gap against the project’s headline promise.

## Phase 3 — Legacy shader semantic cleanup

Replace placeholder constants in `ShaderEvaluator` with better approximations or shared utility implementations where practical.

**Why third:** improves non-TSL fallback fidelity and keeps both shader paths aligned.

## Phase 4 — Compositor CPU parity

Add CPU reference support for:

- `Alpha Over`
- `Set Alpha`
- `Hue/Sat`

Add parity tests against GPU emitter conventions.

**Why fourth:** strengthens the project’s headless verification story.

## Phase 5 — Geometry curve stub completion

Address, in order:

1. `SubdivideCurve`
2. `SampleCurve`
3. `FilletCurve`
4. `FillCurve`

If full implementations are too large, ship clearly documented limited versions first.

## Phase 6 — UI/editor completion

Wire into `NodeEditor`:

- make group
- ungroup
- preserved per-tree session state
- optional inspector panel

## Phase 7 — Packaging / release readiness

- library-mode build
- package exports
- npm-ready artifact layout
- bundle splitting / size work
- dependency refresh and audit cleanup

---

## 9. Bottom-line assessment

`blender-node-r3f` is **not** a toy scaffold. It is a broad, real prototype with genuine implementation depth in:

- core graph runtime
- geometry fields and zones
- compositor planning and GPU execution
- texture sampling
- bridge/import/export
- addon porting shim
- editor operators

However, the project is **not yet fully aligned with its strongest architectural claim**: a broad Blender-like node runtime whose shader/TSL path and package story are fully complete.

### The shortest honest summary

- **Core runtime:** strong
- **Geometry:** strongest subsystem
- **Compositor:** substantial and real
- **Texture:** solid
- **Bridge/addon shim:** credible
- **Shader TSL parity:** still incomplete
- **Docs/package/CI:** lagging behind implementation

---

## 10. Recommended next implementation phase

**Start with Phase 1: baseline hygiene and docs sync**, then move immediately into **Phase 2: TSL shader parity closure**.

That sequence will give us:

1. a trustworthy green baseline,
2. accurate project docs,
3. and then the highest-value feature closure against the research intent.

---

## Appendix A — Quick verified facts

- First-party files inventoried: **90**
- Unique registered node classes: **176**
- Per-tree registry counts:
  - Shader: **67**
  - Geometry: **90**
  - Compositor: **57**
  - Texture: **34**
- `npm run typecheck`: **pass**
- `npm run build`: **pass**
- `npm test`: **89 pass / 0 fail**
- The earlier ESM smoke-test issue has been fixed in Phase 1

---

## Appendix B — Immediate implementation candidates

These are low-risk, high-signal quick wins:

1. add TSL emitters for input nodes (`Attribute`, `ObjectInfo`, `CameraData`, `LightPath`, `LayerWeight`)
2. add TSL emitters for missing procedural textures (`Voronoi`, `Wave`, `Brick`, `Magic`, `Image`, `Environment`)
3. close CPU compositor parity for `AlphaOver`, `SetAlpha`, and `HueSat`
4. wire `makeGroup` / `ungroup` into the editor UI
5. start library packaging (`exports`, library-mode build, publishable entrypoints)

Those five tasks are now the highest-leverage next steps after the Phase 1 baseline cleanup.
