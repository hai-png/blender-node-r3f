# blender-node-r3f — Complete Critical Analysis Report
**Date:** 2026-06-02  
**Baseline:** commit `d13dadf` · 108 tests passing · strict tsc clean · vite build clean  
**Analyst:** Arena AI Agent

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Repository Structure](#2-repository-structure)
3. [Docs Audit — Research vs Architecture vs Reality](#3-docs-audit)
4. [Core Runtime Layer (M0)](#4-core-runtime-layer-m0)
5. [Common + Shader Nodes (M1)](#5-common--shader-nodes-m1)
6. [Geometry Foundations (M2)](#6-geometry-foundations-m2)
7. [Geometry Advanced (M3)](#7-geometry-advanced-m3)
8. [Zones (M4)](#8-zones-m4)
9. [Compositor (M5)](#9-compositor-m5)
10. [Texture (M6)](#10-texture-m6)
11. [Bridge & Addon Compatibility (M7)](#11-bridge--addon-compatibility-m7)
12. [Polish & Operators (M8)](#12-polish--operators-m8)
13. [Cross-cutting Gaps](#13-cross-cutting-gaps)
14. [Gap/Shim Inventory](#14-gapshim-inventory-by-priority)
15. [Implementation Phase Plan](#15-implementation-phase-plan)

---

## 1. Executive Summary

This is a **well-architected, coherently implemented M0–M8 prototype** of a Blender-compatible node system for three.js / React Three Fiber. The intent — a TypeScript system that mirrors `bpy.types.Node`, `NodeSocket`, `NodeTree`, `NodeTreeInterface`, `bpy.props.*`, `bpy.utils.register_class`, and `nodeitems_utils` closely enough that Blender Python addons can be ported with mechanical, structural change — is **directionally achieved** and **functionally running**.

### What is genuinely strong
- The **core data model** (`Node`, `NodeSocket`, `NodeLink`, `NodeTree`, `NodeTreeInterface`, `Properties`) faithfully mirrors the Blender Python API with correct lifecycle, reactivity, and update semantics.
- The **registry** (`NodeRegistry`, `NodeCategories`, `NodeItem`) mirrors `bpy.utils.register_class` + `nodeitems_utils` with enough fidelity to make ported addon code look structurally identical.
- The **geometry field pipeline** is real, not mocked — lazy `Field<T>`, domain-attributed typed arrays, anonymous attribute capture pattern, and zone isolation all work.
- The **zone framework** (Simulation / Repeat / Foreach) is correct: paired by `zone_id`, zone-escape rule enforced at link time, `SimZoneCache` persists across `evaluate()`, `resetSimulation()` wipes caches.
- The **compositor pipeline** is a real WebGL render-target chain with genuine shader fusion (`ShaderOperation`), `TexturePool` recycling, and a headless CPU verifier.
- The **bridge** (`BNG/1` JSON schema, Python exporter, TypeScript importer, round-trip exporter, bpy shim) is coherent and tested.
- The **editor operators** (`History`, `makeGroup`, `ungroup`, `autoLayout`) are headless-testable and correct.
- **108 smoke tests pass** across all four systems.

### Where the project falls short of its stated intent
- Several dozen geometry node sockets/properties are **declared but not semantically honoured** by the evaluator.
- The legacy `ShaderEvaluator` is a CPU-side approximate descriptor — useful for the WebGL fallback path but has placeholder implementations throughout.
- The TSL shader path is architecturally correct but has approximations in closure-to-PBR mapping, some mode handling, and bump/displacement.
- No **incremental evaluation** — every `evaluate()` call re-traverses the full tree.
- No **library build pipeline** — only a demo build exists; `package.main` points at the source entry, not a built artifact.
- **UI completeness** is partial: no Inspector panel component, no multi-select marquee, no per-tree edit persistence in the demo, and theming is incomplete.
- **Docs drift** throughout — referenced files missing, file path mismatches, API descriptions that don't match current code.

---

## 2. Repository Structure

```
blender-node-r3f/
├── docs/                      # 6 docs
│   ├── RESEARCH.md            # Deep Blender research (11 sections)
│   ├── ARCHITECTURE.md        # TypeScript architecture spec (15 sections)
│   ├── ROADMAP.md             # M0–M8 milestone plan
│   ├── PHASE0_AUDIT_2026-06-02.md  # Current audit baseline
│   ├── M2_M3_FIELDS.md        # Field/geometry reference
│   ├── M4_ZONES.md            # Zone reference
│   └── M5_COMPOSITOR.md       # Compositor reference
├── src/
│   ├── core/                  # 7 files — bpy.types.* mirror
│   ├── sockets/               # 1 file — 31 built-in socket classes
│   ├── nodes/
│   │   ├── common/            # 11 files — Math, Mix, Group, Frame, …
│   │   ├── shader/            # 6 files — BSDFs, Textures, Inputs, …
│   │   ├── geometry/          # 6 files — Primitives, Ops, Zones, Fields
│   │   ├── compositor/        # 2 files — 57 compositor node classes
│   │   └── texture/           # 2 files — 34 texture node classes
│   ├── eval/
│   │   ├── Depsgraph.ts
│   │   ├── ShaderEvaluator.ts (legacy WebGL fallback)
│   │   ├── GeometryEvaluator.ts (1711 lines)
│   │   ├── CompositorEvaluator.ts (stub re-export only)
│   │   ├── TextureEvaluator.ts (377 lines)
│   │   ├── flatten.ts
│   │   ├── compositor/        # 7 files — real compositor evaluator
│   │   ├── geometry/          # 3 files — Field, Geometry, MeshOps
│   │   ├── tsl/               # TSLShaderEvaluator (1117 lines)
│   │   └── zones/             # ZoneRunner + types
│   ├── registry/              # NodeRegistry.ts (127 lines)
│   ├── bridge/                # bpy_shim, schema, importer, exporter, .py
│   ├── ui/                    # NodeEditor, BlenderNode, AddMenu, store, operators
│   ├── index.ts               # Public entry point
│   └── tsl.ts                 # TSL evaluator sub-entry
├── demo/                      # 5 files — Vite app
├── examples/                  # falloff_addon.ts
├── scripts/                   # smoketest.ts (2259 lines)
└── .github/workflows/ci.yml
```

### Key size metrics
| File | Lines | Assessment |
|------|-------|------------|
| `GeometryEvaluator.ts` | 1711 | Largest, most complex |
| `TSLShaderEvaluator.ts` | 1117 | Second largest |
| `smoketest.ts` | 2259 | Comprehensive test coverage |
| `MeshOps.ts` | 1529 | Geometry operations library |
| `CompositorEvaluator.ts` (full) | 874 | WebGL pipeline |
| `NodeTree.ts` | 346 | Core model |
| `demo/App.tsx` | 389 | Demo app |

---

## 3. Docs Audit

### 3.1 RESEARCH.md — Accuracy ✅ 
Accurately describes Blender's 4 node systems, DNA model, evaluation strategies, group nodes, zones, wire format, and stack rationale. No significant drift detected. The section on socket display shapes references the "2025 redesign" (fixed shapes) which is correctly implemented.

**Minor gaps:**
- Section 4 (node catalogs) describes the *full* Blender node catalog — the project makes no claim to implement all of these; they're scope documentation.
- Section 7 (drivers/animation) is documented as scope for Zustand atoms; `depsgraph.setScene()` partially covers this but keyframe animation is not implemented (correctly out-of-scope).

### 3.2 ARCHITECTURE.md — Significant Drift ⚠️
Several sections describe APIs or files that don't exist or differ from current code:

| Architecture claim | Reality |
|--------------------|---------|
| `src/ui/Inspector.tsx` | **Does not exist** — inspector rendering is inline in `BlenderNode.tsx` |
| `src/ui/Toolbar.tsx` | **Does not exist** — toolbar is inline in `demo/App.tsx` |
| `src/registry/NodeCategory.ts` | **Does not exist** — `NodeCategory` lives in `NodeRegistry.ts` |
| `NodeTree.invalidateFrom(node)` | **Does not exist** — `depsgraph.invalidate(node)` is used instead |
| `topoOrder()` "throws on cycles" | **Wrong** — it annotates `cycleNodes` and continues |
| Geometry evaluator output → `BufferGeometry` | Partially true — output is `Geometry` data class, viewport converts it |
| "Sub-entries for lazy loading" | **Not implemented** — only one entry point |
| `dist/index.{esm,cjs,umd}.js` | **Not produced** — only `dist-demo/` |
| `CompositorEvaluator.ts` at top level | Is a **stub re-export** of `eval/compositor/CompositorEvaluator.ts` |

### 3.3 ROADMAP.md — Mostly Accurate ✅
Claims 108 tests, which matches. Milestone descriptions generally match shipped code. "UI chrome partial" is correctly flagged.

**Drift:**
- README and ROADMAP originally showed 90 smoke tests; now 108 (corrected in the audit).
- The "incremental depsgraph execution" limitation is accurately documented.

### 3.4 PHASE0_AUDIT_2026-06-02.md — Accurate and Thorough ✅
This is the most accurate document. All findings in this analysis corroborate the audit's findings. The recommended Phase 1–6 implementation order is sound.

---

## 4. Core Runtime Layer (M0)

### NodeTree.ts ✅ Well Implemented
- `addNode()` / `removeNode()` / `addLink()` / `removeLink()` — all correct with proper event emission and depsgraph invalidation.
- **Cycle prevention at link time**: `wouldCreateCycle()` + throws — **FIXED since audit** (audit noted it wasn't there; it now is with `wouldCreateCycle()` DFS check).
- `topoOrder()` via Kahn's algorithm — correctly annotates `cycleNodes` rather than throwing (pragmatic choice, surfaced as an error in EvaluationResult).
- `refreshGroupNodes()` cross-tree refresh — important for group interface reactivity, correctly implemented.
- `zoneIdOf()` + `detectZoneEscape()` — zone membership via forward/backward DFS reachability; correct but O(zones × nodes) per link edit.
- `addZone()` convenience constructor — works via `_registryLookup` hook to avoid circular deps.

**Remaining gaps:**
- `NodeTree._allTrees` is a static `Set` — **memory leak** for long-running apps (trees are never removed on GC, only when `removeNode` is called which doesn't clean the global set).
- `uniqueName()` uses a monotonic counter but doesn't reset — minor UX issue (name `.001` → `.002` even after deleting old nodes).

### Node.ts ✅ Strong
- Property reactivity via `Object.defineProperty` with update callback + depsgraph invalidation on `set` — correct and mirrors Blender RNA property behaviour.
- `computeInternalLinks()` for mute pass-through routing — correctly matches Blender's "first compatible by kind order" semantics.
- `findInput(identifier)` / `findOutput(identifier)` — rename-safe lookup implemented.

**Minor gap:**
- `addInput` / `addOutput` are `protected` — ported addon code calling through `inputs_new/outputs_new` works fine (shim works), but direct subclass code needs `protected`.

### NodeSocket.ts ✅ Strong
- `coerceFrom()` abstract pattern correctly established.
- `resolve()` returns linked value or default — used correctly by evaluators.
- `is_linked` computed correctly from `links.length`.
- All 31 built-in socket types registered with correct `kind`, `color`, and coercion logic.

### NodeLink.ts ✅ Strong
- `is_valid` implements Blender's type compatibility rules: same kind, numeric coercion group (VALUE/INT/BOOLEAN/VECTOR/RGBA), CUSTOM (reroute) is type-agnostic.
- `escapes_zone` flag — correctly propagated and used in `topoOrder()`.

### NodeTreeInterface.ts ✅ Correct
- `items_tree` flat list mirrors Blender 4.0+ `NodeTreeInterface.items_tree`.
- `new_socket()` / `new_panel()` / `remove()` / `move()` — all implemented.
- Panel nesting with `parent` references — implemented.
- `inputs()` / `outputs()` convenience filters — added (not in Blender's API but needed for our code).

### Properties.ts ✅ Complete
All 7 property types implemented: `FloatProperty`, `IntProperty`, `BoolProperty`, `StringProperty`, `EnumProperty`, `FloatVectorProperty`, `ColorProperty`. Metadata fields (min, max, subtype, items, description, update callback) all present. `PointerProperty` exists as a stub in the bpy shim.

### Depsgraph.ts ✅ Good Architecture, Gap in Incremental Execution
- `invalidate(node)` propagates downstream correctly via link traversal.
- `invalidateAll()` for full invalidation.
- `setScene()` updates scene clock + invalidates trailing sim caches on rewind.
- `resetSimulation()` wipes all zone caches + resets clock.
- `schedule()` via `queueMicrotask` for batching — correct.
- **Critical gap**: `evaluate()` ignores the `dirty` set passed to the evaluator. Every system evaluator calls full-tree evaluation. The dirty tracking exists but is not consumed.

### NodeRegistry.ts ✅ Strong
- `register()` / `registerSocket()` / `registerTree()` — with duplicate warning.
- `unregister()` — present.
- `listForTree()` filters by `tree_types`.
- `NodeCategories` (`_Categories`) — full `register()` / `unregister()` / `list(treeKind)` with poll support.
- `subscribe()` event for UI refresh — present.

---

## 5. Common + Shader Nodes (M1)

### Common Nodes ✅ All Implemented
All declared common nodes are real implementations:
- `MathNode` (50 operations)
- `VectorMathNode` (27 operations)
- `MixNode` (Float/Vec/Color × 19 blend modes)
- `MapRangeNode` (4 interpolation modes: LINEAR, STEPPED, SMOOTHSTEP, SMOOTHERSTEP)
- `ClampNode` (MINMAX, RANGE)
- `CombineXYZNode`, `SeparateXYZNode`, `CombineColorNode`, `SeparateColorNode`
- `ColorRampNode` (5 interpolation modes: LINEAR, CONSTANT, EASE, B_SPLINE, CARDINAL)
- `BooleanMathNode` (9 ops), `CompareNode` (6 ops), `SwitchNode`, `RandomValueNode`
- `ValueNode`, `RGBNode`, `VectorNode`
- `FrameNode`, `RerouteNode`
- `NodeGroupInput`, `NodeGroupOutput`, `NodeGroupBase` (4 system-specific Group containers)

### Group System ✅ Strong
- `NodeGroupBase` handles `resolvedTree` + `refreshSockets()` driven by interface identifier matching.
- Recursive evaluation works in all 4 systems.
- Interface reactivity (adding/removing group interface items syncs container sockets by identifier).
- Recursion guard (depth limit + visited set) prevents infinite loops.

### Shader Nodes — Two-Path Architecture
#### Legacy ShaderEvaluator ⚠️ Intentionally Approximate
**What works:** Principled BSDF color/roughness/metalness/emissive, Mix Shader (linear blend), Add Shader (channel sum), Emission, Holdout (opacity=0), Volume fallback, MixNode, MathNode, ValueNode in a shader chain.

**Placeholders/stubs throughout:**
- Most texture nodes: Voronoi → constant grey/random, Wave → constant, Checker → constant, Brick → constant, Image → grey, WhiteNoise → random scalar.
- Input nodes: UV Map → constant `[0,0,0]`, Attribute → constant, Object Info → constant, Camera Data → constant, Light Path returns 1 for most, Tex Coordinate → zero.
- Vector ops: Bump → pass-through input, Normal Map → pass-through, Mapping → partial, Vector Rotate → not fully decomposed.
- World/Light outputs handled by `emit()` but not a primary root in topo walk.

**Assessment:** Acceptable as a WebGL-fallback preview evaluator. Should be clearly labelled "preview/approximate" in docs.

#### TSL ShaderEvaluator ✅ Architecturally Sound, Approximations Acknowledged
- Walks tree in topo order, calls `emitNode()` per node, assembles `TSLMaterialDescriptor`.
- Real TSL nodes for: Math (all ops), VectorMath (all ops), Mix (blend modes), MapRange, Clamp, ColorRamp, CombineSeparate, BooleanMath, Compare, Switch, RandomValue.
- Principled BSDF → `MeshStandardNodeMaterial` slot mapping (color, roughness, metalness, normal, emissive, opacity).
- Procedural textures: Noise, Voronoi, Wave, Checker, Gradient, WhiteNoise — real TSL implementations using sin-hash + fbm.
- Image/Environment texture: `resolveTexture(key, kind)` callback + fallback to procedural placeholder.
- Input nodes: `uv()`, `positionLocal`, `positionWorld`, `normalWorld`, `cameraPosition` — all real TSL.

**Approximations:**
- `CombineSeparate Color`: HSV/HSL modes → treated as RGB (noted in code comment).
- `Bump` node → effectively passes normal through (no height-to-normal computation in TSL).
- Closure model: mapping multiple BSDFs to one PBR descriptor loses Cycles-level physical accuracy by design.
- `rotateEulerXYZ` → applied as composed axis rotations (correct for small angles, approximate for large).

---

## 6. Geometry Foundations (M2)

### Field System ✅ Real, Not Mocked
`src/eval/geometry/Field.ts`:
- `Field<T>` with `eval({ geometry, domain, size }): TypedArray` — lazy materialisation.
- `constField()`, `attributeField()`, `indexField()`, `positionField()`, `normalField()`, `idField()`, `radiusField()`, `anonField()`.
- `mapField()`, `zipField()` — lazy combinators.
- `liftToField()` — wraps a literal value as a constant field.
- `isField()` type guard.
- `interpolateAttribute()` — FACE↔POINT averaging and domain remapping.

**Gaps in domain interpolation:**
- `interpolateAttribute` only handles a subset of domain pairs robustly.
- `normalField()` for EDGE / CORNER / INSTANCE domains uses approximations (face average fallback).
- No POINT→CORNER or CORNER→POINT proper barycentric interpolation.

### Geometry Container ✅ Good
`Geometry` class with: `MeshComponent` (positions, triangles, face-normals cache, CSR edge/face offset arrays), `CurvesComponent` (spline type, cyclic, positions CSR), `PointCloudComponent` (positions), `InstancesComponent` (transforms + reference geometry), per-component attribute maps.

**Gaps:**
- `Volume` component declared as interface but only partially supported (no real sparse grid data).
- Lazy normal cache invalidation — correct.
- Attribute span pooling — basic, not sophisticated.

### Mesh Primitives ✅ All 8 Implemented
Cube, UVSphere, IcoSphere, Cylinder, Cone, Grid, MeshLine, MeshCircle — all produce correct `MeshComponent` with triangulated output.

### Data-flow Ops ✅ Core Set Implemented
`SetPosition`, `TransformGeometry`, `JoinGeometry` (multi-input via `link_limit=0`), `BoundingBox`, `ConvexHull`, `MergeByDistance`, `RealizeInstances`, `Triangulate`.

### GeometryEvaluator ✅ Architecture Correct
- Zone pre-pass: collects interior nodes per zone output, skips them in outer pass.
- Outer topo-order walk: dispatches by node class.
- Common math nodes handled inline within the geometry evaluator (re-uses `MathNode`, `VectorMathNode`, `MixNode`, etc. evaluation logic).
- `runZone()` called when a Zone Output is reached.
- `executeGeo(ctx)` hook for ported custom nodes.

---

## 7. Geometry Advanced (M3)

### Curve Primitives ✅ 4 Implemented
CurveLine, CurveCircle, BezierSegment, CurveSpiral — produce correct `CurvesComponent` with spline type set.

### Curve Ops — Partially Implemented ⚠️

| Node | Status | Gap |
|------|--------|-----|
| `CurveToMesh` | ✅ Working | Ignores `Fill Caps`; no-profile fallback approximate |
| `CurveToPoints` | ⚠️ Partial | Only primary geometry output used; tangent/normal/rotation outputs are zero-filled |
| `ResampleCurve` | ⚠️ Partial | `Selection` input present but not applied |
| `ReverseCurve` | ⚠️ Partial | `Selection` input present but not applied |
| `FillCurve` | ⚠️ Partial | Planar closed poly-curves only; no holes/self-intersections |
| `FilletCurve` | ⚠️ Partial | Rounded-corner approximation, not Blender-exact |
| `SampleCurve` | ⚠️ Partial | Normalized factor approximation; multi-curve inputs approximate |
| `SubdivideCurve` | ✅ Working | Correct midpoint insertion |

### Mesh Ops — Partial Semantics ⚠️

| Node | Status | Gap |
|------|--------|-----|
| `SubdivisionSurface` | ✅ Working | Loop algorithm with adjacency smoothing; multi-level correct |
| `MeshToPoints` | ⚠️ Partial | `Position` input socket declared but not consumed by evaluator |
| `PointsToVertices` | ✅ Working | Direct points→mesh conversion |
| `DistributePointsOnFaces` | ⚠️ Partial | `Selection` ignored; Normal/Rotation outputs are zero constants |
| `InstanceOnPoints` | ⚠️ Partial | `Pick Instance`/`Instance Index` not implemented |
| `TranslateInstances` | ⚠️ Partial | `Selection` + `Local Space` ignored |
| `RotateInstances` | ⚠️ Partial | `Selection` + `Local Space` ignored |
| `ScaleInstances` | ⚠️ Partial | `Selection` ignored |
| `FlipFaces` | ✅ Working | |
| `GeometryProximity` | ⚠️ Partial | Nearest-vertex approximation, not true nearest-surface |

### Field Utils — Partial ⚠️

| Node | Status | Gap |
|------|--------|-----|
| `AccumulateField` | ✅ Working | Sequential prefix-sum per domain |
| `FieldOnDomain` | ⚠️ Partial | Clamped-index remap, not proper domain interpolation |
| `FieldAtIndex` | ⚠️ Partial | Basic index lookup, edge cases not handled |
| `AttributeDomainSize` | ✅ Working | Returns count for each domain |

### Attribute Pattern ⚠️ Mixed
- `CaptureAttribute` ✅ — correctly decoupled snapshot, tested.
- `StoreNamedAttribute` ⚠️ — `Selection` input ignored.
- `RemoveNamedAttribute` ✅ — works.

### Sampling ⚠️ Approximations
- `SampleIndex` — basic re-evaluation, not fully domain-aware.
- `SampleNearest` — nearest vertex approximation.
- `GeometryProximity` — nearest vertex approximation, not nearest surface.

---

## 8. Zones (M4)

### Zone Framework ✅ Strong
All three zone kinds implemented and tested:

| Zone | Status | Notes |
|------|--------|-------|
| Simulation (Input/Output) | ✅ | Per-frame `SimZoneCache`, delta time, rewind semantics |
| Repeat (Input/Output) | ✅ | N iterations, iteration index exposed |
| Foreach Element (Input/Output) | ✅ | Domain-selectable, Index exposed, output joined |

### ZoneRunner.ts ✅ Correct
- `collectInterior()` — forward from Input ∩ backward from Output, excluding zone boundaries.
- State item socket generation from `state_items[]` — correct.
- `SimZoneCache.invalidateFrom(frame)` — rewind semantics correct.
- Zone-escape rule enforced at `NodeTree.addLink()` time.

**Gap:** `zoneIdOf()` recomputes DFS per call — O(zones × nodes) — acceptable for small trees, but would need caching for trees with many zones.

---

## 9. Compositor (M5)

### CompositorEvaluator ✅ Real WebGL Pipeline
Located at `src/eval/compositor/CompositorEvaluator.ts` (874 lines). The top-level `src/eval/CompositorEvaluator.ts` is just a re-export stub (30 lines).

**Architecture:**
- `TexturePool` — `WebGLRenderTarget` recycling by WxH key.
- `FullScreenQuad` — single-triangle renderer.
- `planTree()` — walks flattened topo order, greedily fuses consecutive pixel-wise nodes into `PIXEL_FUSED` ops; kernel nodes (`Blur`, `Glare`, etc.) break the chain.
- Executes plan: INPUT_CONST → `colorResult()`, PIXEL_FUSED → single fused fragment shader, KERNEL → dedicated shader pass, OUTPUT → final texture.
- `resolveTexture` hook for external image sources.
- Headless safety: returns `{ headless: true, texture: null }` when WebGL unavailable.

### PixelGLSL.ts ✅ Comprehensive
Emitters for: MixRGB (10 blend modes), BrightContrast, Invert, Gamma, Exposure, HueSatValue, AlphaOver, SetAlpha, RGBtoBW, Math (13 ops), ColorBalance, Tonemap, ZCombine, ColorRamp, MapRange, CombineColor, SeparateColor, Posterize, SplitViewer.

### KernelShaders.ts ✅ Good
Gaussian Blur (separable H+V, 9-tap), Glare (threshold→blur→add), Vignette, Pixelate, Translate, Scale, Rotate, Flip, Crop.

### CpuComposite.ts ✅ Headless Verifier
CPU pixel-math evaluator for headless testing. Tests confirm ColorBalance, Tonemap, ZCombine pixel arithmetic.

**Remaining gaps in compositor:**
- `CompositorNodeDefocus` — not implemented.
- `CompositorNodeSunBeams` — not implemented.
- `CompositorNodeDenoise` (OpenImageDenoise) — not implemented (correctly noted as out-of-scope).
- Matte nodes (Cryptomatte, Keying, Chroma Key, etc.) — not implemented.
- `CompositorNodeDilateErode`, `CompositorNodeInpaint` — not implemented.
- `CompositorNodeMovieClip`, `CompositorNodeMask` — not implemented.
- `CompositorNodeFileOutput` — not implemented (output only to canvas/R3F).

---

## 10. Texture (M6)

### TextureEvaluator.ts ✅ Good
- Sampler-graph compiler: per-sample `(u,v) => RGBA` callback.
- Group + reroute via shared `flattenTree` / `flatTopoOrder`.
- `bakeToDataTexture(sample, size, THREE)` — rasterises to `THREE.DataTexture` (RGBA8).
- Image resolver hook — `TextureEvaluator({ resolveImage })`.

### Texture Nodes ✅ 12 Nodes Implemented
Output, Coordinates, Noise, Checker, Voronoi (Euclidean/Manhattan), Wave (bands/rings + distortion), Magic, Blend (linear/radial/quadratic), Image (UV placeholder + resolver), Math (7 ops), Mix, ColorRamp.

**Missing relative to full Blender legacy texture system:**
- Clouds, Marble, Wood, Stucci, DistortedNoise — Blender legacy texture types not implemented (correctly out of scope for most use cases).

---

## 11. Bridge & Addon Compatibility (M7)

### BNG/1 JSON Schema ✅ Well-Defined
`src/bridge/schema.ts` with Zod validation. Captures: tree bl_idname, interface (sockets + panels with parent references), nodes (properties, socket defaults, location, mute, hide, state_items), links (from/to by node id + socket identifier), zone_id pairing.

**Gap:** `node_tree` reference in BNG JSON (for Group containers) is stored as a string ID but the importer reconstructs it by matching tree IDs — correct. However, **cross-document group references** (referencing a group tree not in the same BNG file) are not handled.

### Importer ✅ Solid
- Two-pass (trees first, then nodes+links) to handle group cross-references.
- Unknown node types logged but don't crash (graceful degradation).
- Panel parent resolution with late-binding fix for out-of-order items.
- State items restored for zone nodes.
- Zone_id pairing re-established.

### Exporter ✅ Round-Trippable
Produces valid BNG/1 JSON. Properties serialised. State items included. Zone_id included. Mute/hide flags included.

### Python Exporter ✅ Real Blender Addon
`src/bridge/blender_exporter.py` (230 lines) — works in Blender 4.x + 5.x. Walks `bpy.data.node_groups`, serialises interface, nodes, links, properties. Has operator UI for running from Text Editor.

### bpy Shim ✅ Well-Designed
- `bpy.types.*` — all core classes + spread of all built-in sockets.
- `bpy.props.*` — all 7 property types.
- `bpy.utils.register_class` / `unregister_class` — works by instanceof dispatch.
- `nodeitems_utils.register_node_categories` / `unregister_node_categories`.
- `inputs_new()` / `outputs_new()` Python-flavoured helpers installed on `Node.prototype`.

### Worked Addon Example ✅ Correct
`examples/falloff_addon.ts` — `GeometryNodeRadialFalloff` with `executeGeo(ctx)` hook. Two smoke tests pass.

**Gap:** No worked shader/compositor addon example. Only geometry system has `executeGeo`. Shader emitter extension and compositor emitter extension are architecturally possible but not documented with worked examples.

---

## 12. Polish & Operators (M8)

### Operators (headless) ✅ All 4 Implemented
- `autoLayout(tree)` — topological-depth column layout, mutates `node.location`.
- `History` — BNG JSON snapshot-based undo/redo (limit=100).
- `makeGroup(tree, nodes, ctors)` — packs selection into child group, auto-derives interface from boundary links.
- `ungroup(tree, container)` — inlines group back into parent, eval-preserving.

### NodeEditor.tsx ✅ Functional
- React Flow 12 host with `BlenderNodeView` as the universal node renderer.
- Keyboard shortcuts: Shift+A (Add), Delete/Backspace, Ctrl+Z, Ctrl+Y/Ctrl+Shift+Z, M (mute), H (hide), Ctrl+C/V (copy/paste), Ctrl+L (auto-layout), Ctrl+G/Alt+G (make/ungroup).
- `onConnect` → `tree.addLink()` with cycle guard.
- `onEdgesDelete` → `tree.removeLink()`.
- `onNodesChange` → position mutation + remove.
- `AddMenu` — Shift+A opens, search filter, categorised, uses `NodeCategories` first then static fallback.

### BlenderNode.tsx ✅ Good
- Blender-style header colour per node category.
- Coloured handles by socket kind.
- Display shape (CIRCLE/SQUARE/DIAMOND variants).
- Inline property editors for Float/Int/Bool/Enum/Vector properties.
- Mute → 50% opacity.

### Inspector / Properties Panel ✅ Inline only
Properties are rendered inline in the node body. **There is no standalone Inspector panel** as described in ARCHITECTURE.md — the panel described would appear in a sidebar for the selected node. This is a UI gap.

### UI Gaps ⚠️
- No dedicated Inspector/properties panel (sidebar for selected node details).
- Multi-select / marquee selection works (React Flow built-in) but no Blender-style box-select with filter.
- Demo tree switching rebuilds trees — per-tree edits are lost on type switch.
- Theming is partial: dark background + handle colors match Blender, but no full Blender theme system.
- No node preview thumbnails.
- No minimap click-to-navigate (MiniMap is rendered but not custom-styled).

---

## 13. Cross-cutting Gaps

### G1: Incremental Depsgraph ❌ Not Implemented
**Severity: High**  
Every `evaluate()` call performs a full-tree traversal. The `dirty` set is populated and passed to evaluators but **every evaluator ignores it**. This means:
- Frame-by-frame animation re-evaluates the entire tree.
- Editing one property re-evaluates all nodes.
- This blocks performance in large trees or real-time scenarios.

**Fix needed:** Evaluators must use the dirty set to skip clean nodes and reuse cached outputs.

### G2: Library Build Pipeline ❌ Not Implemented
**Severity: High (for npm publishing intent)**  
- `package.json` `"main": "src/index.ts"` — points at TypeScript source, not a built artifact.
- No `"exports"` map for sub-entry imports (`blender-nodes-r3f/tsl`, etc.).
- No `"types"` field in package.json.
- `vite.config.ts` builds only the demo to `dist-demo/`.
- No library build mode (`vite build --mode lib` or dedicated `tsup`/`rollup` config).
- `.d.ts` files are not emitted (only type-checking via `--noEmit`).

**Fix needed:** Add a library build target (e.g. `tsup` or `vite lib mode`) producing `dist/index.esm.js`, `dist/index.cjs.js`, `dist/tsl.esm.js`, and `.d.ts` files. Add `"exports"` map to package.json.

### G3: `NodeTree._allTrees` Memory Leak
**Severity: Medium**  
`static _allTrees: Set<NodeTree>` holds every tree ever created. Trees are never removed from this set. In a long-running application (or test suite), this accumulates indefinitely.

**Fix:** Either use `WeakRef` entries + periodic pruning, or add a `dispose()` method that removes the tree from `_allTrees`.

### G4: Evaluator Selector Docs Mismatch
**Severity: Low**  
ARCHITECTURE.md says "Depsgraph dispatches to system-specific evaluator based on `tree.bl_idname`." Reality: **the evaluator is injected** via `depsgraph.setEvaluator(ev)`. The dispatch is the user's responsibility. This is actually better (more flexible) but the docs should say so.

### G5: Version Drift in package.json
**Severity: Low**  
`three: "^0.169.0"` — Three.js is currently at 0.175+. TSL APIs can change between minor versions. `@react-three/fiber: "^8.17.10"` — fiber v9 is out. `@xyflow/react: "^12.3.5"` — latest.

### G6: UI Store Per-Tree Isolation
**Severity: Medium**  
`useTreeStore` holds a single `tree`. When the demo switches tree types, it replaces the tree entirely, discarding all edits. There's no per-tree edit state preservation.

**Fix:** Store a `Map<NodeTreeKind, NodeTree>` so switching tree types is lossless.

### G7: Cycle Behaviour vs Blender
**Severity: Low**  
Blender rejects cyclic links at creation time. Our `addLink()` now throws on cycles (cycle prevention is implemented), but `topoOrder()` still appends cycle nodes to allow partial evaluation. This is a reasonable design choice but worth documenting clearly.

### G8: TSL Evaluator in Node Environment
**Severity: Medium**  
`three/webgpu` requires `self` and `navigator.gpu` globals. The smoke tests patch these (`globalThis.self = globalThis`). The architecture doc's `import` path (`blender-nodes-r3f/tsl`) is the correct sub-entry pattern, but the vite config doesn't expose it as a separate chunk.

---

## 14. Gap/Shim Inventory by Priority

### Priority 1 — Architecture Blockers

| # | Gap | File | Fix Complexity |
|---|-----|------|----------------|
| P1-1 | Library build pipeline | `package.json`, `vite.config.ts` | Medium |
| P1-2 | `package.json` exports map | `package.json` | Low |
| P1-3 | Incremental evaluator execution | All evaluators | High |
| P1-4 | `NodeTree._allTrees` memory leak | `NodeTree.ts` | Low |

### Priority 2 — Geometry Evaluator Semantic Gaps

| # | Gap | Node | Fix Complexity |
|---|-----|------|----------------|
| P2-1 | `StoreNamedAttribute` ignores Selection | `Ops.ts` / `GeometryEvaluator.ts` | Medium |
| P2-2 | `MeshToPoints` ignores Position input | `Ops.ts` / `GeometryEvaluator.ts` | Low |
| P2-3 | `DistributePointsOnFaces` Normal/Rotation outputs | `MeshOps.ts` / `GeometryEvaluator.ts` | Medium |
| P2-4 | `InstanceOnPoints` Pick/Instance Index | `GeometryEvaluator.ts` | Medium |
| P2-5 | `CurveToPoints` tangent/normal/rotation outputs | `MeshOps.ts` | Medium |
| P2-6 | `ResampleCurve` Selection input | `GeometryEvaluator.ts` | Low |
| P2-7 | `ReverseCurve` Selection input | `GeometryEvaluator.ts` | Low |
| P2-8 | `Translate/Rotate/ScaleInstances` Selection + LocalSpace | `GeometryEvaluator.ts` | Medium |
| P2-9 | `FieldOnDomain` proper interpolation | `eval/geometry/Field.ts` | High |
| P2-10 | `GeometryProximity` nearest-surface (not just vertex) | `MeshOps.ts` | High |

### Priority 3 — UI Completeness

| # | Gap | File | Fix Complexity |
|---|-----|------|----------------|
| P3-1 | Inspector panel (sidebar) | `src/ui/Inspector.tsx` (new file) | Medium |
| P3-2 | Per-tree edit persistence in demo | `demo/App.tsx`, `src/ui/store.ts` | Low |
| P3-3 | Proper multi-select / marquee UX | `src/ui/NodeEditor.tsx` | Medium |
| P3-4 | Blender-style theming (full token system) | UI files | High |
| P3-5 | Make-group/Ungroup toolbar buttons | `demo/App.tsx` | Low |

### Priority 4 — Docs Drift

| # | Gap | Fix |
|---|-----|-----|
| P4-1 | ARCHITECTURE.md references non-existent `Inspector.tsx`, `Toolbar.tsx` | Update docs |
| P4-2 | ARCHITECTURE.md says `NodeCategory.ts` — doesn't exist | Update docs |
| P4-3 | ARCHITECTURE.md says `invalidateFrom()` — doesn't exist | Update docs |
| P4-4 | ARCHITECTURE.md says `topoOrder()` throws — it annotates | Update docs |
| P4-5 | README "Architecture at a glance" points `ShaderEvaluator.ts` at TSL | Fix file reference |
| P4-6 | Library build output docs vs `dist-demo/` reality | Update docs or implement |

### Priority 5 — Shader Path Gaps

| # | Gap | Notes |
|---|-----|-------|
| P5-1 | Bump node → full height-to-normal in TSL | Complex |
| P5-2 | Combine/Separate Color HSV/HSL mode in TSL | Medium |
| P5-3 | Legacy ShaderEvaluator stub reduction | Consider removing or clearly scoping |
| P5-4 | World/Light output tree support | Low priority |

### Shims Still Active (Not Bugs, But Documented Approximations)

| Shim | Location | Acceptability |
|------|----------|---------------|
| Legacy ShaderEvaluator texture nodes return placeholder | `ShaderEvaluator.ts` | Acceptable — labelled approximate |
| TSL Bump → pass-through | `TSLShaderEvaluator.ts` | Should be improved |
| `normalField()` for edge/corner domains → face average | `Field.ts` | Needs domain interpolation fix |
| `GeometryProximity` → nearest vertex | `MeshOps.ts` | Major approximation |
| `CurveToPoints` → missing secondary outputs | `MeshOps.ts` | Important for addon compat |
| `DistributePointsOnFaces` Normal output → zero | `GeometryEvaluator.ts` | Common use case |
| `FieldOnDomain` → clamped-index | `GeometryEvaluator.ts` | Should be interpolated |

---

## 15. Implementation Phase Plan

Based on the research intent ("feature-equivalent Blender node system on three.js / R3F") and the current state, the recommended implementation order is:

### Phase 1 — Package + Docs Truth-Alignment (1–2 days)
**Goal:** Make the repo consumable as a library and eliminate doc drift.

1. Fix `ARCHITECTURE.md` — remove `Inspector.tsx`/`Toolbar.tsx`/`NodeCategory.ts` references; fix `invalidateFrom()`, `topoOrder()`, library output, evaluator dispatch.
2. Add library build via `tsup` or `vite lib mode`:
   - Entry points: `src/index.ts` → `dist/index.{esm,cjs}.js` + `.d.ts`
   - Sub-entry: `src/tsl.ts` → `dist/tsl.{esm,cjs}.js` + `.d.ts`
3. Add `"exports"` map to `package.json`.
4. Fix `NodeTree._allTrees` memory leak with `WeakRef` or `dispose()` pattern.
5. Wire per-tree persistence in `useTreeStore` (store `Map<string, NodeTree>`).

### Phase 2 — Geometry Evaluator Semantic Fixes (3–5 days)
**Goal:** Honour declared sockets/properties in the evaluator.

1. `StoreNamedAttribute` Selection field → filter domain elements.
2. `MeshToPoints` Position input → use it instead of raw attribute.
3. `DistributePointsOnFaces` → compute real face normal + rotation outputs from sampled face normals.
4. `InstanceOnPoints` Pick Instance + Instance Index → implement index-based instance selection.
5. `CurveToPoints` tangent/normal/rotation → compute from curve tangent direction.
6. `ResampleCurve` + `ReverseCurve` Selection inputs → apply selection mask.
7. `Translate/Rotate/ScaleInstances` Selection + Local Space.
8. `FieldOnDomain` → proper domain interpolation (POINT→FACE: face average; FACE→POINT: attribute average).

### Phase 3 — Incremental Depsgraph (2–4 days)
**Goal:** Use the dirty set so only dirty nodes are re-evaluated.

1. Add output cache per node: `Map<string /* node.id */, Map<string /* socket.id */, unknown>>`.
2. In each evaluator, check if node is in dirty set; if not, reuse cached outputs.
3. Verify simulation zone semantics still work with caching.
4. Add smoke test for incremental evaluation (property change on one node → only downstream re-runs).

### Phase 4 — UI Inspector + Polish (2–3 days)
**Goal:** Standalone Inspector panel, toolbar buttons, per-tree persistence.

1. `src/ui/Inspector.tsx` — sidebar panel rendering selected node's `Properties`, socket defaults, and metadata (name, label, mute, hide).
2. `demo/App.tsx` Toolbar: wire makeGroup/ungroup buttons.
3. Multi-select marquee: React Flow built-in marquee + keyboard filter.
4. Demo tree-type switching → preserve per-tree trees in `useTreeStore`.
5. Blender dark theme: system CSS variables for category header colors, handle colors, background shades.

### Phase 5 — Shader + TSL Gaps (2–3 days)
**Goal:** Reduce approximate shims in the shader path.

1. TSL Bump → real `perturbNormal` using height field finite differences.
2. TSL Combine/Separate Color HSV/HSL modes → proper HSV↔RGB conversion in TSL.
3. Legacy ShaderEvaluator: clearly label as "WebGL fallback preview, not physically correct."
4. Worked shader-addon example (emitter table extension pattern).
5. Worked compositor-addon example.

### Phase 6 — Compositor Expansion (Optional, 3–5 days)
**Goal:** Expand compositor node coverage.

1. `CompositorNodeDefocus` — bokeh-style blur.
2. `CompositorNodeSunBeams` — radial screen-space rays.
3. `CompositorNodeColorKey` / `CompositorNodeLuminanceKey` — basic matte nodes.
4. `CompositorNodeDilateErode` — dilation/erosion filter.

---

## Summary Verdict

| Dimension | Score | Notes |
|-----------|-------|-------|
| Research fidelity | ★★★★☆ | Correctly identifies Blender's model; some legacy texture scope not implemented |
| Architecture alignment | ★★★☆☆ | Good direction; docs drift; incremental eval + library build missing |
| Core runtime quality | ★★★★★ | Node/Socket/Tree/Interface/Properties/Registry all correct |
| Shader system | ★★★☆☆ | TSL path is real; legacy path is approximate; bump/HSV gaps |
| Geometry system | ★★★★☆ | Field system is genuine; many secondary socket/property gaps in evaluator |
| Zone system | ★★★★★ | All three zone kinds correct; well-tested |
| Compositor | ★★★★☆ | Real WebGL pipeline + CPU verifier; scope < full Blender |
| Texture | ★★★★☆ | Clean sampler-graph; limited to 12 nodes |
| Bridge + addon | ★★★★☆ | BNG round-trip solid; porting path clear |
| UI/Editor | ★★★☆☆ | Functional editor; Inspector/toolbar/theming partial |
| Test coverage | ★★★★★ | 108 tests, all pass; covers all systems |
| Docs | ★★★☆☆ | Research excellent; ARCHITECTURE has drift |
| **Overall** | **★★★★☆** | **Strong prototype. Ready for Phase 1–3 implementation work.** |
