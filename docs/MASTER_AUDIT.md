# Master Audit & Phase Plan — `blender-node-r3f`
_Date: 2026-06-02 | Auditor: Arena Agent_

---

## 1. Executive Summary

The repo is a genuine, unusually broad prototype of a Blender-compatible node runtime for Three.js/R3F. It has:

- A correct core data model (`Node`, `NodeSocket`, `NodeLink`, `NodeTree`, `NodeTreeInterface`).
- Four tree systems with real evaluators.
- 168 registered node classes across all four systems.
- 67 smoke tests passing, strict TypeScript clean, Vite build clean.

However, **the project's own docs claim "M0–M8 fully shipped"** while real inspection reveals a layered set of gaps — ranging from semantic shims to entirely absent features. The intent of the research and architecture is only **~65% realised** in implementation.

---

## 2. What IS Fully Working (Test-Backed)

| Area | Status |
|---|---|
| Core graph API (NodeTree, Node, NodeSocket, NodeLink, NodeTreeInterface) | ✅ Complete |
| Registry (NodeRegistry, NodeCategory) | ✅ Complete |
| Property system (FloatProperty, IntProperty, etc.) + reactive setters | ✅ Complete (post-gap-fix) |
| 16 built-in socket types | ✅ Complete |
| Zone-escape recompute on every topology edit | ✅ Complete (post-gap-fix) |
| Common nodes (Math, VectorMath, Mix, Clamp, MapRange, ColorRamp, CombineSeparate, Logic, Frame, Group) | ✅ Complete |
| Geometry evaluator — mesh primitives, field pipeline, instances, curves, zones | ✅ Strong subset |
| Convex Hull, FlipFaces, AccumulateField, DomainSize, FieldAtIndex | ✅ Present |
| Texture evaluator (sampler, bake, coordinates routing) | ✅ Solid subset |
| Compositor CPU path (pixel-wise, multi-output channels, ColorRamp stops, SplitViewer) | ✅ Solid subset |
| Compositor GLSL/CPU parity (Gamma, BrightContrast) | ✅ Aligned |
| BNG bridge — round-trip output socket defaults, zone state_items, panel hierarchy | ✅ Complete (post-gap-fix) |
| bpy shim + falloff_addon example | ✅ Working |
| Editor operators (History, makeGroup, ungroup, autoLayout) | ✅ Working |
| React Flow editor (nodes, edges, handles, AddMenu, MiniMap) | ✅ Working |
| R3F viewport (mesh, points, curves, instances, shader, compositor, texture) | ✅ Working |

---

## 3. Remaining Gaps — Categorised

### GAP-A: Shader Evaluator Coverage (M1 — HIGH)

**Finding:** Many registered shader nodes fall through to default values in both the legacy `ShaderEvaluator` and `TSLShaderEvaluator`. The README claims "full M1 coverage" but the evaluators only handle a subset.

**Missing in `ShaderEvaluator`:**
- `ShaderNodeBsdfGlass` → no dedicated closure (falls to white Principled)
- `ShaderNodeBsdfTranslucent` / `ShaderNodeBsdfTransparent` → approximate only
- `ShaderNodeBsdfToon` → no toon shading
- `ShaderNodeSubsurfaceScattering` → no SSS
- `ShaderNodeBackground` / `ShaderNodeVolumeScatter` → stub only
- `ShaderNodeValToRGB` (ColorRamp) → not wired in `ShaderEvaluator.executeNode()`
- `ShaderNodeHueSaturation` → not wired
- `ShaderNodeLightPath` → all outputs return 0
- `ShaderNodeObjectInfo` → location/color return zero
- `ShaderNodeCameraData` → not wired
- `ShaderNodeAttribute` → not wired
- `ShaderNodeLayerWeight` → not wired
- `ShaderNodeFresnel` → not wired
- `ShaderNodeUVMap` → not wired
- `ShaderNodeTexCoord` → only UV/Normal, missing Generated/Camera/Object/Window/Reflection
- All shader Texture nodes except Noise: `ShaderNodeTexVoronoi`, `ShaderNodeTexWave`, `ShaderNodeTexChecker`, `ShaderNodeTexBrick`, `ShaderNodeTexGradient`, `ShaderNodeTexMagic`, `ShaderNodeTexWhiteNoise`, `ShaderNodeTexImage`, `ShaderNodeTexEnvironment` — not handled in `ShaderEvaluator`

**Missing in `TSLShaderEvaluator`:**
- `ShaderNodeValToRGB` (ColorRamp) → only black→white, no custom stops
- `ShaderNodeAttribute` → returns `float(0)`
- `ShaderNodeLightPath` → returns `float(0)` / `float(1)` stubs
- `ShaderNodeObjectInfo` → returns zeros
- `ShaderNodeCameraData` → returns zeros
- `ShaderNodeFresnel` → returns `float(0)` (placeholder)
- `ShaderNodeLayerWeight` → returns `float(0)` (placeholder)
- `ShaderNodeUVMap` → not wired (falls to uv() implicit)
- `ShaderNodeTexCoord` → limited to UV/Normal
- All shader textures except Noise/Voronoi: Wave, Checker, Brick, Gradient, Magic, WhiteNoise, Image, Environment → not wired

**Impact:** Users building material graphs with common nodes (image textures, ColorRamp, Fresnel, layer weight) will get silent black/default results.

---

### GAP-B: TSL Shader Evaluator — Missing Emitters (M1 — HIGH)

**Finding:** `TSLShaderEvaluator` does not register emitters for:
- `ShaderNodeBsdfGlass` — emits nothing meaningful
- `ShaderNodeBsdfToon` — emits nothing meaningful
- `ShaderNodeSubsurfaceScattering` — emits nothing meaningful
- `ShaderNodeBackground` — only stub closure (fine for purpose, but should document)
- `ShaderNodeHueSaturation` → not in EMITTERS table
- `ShaderNodeBrightContrast` → not in EMITTERS table
- `ShaderNodeInvert` → not in EMITTERS table (shader system)
- `ShaderNodeGamma` → not in EMITTERS table

---

### GAP-C: Compositor Completeness (M5 — MEDIUM)

**Finding:** Several documented M5 compositor nodes are incomplete or have semantic issues.

1. **`CompositorNodeZCombine`** — declared but `cpuComposite` returns the `Image` input unchanged (no real Z-buffer combine logic).
2. **`CompositorNodeSplitViewer`** — CPU path checks boundary correctly, but GPU/planner path does not composite two images side-by-side; it only renders to the viewer target as a single image.
3. **`CompositorNodeColorBalance`** — declared in the node list but has NO entry in `PIXEL_EMITTERS` and no CPU path.
4. **`CompositorNodeHueCorrect`** — declared but not in `PIXEL_EMITTERS`.
5. **`CompositorNodeTonemap`** — declared but not in `PIXEL_EMITTERS`.
6. **`CompositorNodeDespeckle`** — declared but not in `KernelShaders`.
7. **`CompositorNodeSunBeams`** — declared but not in `KernelShaders`.
8. **GPU Crop kernel** — `CropProgram` exists but `crop.x1, crop.y1, crop.x2, crop.y2` property names don't match what `CompositorNodeCrop` declares (`x_min, y_min, x_max, y_max`).
9. **Constant materialization at kernel boundaries** — if an `INPUT_CONST` (VALUE/COLOR) feeds a KERNEL op, the GPU path looks for a WebGL texture but gets a constant `Result`; this correctly emits the default color since `ensureImageResult()` handles it, but the logic is fragile and not tested for multi-channel kernel inputs.

---

### GAP-D: Texture Evaluator — Image Resource (M6 — LOW-MEDIUM)

**Finding:** `TextureNodeImage` returns a UV gradient placeholder (correct headlessly). But:
- No resource resolver API for `TextureEvaluator` analogous to `CompositorEvaluator.resolveTexture`.
- `TextureNodeValToRGB` (ColorRamp) evaluates only linear black→white (ignores stops).

---

### GAP-E: Geometry — Missing / Approximated Operations (M2/M3 — LOW)

**Finding (minor):** Several geometry ops have simplified implementations:
- `GeometryNodeMeshBoolean` — not registered (documented as out-of-scope, but README doesn't clearly say so).
- `GeometryNodeSubdivideCurve` — declared but evaluator uses resample fallback.
- `GeometryNodeFillCurve` / `GeometryNodeFilletCurve` — declared but evaluator has no implementation (returns empty geometry).
- `GeometryNodeSampleCurve` — declared but not in evaluator switch.
- Foreach Element Zone — selection filtering exists in node declaration but `ZoneRunner` ignores the Selection input (uses all elements).

---

### GAP-F: UI Chrome (M8 — MEDIUM)

**Finding:** Documented in ROADMAP.md as incomplete. Actual gaps:

1. **Copy / Paste** — not implemented. No keyboard shortcut for `Ctrl+C` / `Ctrl+V`.
2. **Multi-select marquee** — React Flow supports it natively but the `onNodesChange` handler doesn't batch-remove selected nodes or handle multi-select well.
3. **Search palette** — Shift+A opens category-list AddMenu but no live search/filter input.
4. **Keyboard shortcuts** — `G` (grab/move), `X`/`Delete` (confirm delete), `M` (mute), `H` (hide), `N` (properties panel) — none wired.
5. **Inspector / Properties panel** — `BlenderNode.tsx` renders inline property editors inline per-node but there is no separate floating Inspector panel.
6. **Toolbar wiring** — `makeGroup`, `ungroup`, `autoLayout`, `History.undo/redo` are implemented as headless functions in `operators.ts` but are NOT wired to any UI button or keyboard shortcut in `NodeEditor.tsx`.
7. **Tree picker (4-system switcher)** — `App.tsx` has a tab bar but it's hardcoded; switching trees re-builds the demo tree, discarding any user edits.

---

### GAP-G: Package / Build / Library (M0 — LOW-MEDIUM)

**Finding:**

1. `package.json` has `"main": "src/index.ts"` — this only works as a Vite/TSX source project. There is no `dist/` library build, no `exports` field, no `.d.ts` declarations emitted.
2. **No CI** — no GitHub Actions / CI scripts for `typecheck / test / build`.
3. **npm audit** — 2 moderate vulnerabilities outstanding; `three-mesh-bvh@0.7.8` is deprecated.
4. **Bundle size** — demo bundle ~2.3 MB (636 KB gzip); tree-shakeable sub-entries not set up.

---

### GAP-H: Depsgraph — Incremental Evaluation (M0 — LOW)

**Finding:** The depsgraph computes dirty node sets correctly but all evaluators do a full topo-walk on every call. True incremental evaluation (re-running only dirty nodes and their downstream) is not implemented. This is fine for the demo, but the README implies it works incrementally.

---

### GAP-I: Cycle Detection & Reporting (M0 — LOW)

**Finding:** `NodeTree.topoOrder()` silently returns a partial order when cycles exist (noted in the code comment: "a cycle — return partial order; evaluator will report"). But evaluators do NOT report the cycle — they just silently evaluate whatever they can. Users get mysterious silent failures.

---

## 4. Phase Implementation Plan

We will implement in **7 phases**, smallest blast-radius first.

### Phase 1 — Core Hardening (GAP-H/I + docs sync)
- Wire cycle detection to surface errors in `EvaluationResult.errors`.
- Document full-evaluation-always behavior clearly.
- Update ROADMAP.md to accurately reflect shipped vs. planned.

### Phase 2 — UI Wiring (GAP-F)
- Add live search/filter to AddMenu (Shift+A).
- Wire `History.undo/redo` to toolbar buttons (Ctrl+Z / Ctrl+Y).
- Wire `autoLayout` to a toolbar button.
- Wire `makeGroup` to a toolbar button (for selected nodes).
- Add `G`/`X`/`M`/`H` keyboard shortcuts.
- Improve multi-select delete in `onNodesChange`.
- Add inline copy/paste (Ctrl+C / Ctrl+V via JSON clone).

### Phase 3 — Shader Coverage (GAP-A/B)
- Add missing `ShaderEvaluator.executeNode()` cases: ColorRamp, HueSaturation, BrightContrast, Invert, Gamma, TexVoronoi, TexWave, TexChecker, TexGradient, TexMagic, TexWhiteNoise, TexImage (placeholder), TexEnvironment (placeholder), Fresnel, LayerWeight, LightPath, ObjectInfo, TexCoord (full modes), UVMap, Attribute.
- Add missing `TSLShaderEvaluator` EMITTERS: same list, TSL versions.
- Mark approximated nodes clearly with `/* TSL APPROX */` comments.

### Phase 4 — Compositor Completion (GAP-C)
- Add `PIXEL_EMITTERS` for: `ColorBalance`, `HueCorrect`, `Tonemap`.
- Fix `CropProgram` property name mismatch (`x1/y1/x2/y2` vs `x_min/y_min/x_max/y_max`).
- Improve `ZCombine` CPU path with proper Z-buffer merge logic.
- Implement `SplitViewer` GPU split composition.
- Add `Despeckle` and `SunBeams` kernel stubs (documented as limited).

### Phase 5 — Texture Completion (GAP-D)
- Add resource resolver API to `TextureEvaluator` (`resolveImage?: (key: string) => ImageData | null`).
- Fix `TextureNodeValToRGB` to respect configured stops (reuse the common ColorRamp logic).

### Phase 6 — Geometry Polish (GAP-E)
- Wire `ForeachElement` selection filtering in `ZoneRunner`.
- Add evaluator stubs for `FillCurve`, `FilletCurve`, `SubdivideCurve`, `SampleCurve` with documented approximation notes.
- Mark `MeshBoolean` as "out of scope (WebAssembly WASM CSG required)" in docs.

### Phase 7 — Library Build + CI (GAP-G)
- Add `vite.config.ts` library mode entry point.
- Add `exports` field to `package.json`.
- Add `.github/workflows/ci.yml` for typecheck + test + build.
- Address npm audit moderate vulnerabilities.

---

## 5. File-Level Gap Registry

| File | Gap ID | Description |
|---|---|---|
| `src/eval/ShaderEvaluator.ts` | GAP-A | 15+ node types fall through to defaults |
| `src/eval/tsl/TSLShaderEvaluator.ts` | GAP-B | 15+ EMITTER slots missing |
| `src/eval/compositor/PixelGLSL.ts` | GAP-C | ColorBalance, HueCorrect, Tonemap emitters missing |
| `src/eval/compositor/KernelShaders.ts` | GAP-C | Despeckle, SunBeams missing; Crop property mismatch |
| `src/eval/compositor/CompositorEvaluator.ts` | GAP-C | SplitViewer GPU path incomplete |
| `src/eval/compositor/CpuComposite.ts` | GAP-C | ZCombine uses placeholder logic |
| `src/eval/TextureEvaluator.ts` | GAP-D | No image resolver; ColorRamp ignores stops |
| `src/eval/zones/ZoneRunner.ts` | GAP-E | Foreach selection not applied |
| `src/eval/GeometryEvaluator.ts` | GAP-E | FillCurve, FilletCurve, SampleCurve not in switch |
| `src/core/NodeTree.ts` | GAP-I | Cycle detection silent |
| `src/ui/NodeEditor.tsx` | GAP-F | No keyboard shortcuts, no operator wiring |
| `src/ui/AddMenu.tsx` | GAP-F | No live search/filter |
| `src/ui/operators.ts` | GAP-F | Not connected to UI |
| `package.json` | GAP-G | No library exports/build |
| `docs/ROADMAP.md` | All | Claims overstated |

---

## 6. Test Coverage Plan (to accompany each phase)

For each phase we will add smoke tests:

- **Phase 1**: `cycle detection emits error in EvaluationResult`
- **Phase 2**: UI operators (keyboard shortcuts require browser — add headless wiring tests)
- **Phase 3**: shader — every newly-wired node produces non-default output
- **Phase 4**: compositor CPU — ColorBalance, HueCorrect, ZCombine, SplitViewer GPU-plan shape
- **Phase 5**: texture — image resolver called; ColorRamp custom stops work
- **Phase 6**: zone — foreach with selection=false skips elements; FillCurve returns non-null geometry
- **Phase 7**: CI script exists and passes

---

_This document is the authoritative baseline. Each phase below will reference it._
