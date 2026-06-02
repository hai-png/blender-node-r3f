# PHASE 0 AUDIT — 2026-06-02

Repository audited: `hai-png/blender-node-r3f`  
Commit audited: `a22275126f33b58770c89b9ddfcb08fbd68d3581`

## 1. Scope and method

This audit is a **repository-wide baseline** for the next implementation phases.

What was done:

1. Cloned the repository and inventoried all tracked project files.
2. Read the core docs (`README`, `RESEARCH`, `ARCHITECTURE`, `ROADMAP`, `M2_M3_FIELDS`, `M4_ZONES`, `M5_COMPOSITOR`).
3. Inspected the runtime architecture and all major subsystems:
   - core model / registry / sockets
   - shader evaluators (legacy + TSL)
   - geometry evaluator / fields / mesh ops / zones
   - compositor planner / GPU runner / CPU checker
   - texture evaluator
   - bridge / importer / exporter / bpy shim
   - UI / operators / demo
4. Verified the current baseline by running:
   - `npm install`
   - `npm test`
   - `npm run typecheck`
   - `npm run build`
5. Compared the **research + architecture intent** against the actual implementation and identified:
   - shipped work
   - partial work / approximations / shims
   - doc drift
   - concrete next implementation targets

## 2. Verified current baseline

### 2.1 Build / test status

All of the following passed during this audit:

- `npm test` → **98 passed, 0 failed**
- `npm run typecheck` → **clean**
- `npm run build` → **clean**

### 2.2 Runtime registration counts

Verified via `bootstrapBuiltins()` + `NodeRegistry`:

- Shader nodes: **67**
- Geometry nodes: **90**
- Compositor nodes: **57**
- Texture nodes: **34**
- Built-in sockets: **31**
- Unique registered node classes: **176**

### 2.3 Repository inventory

Non-generated project files audited (excluding `.git`, `node_modules`, `dist-demo`):

- docs: **6**
- demo: **5**
- examples: **1**
- scripts: **1**
- src: **69**
- root/project files: README, package files, config, CI, license

## 3. Executive assessment

### 3.1 Short version

This repository is **not yet Blender feature-equivalent**, but it is a **substantial, coherent M0–M8 prototype/subset** with real working evaluators in all four systems.

The strongest parts today are:

- core node/tree/socket/runtime model
- recursive groups across all systems
- geometry field pipeline and zone framework
- compositor planning + GPU pipeline + CPU pixel verifier
- texture sampler graph
- JSON bridge and round-trip import/export
- addon porting path via `bpy` shim + `executeGeo`
- headless editor operators (`History`, `makeGroup`, `ungroup`, `autoLayout`)

The main remaining issues are **not “nothing works” issues**. They are mostly:

1. **scope gaps** versus the research vision
2. **partial semantic implementations** in several nodes
3. **approximations/shims** in the legacy shader path and parts of geometry
4. **packaging + docs drift**
5. **UI / workflow incompleteness**
6. **incremental/depsgraph architecture not finished**

### 3.2 Bottom-line verdict by intent

Against the top-level research goal (“feature-equivalent Blender node system on top of three.js / R3F”), the project currently rates as:

- **Architecture direction:** strong
- **Prototype completeness:** strong
- **Subset execution quality:** good
- **Blender equivalence:** partial
- **Production/library readiness:** partial

## 4. Milestone-by-milestone audit

## M0 — Foundations

### Verified as implemented

- `NodeTree`, `Node`, `NodeSocket`, `NodeLink`, `NodeTreeInterface`, `Properties`
- registry system (`NodeRegistry`, categories, trees, sockets)
- 4 tree classes
- eventing + depsgraph shell
- React Flow editor host / demo shell

### Notes

- Core data model is solid and close to the documented Blender mirror.
- `Node.computeInternalLinks()` is a good cross-system mute foundation.
- `NodeTree.refreshGroupNodes()` and interface identifier preservation are important and implemented.

### Gaps / deviations

- `NodeTree.addLink()` does **not forbid cycles**; Blender normally forbids them at link time.
- `Depsgraph` tracks dirty nodes, but evaluators still do **full-tree evaluation**.
- Architecture doc says `topoOrder()` throws on cycles; actual code **annotates cycle nodes and continues**.

Verdict: **implemented, but with intentional prototype compromises**.

---

## M1 — Common + Shader

### Verified as implemented

Common nodes registered and working:

- Math, Vector Math
- Mix
- Map Range, Clamp
- Combine/Separate XYZ + Color
- Color Ramp
- Boolean Math, Compare, Switch, Random Value
- Value, RGB, Vector
- Frame, Reroute
- Group Input/Output + Group containers

Shader system implemented in two paths:

1. **Legacy `ShaderEvaluator`** → material descriptor
2. **`TSLShaderEvaluator`** → real Three.js TSL / `MeshStandardNodeMaterial`

Registered shader subset includes:

- Material / World / Light outputs
- Principled + multiple BSDFs / volume nodes
- core texture nodes
- UV/attribute/fresnel/layer weight/object/camera/light path inputs
- mapping / rotate / displacement family

### What is strong

- TSL path is the correct long-term architecture.
- Group recursion works.
- Node mute and reroute work.
- Texture resolvers for image/environment are implemented in TSL.
- Tests cover representative shader/common chains.

### Important shims / approximations

#### Legacy shader evaluator is intentionally approximate

`src/eval/ShaderEvaluator.ts` still uses many CPU-side placeholders/stubs:

- many texture nodes return placeholder mid-grey / random / constant outputs
- many input nodes are stubbed (UV, attribute, object, camera, light path, tex coord, geometry)
- several vector nodes are pass-through or simplified
- World/Light outputs are not a first-class root in the legacy evaluator (TSL path does better)

#### TSL path is stronger but still not exact Blender equivalence

Examples of current approximation notes in `TSLShaderEvaluator`:

- Combine/Separate Color treat channels as RGB even when mode is HSV/HSL
- Bump is essentially pass-through
- closure mapping to PBR slots is approximate by necessity
- several shader semantics are good approximations, not Cycles/EEVEE parity

### Missing relative to full research vision

- no Cycles/OSL path
- no full world/light shading parity beyond subset handling
- no full Blender shader node coverage
- no true closure system beyond mapped descriptor/TSL abstraction

Verdict: **M1 shipped for a serious subset; TSL path is the strategic implementation, legacy path remains a compatibility/preview approximation layer**.

---

## M2 — Geometry foundations

### Verified as implemented

- geometry container: mesh / curves / points / instances
- fields with lazy materialisation
- Position / Normal / Index / ID / Radius / Named Attribute
- Set Position, Transform, Join Geometry, Bounding Box, Merge by Distance, Realize Instances, Triangulate
- mesh primitives: cube, UV sphere, ico sphere, cylinder, cone, grid, mesh line, mesh circle

### What is strong

- field infrastructure is real, not mocked
- attribute capture / anonymous attribute pattern exists
- evaluator architecture is credible and extensible
- geometry data model is usable in both headless tests and viewport output

### Important simplifications

- domain interpolation is only robust for some cases; many conversions fall back to broadcast/clamped-index approximations
- `normalField()` for some domains is approximate
- `mergeByDistance()` is grid-hash based, not exact geometric merge
- `Triangulate` is effectively pass-through because internal meshes are already triangle-based

Verdict: **M2 is genuinely implemented, but some field/domain semantics are still simplified**.

---

## M3 — Geometry advanced

### Verified as implemented

- curve primitives: line, circle, bezier segment, spiral
- curve ops: curve to mesh, curve to points, resample, reverse
- mesh ops: subdivision surface, mesh to points, points to vertices, flip faces, convex hull
- distribute points on faces
- instance on points + realize instances
- sample index, sample nearest, geometry proximity
- additional curve work: fill / fillet / sample / subdivide

### Important partials / gaps

This is the single biggest concentration of **prototype shims**.

#### Geometry node semantics that are partially implemented or simplified

- `GeometryNodeFillCurve`:
  - works only for simple planar closed poly-curves
  - no holes / self-intersections
- `GeometryNodeFilletCurve`:
  - rounded-corner approximation, not Blender-exact
- `GeometryNodeSampleCurve`:
  - normalized-factor approximation across multi-curve inputs
- `GeometryNodeCurveToMesh`:
  - ignores `Fill Caps`
  - no-profile fallback is only a visibility approximation
- `GeometryNodeCurveToPoints`:
  - only geometry output is really used; tangent/normal/rotation outputs are not fully populated in evaluator
- `GeometryNodeResampleCurve`:
  - `Selection` input is present but not meaningfully applied
- `GeometryNodeReverseCurve`:
  - `Selection` input is present but not meaningfully applied
- `GeometryNodeMeshToPoints`:
  - `Position` input exists but is not actually consumed by evaluator
- `GeometryNodeStoreNamedAttribute`:
  - `Selection` input is currently ignored
- `GeometryNodeDistributePointsOnFaces`:
  - `Selection` is ignored
  - Normal/Rotation outputs are simplified constants rather than true sampled outputs
- `GeometryNodeInstanceOnPoints`:
  - `Pick Instance` / `Instance Index` are not implemented
- `GeometryNodeTranslateInstances`, `RotateInstances`, `ScaleInstances`:
  - `Selection` and `Local Space` are effectively ignored / simplified
- `GeometryNodeProximity`:
  - nearest-vertex style approximation, not true nearest-surface semantics
- `GeometryNodeFieldOnDomain`:
  - explicit simplification by clamped-index remap, not proper interpolation
- `GeometryNodeSwitch` in geometry evaluator:
  - still a static-ish fallback, not full dynamic field-aware switching
- `FunctionNodeRandomValue` in geometry evaluator:
  - partial handling; geometry field path does not fully mirror all output types

### Performance considerations

- `convexHull()` is naive and expensive
- Poisson filtering is O(n²)
- several curve/mesh algorithms are acceptable for prototype sizes but not production-scale geometry

Verdict: **M3 shipped as a useful advanced subset, but contains multiple declared partials that should be treated as implementation backlog rather than “done done”**.

---

## M4 — Zones

### Verified as implemented

- simulation / repeat / foreach node pairs exist
- paired `zone_id`
- outer evaluator skips interior nodes and delegates to `ZoneRunner`
- simulation cache stored on depsgraph
- rewind/reset semantics exist
- escape-link detection exists
- `NodeTree.addZone()` convenience exists
- smoke tests cover all three zone types

### What is strong

- the architecture is real, not faked
- simulation state survives across `evaluate()` calls
- pairing + scoped execution model is sensible

### Remaining gaps / simplifications

- foreach aggregation semantics are simplified:
  - geometry items joined
  - non-geometry items collapse to last value
- per-element slicing is simplified; geometry is effectively fed as whole geometry per iteration
- UI authoring for zone state items is incomplete:
  - docs mention drag-to-`+` / rich sidebar authoring
  - current implementation is mostly API-driven
- visual/editor support for zones is functional but not fully Blender-like

Verdict: **M4 is implemented and test-backed, with simplified foreach semantics and incomplete zone authoring UI**.

---

## M5 — Compositor

### Verified as implemented

- real planner + GPU render-target pipeline in `src/eval/compositor/`
- flattening of groups/reroutes for planning
- pixel-fused GLSL chain generation
- kernel nodes for blur / glare / vignette / pixelate / translate / scale / rotate / flip / crop
- CPU compositor verifier for pixel-wise math
- external texture resolver hook
- split viewer handling

### What is strong

- this is a real subsystem, not a placeholder
- planner behaviour is explicitly tested
- CPU path is valuable for correctness verification in headless mode

### Remaining gaps / limits

- compositor coverage is still a subset of Blender’s node set
- headless fallback returns `cpuColor` metadata, not a full emulated output image texture
- fixed output size is evaluator-driven, not per-node resolution negotiation like Blender’s full compositor model
- kernel coverage remains relatively narrow
- some advanced nodes are approximation-level rather than Blender-exact implementations

Verdict: **M5 shipped well for the intended subset**.

---

## M6 — Texture (legacy)

### Verified as implemented

- texture tree evaluator produces a per-sample callback
- bake-to-`DataTexture` works
- group/reroute supported via flattening
- node subset implemented: noise, checker, voronoi, wave, magic, blend, image, math, mix, color ramp, coordinates, output

### Remaining gaps

- only a subset of Blender texture nodes are implemented
- image sampling is nearest / simple and depends on optional resolver
- still a prototype subset, not full legacy texture-node parity

Verdict: **M6 shipped for the documented subset**.

---

## M7 — Bridge & addon compatibility

### Verified as implemented

- schema via Zod
- exporter/importer round-trip works
- Blender Python exporter exists
- group references use tree ids
- interface panels round-trip
- custom geometry nodes can implement `executeGeo(ctx)`
- worked addon example exists and is tested

### Important caveats

- this is **manual mechanical porting**, not automatic translation
- unknown nodes are skipped on import (good resilience, but not equivalence)
- `PointerProperty` exists only as a shim object inside `bpy_shim`, not as a fully integrated core property descriptor

### Important UI/runtime gap

- `nodeitems_utils.register_node_categories()` populates `NodeCategories`, but the current `AddMenu` ignores `NodeCategories` and instead groups by `static category` from `NodeRegistry.listForTree()`.
- Result: the addon compatibility surface is good for **runtime registration**, but not yet fully honoured by the editor UI.

Verdict: **M7 is meaningfully shipped, but the compatibility story is stronger at the runtime/import layer than in the UI/editor layer**.

---

## M8 — Polish

### Verified as implemented

- `History`
- `makeGroup`
- `ungroup`
- `autoLayout`
- copy/paste
- search/filter in add menu
- keyboard shortcuts

### Not yet complete

- no dedicated inspector panel component as described in docs
- no surfaced toolbar buttons for make-group / ungroup
- multi-select / marquee / grouping workflows remain limited
- tree switching in demo rebuilds trees and does not preserve per-tree edits
- theming / overall Blender UI fidelity still partial

Verdict: **M8 is partial and honestly should still be considered “UI/tools in progress”**.

## 5. Cross-cutting critical gaps

These are the most important remaining issues if the goal is to move from “strong prototype” toward “research intent achieved”.

### 5.1 Not actually feature-equivalent to Blender yet

The research goal is much broader than the current shipped subset.

Still missing or intentionally out-of-scope relative to full Blender parity:

- most Blender nodes across all systems
- volumes / OpenVDB geometry nodes
- full shader closure model / Cycles equivalence
- true compositor breadth
- complete geometry node semantics across all domains/components
- direct `.blend` binary parsing

### 5.2 Dirty tracking exists, incremental execution does not

`Depsgraph` tracks dirty nodes, but evaluators do not yet exploit dirty subsets.
Every `evaluate()` still effectively re-walks the whole tree.

This is one of the biggest architecture-vs-implementation gaps.

### 5.3 Cycle handling is tolerant, not Blender-like

- cycles are not prevented at link time
- evaluation surfaces a `__cycle__` error after the fact
- Blender would reject the invalid topology earlier

### 5.4 Packaging/library distribution is not finished

The docs describe library-style output, but the repo currently builds only the demo.

Current state:

- Vite build outputs `dist-demo/`
- package `main` points at `src/index.ts`
- no real library bundle/output pipeline
- no `exports` map for package consumers
- no emitted `.d.ts` library build artifacts

If the repo’s intent includes npm/library usage, this is a real gap.

### 5.5 UI uses runtime categories, not registered `nodeitems_utils` categories

This matters for addon compatibility and Blender fidelity.

### 5.6 Several node declarations exceed their actual behaviour

There are multiple nodes where sockets/properties are declared, but evaluator semantics are still partial. The code is honest in comments in several places, but the public surface can look more complete than it is.

## 6. Documentation drift / mismatches

These need cleanup before implementation continues, otherwise future work will be steered by stale assumptions.

### 6.1 Missing referenced file

Both `README.md` and `docs/ROADMAP.md` referenced this audit file before it existed.
This audit file now fills that gap.

### 6.2 Research/architecture mapping drift

Examples:

- `docs/RESEARCH.md` maps `ShaderEvaluator.ts` to the TSL implementation, but real TSL code lives in `src/eval/tsl/TSLShaderEvaluator.ts`
- README “Architecture at a glance” also points shader evaluation at the wrong file
- `src/registry/NodeCategory.ts` is referenced in docs, but categories live in `src/registry/NodeRegistry.ts`
- docs mention `src/ui/Inspector.tsx` and `src/ui/Toolbar.tsx`; these files do not exist as standalone modules
- docs describe library build outputs in `dist/`; current build produces `dist-demo/`
- architecture text mentions APIs like `NodeTree.invalidateFrom()` that do not exist in current code
- architecture says `topoOrder()` throws on cycle; current implementation annotates cycles instead

### 6.3 README status drift

README previously claimed:

- **90** smoke tests → actual current baseline is **98**
- some descriptions read closer to fully-polished UI than current code delivers

## 7. External dependency findings

### 7.1 `npm audit`

Current audit reports **2 moderate vulnerabilities**:

- `vite` (path traversal issue in certain versions)
- transitive `esbuild` dev-server issue

Suggested fix path from npm is a major-version Vite upgrade.

### 7.2 Deprecated transitive dependency

Install output reports:

- `three-mesh-bvh@0.7.8` deprecated transitively

Not a blocker for phase-1 analysis, but should be reviewed when upgrading dependencies.

## 8. Recommended implementation phases after this audit

This is the recommended order for actual code work.

### Phase 1 — Truth-align docs and package surface

Do first because it reduces confusion for every later phase.

1. Update README / ROADMAP / ARCHITECTURE to match current code paths and current counts.
2. Remove or clearly label stale claims.
3. Decide whether this repo is:
   - demo-first, or
   - publishable library
4. If library: implement real build/export/package pipeline.

### Phase 2 — Close architecture-level gaps

1. Enforce cycle rejection at link time.
2. Start using dirty subsets for real incremental evaluation.
3. Wire `NodeCategories` into the UI Add menu.
4. Surface `makeGroup` / `ungroup` in editor UI.

### Phase 3 — Eliminate the highest-value geometry shims

Recommended order:

1. `Store Named Attribute` selection semantics
2. `Mesh to Points` position input
3. `Distribute Points on Faces` real Normal/Rotation outputs + selection
4. `Instance on Points` pick/index handling
5. `Translate/Rotate/Scale Instances` selection + local/world semantics
6. `FieldOnDomain` / interpolation correctness
7. `CurveToPoints` secondary outputs
8. foreach aggregation semantics

### Phase 4 — Strengthen shader parity

1. Prioritise TSL path as the primary shader implementation.
2. Reduce legacy path placeholder behaviour or clearly re-scope it as fallback only.
3. Improve world/light output handling consistency across paths.
4. Decide which shader nodes are officially supported vs declared-but-approximate.

### Phase 5 — Compositor and texture coverage expansion

1. Expand compositor node set based on actual user priorities.
2. Improve headless compositor image emulation if needed.
3. Add more texture nodes only if real users depend on legacy texture trees.

### Phase 6 — UI / workflow polish

1. dedicated inspector
2. better selection/grouping UX
3. per-tree persistence in demo
4. tighter Blender-style theming

## 9. Implementation readiness verdict

### Safe to build on now

Yes.

This is a good base for the next implementation phase because:

- the architecture is coherent
- tests are passing
- the codebase already has real subsystem boundaries
- current gaps are identifiable and localisable

### What should **not** be assumed

Do **not** assume:

- all declared sockets/properties are semantically honoured
- docs are authoritative in every detail
- library packaging is ready
- Blender parity is already achieved

## 10. Concrete next-step backlog for code changes

If implementation starts immediately after this audit, the highest-leverage first tickets are:

1. docs/package truth alignment
2. AddMenu support for `NodeCategories`
3. cycle prevention in `NodeTree.addLink()`
4. geometry evaluator semantic fixes for declared-but-ignored inputs/outputs
5. real incremental depsgraph execution

## Appendix A — audited file inventory

```text
  35 .github/workflows/ci.yml
  16 .gitignore
  21 LICENSE
 157 README.md
 389 demo/App.tsx
  92 demo/TSLViewport.tsx
 255 demo/Viewport.tsx
  16 demo/index.html
  10 demo/main.tsx
 386 docs/ARCHITECTURE.md
 132 docs/M2_M3_FIELDS.md
 194 docs/M4_ZONES.md
 160 docs/M5_COMPOSITOR.md
 342 docs/RESEARCH.md
 133 docs/ROADMAP.md
  75 examples/falloff_addon.ts
3339 package-lock.json
  35 package.json
2259 scripts/smoketest.ts
 230 src/bridge/blender_exporter.py
 126 src/bridge/bpy_shim.ts
  98 src/bridge/exporter.ts
 172 src/bridge/importer.ts
  89 src/bridge/schema.ts
 177 src/core/Node.ts
  45 src/core/NodeLink.ts
 102 src/core/NodeSocket.ts
 346 src/core/NodeTree.ts
 129 src/core/NodeTreeInterface.ts
 205 src/core/Properties.ts
  33 src/core/trees.ts
  71 src/core/types.ts
  30 src/eval/CompositorEvaluator.ts
 127 src/eval/Depsgraph.ts
1711 src/eval/GeometryEvaluator.ts
 771 src/eval/ShaderEvaluator.ts
 377 src/eval/TextureEvaluator.ts
 874 src/eval/compositor/CompositorEvaluator.ts
 332 src/eval/compositor/CpuComposite.ts
 243 src/eval/compositor/KernelShaders.ts
 331 src/eval/compositor/PixelGLSL.ts
  42 src/eval/compositor/Quad.ts
  89 src/eval/compositor/TexturePool.ts
 108 src/eval/compositor/types.ts
 164 src/eval/flatten.ts
 403 src/eval/geometry/Field.ts
 674 src/eval/geometry/Geometry.ts
1529 src/eval/geometry/MeshOps.ts
1117 src/eval/tsl/TSLShaderEvaluator.ts
 451 src/eval/zones/ZoneRunner.ts
  84 src/eval/zones/types.ts
  87 src/index.ts
  40 src/nodes/common/Clamp.ts
  77 src/nodes/common/ColorRamp.ts
  80 src/nodes/common/CombineSeparate.ts
  58 src/nodes/common/Frame.ts
 171 src/nodes/common/Group.ts
 164 src/nodes/common/Logic.ts
  77 src/nodes/common/MapRange.ts
 137 src/nodes/common/Math.ts
 152 src/nodes/common/MixColor.ts
  63 src/nodes/common/Value.ts
 135 src/nodes/common/VectorMath.ts
  37 src/nodes/common/index.ts
 675 src/nodes/compositor/Compositor.ts
   2 src/nodes/compositor/index.ts
 106 src/nodes/geometry/FieldInputs.ts
 100 src/nodes/geometry/FieldUtils.ts
 626 src/nodes/geometry/Ops.ts
 201 src/nodes/geometry/Primitives.ts
 298 src/nodes/geometry/Zones.ts
  20 src/nodes/geometry/index.ts
 196 src/nodes/shader/BSDFs.ts
 126 src/nodes/shader/Inputs.ts
 154 src/nodes/shader/Shaders.ts
 212 src/nodes/shader/Textures.ts
 129 src/nodes/shader/VectorOps.ts
  23 src/nodes/shader/index.ts
 196 src/nodes/texture/Texture.ts
   2 src/nodes/texture/index.ts
 127 src/registry/NodeRegistry.ts
 316 src/sockets/index.ts
  12 src/tsl.ts
  72 src/ui/AddMenu.tsx
 289 src/ui/BlenderNode.tsx
 351 src/ui/NodeEditor.tsx
 254 src/ui/operators.ts
  39 src/ui/store.ts
  28 tsconfig.json
  20 vite.config.ts
```
