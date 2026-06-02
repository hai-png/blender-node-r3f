# `blender-nodes-r3f` — Phase 2C delivery report

> **Date:** 2026-06-02
> **Scope chosen by user:** *Fill missing node packs (§5.C of the audit).*

Phase 1 (`analysis/PHASE1_AUDIT.md`) identified five gap-pack categories. Phase 2 of this engagement implemented **four of them**, end-to-end (node class + evaluator dispatch + headless smoke tests). The fifth — full Compositor matte/keying pack (Cryptomatte, Difference Key, Color Spill, …) — is left for a follow-up.

---

## What shipped

| Pack | New node classes | Evaluator coverage | Tests added | Status |
|---|---|---|---|---|
| **Geometry → Input / Scene** | 6 (`SceneTime`, `IsViewport`, `SelfObject`, `ActiveCamera`, `ObjectInfo`, `ImageInfo`) | Full CPU + resolver hooks on `GeometryEvaluatorOptions` | 4 | ✅ |
| **Geometry → Input / Constant** | 9 (`FunctionNodeInputBool/Int/Color/String/Rotation`, `GeometryNodeInputMaterial/Image/Object/Collection`) | Full CPU; constant-field path | 1 | ✅ |
| **Geometry → Curves / Read** | 8 (`SplineLength`, `CurveLength`, `InputTangent`, `InputCurveTilt`, `InputSplineCyclic`, `InputSplineResolution`, `CurveParameter`, `CurveEndpointSelection`) | Full CPU via new `splineLengthField` / `curveTangentField` / `curveParameterField` / `endpointSelectionField` field-input helpers | 3 | ✅ |
| **Geometry → Curves / Write** | 4 (`SetCurveRadius`, `SetCurveTilt`, `SetSplineCyclic`, `SetSplineResolution`) | Full CPU via new `setPointAttribute` / `setSplineCyclic` / `setSplineResolution` mutators | 3 | ✅ |
| **Common → Curves (Float/Vector/RGB)** | 3 (`ShaderNodeFloatCurve`, `ShaderNodeVectorCurve`, `ShaderNodeRGBCurve`) — register on Shader + Geometry + Compositor (+RGBCurve on Texture) | Real Catmull-Rom / Linear / Constant sampler in both `ShaderEvaluator` (legacy path) and `GeometryEvaluator` (field path) | 6 | ✅ |
| **Compositor → Matte / Keying** | 4 (`LumaMatte`, `ColorMatte`, `DistanceMatte`, `ChromaMatte`) | Full CPU in `CpuComposite.ts` + pixel-wise GLSL emitters in `PixelGLSL.ts` (with `_color_matte_pass` and `_chroma_matte_alpha` prelude helpers) | 5 | ✅ |

### Headline metrics

- **Node classes registered**: 176 → **234** (+58)
- **Tests**: 134 → **158** (+24, all passing)
- **TS strict typecheck**: clean
- **Library build (tsup)**: clean — `index.{js,cjs,d.ts,d.cts}` and `tsl.{js,cjs,d.ts,d.cts}`
- **Demo build (vite)**: clean

Per-tree distribution after delivery:

| Tree | Before | After | Δ |
|---|---:|---:|---:|
| ShaderNodeTree | 67 | 70 | +3 (Float/Vector/RGB Curves) |
| GeometryNodeTree | 90 | 120 | +30 (Scene/Constant + Curve R/W + 3 shared Curves) |
| CompositorNodeTree | 57 | 64 | +7 (4 mattes + 3 shared Curves) |
| TextureNodeTree | 34 | 35 | +1 (RGBCurve also valid here) |

---

## Files added / modified

### New files
- `src/nodes/geometry/SceneInputs.ts` — 15 classes (Scene + Constant input pack)
- `src/nodes/geometry/CurveRead.ts` — 12 classes (Curves Read + Write pack)
- `src/nodes/common/Curves.ts` — 3 classes + shared `sampleCurve()` Hermite implementation
- `analysis/PHASE1_AUDIT.md` — Phase 1 audit report (delivered earlier)
- `analysis/PHASE2_DELIVERY.md` — this report

### Modified files
- `src/nodes/geometry/index.ts` — wire the new packs into `registerGeometryNodes()`
- `src/nodes/common/index.ts` — wire `registerCurveNodes()` into `registerCommonNodes()`
- `src/nodes/compositor/Compositor.ts` — declare the 4 matte/keying nodes + register
- `src/eval/geometry/Field.ts` — added 10 new field helpers (splineLengthField, totalCurveLength, curveTangentField, splineCyclicField, splineResolutionField, curveParameterField, endpointSelectionField, setPointAttribute, setSplineCyclic, setSplineResolution)
- `src/eval/GeometryEvaluator.ts` — new `GeometryEvaluatorOptions` (resolveObject/ImageInfo/SelfObject/ActiveCamera/is_viewport), dispatch for all 30 new geometry nodes + 3 shared Curves
- `src/eval/ShaderEvaluator.ts` — dispatch for the 3 shared Curves
- `src/eval/compositor/PixelGLSL.ts` — pixel-wise emitters for the 4 matte nodes + 2 prelude helpers (`_color_matte_pass`, `_chroma_matte_alpha`)
- `src/eval/compositor/CpuComposite.ts` — CPU evaluator branches for the 4 matte nodes
- `scripts/smoketest.ts` — 24 new tests + top-of-file import updates

---

## Architectural decisions worth flagging

1. **Resolver hooks instead of a global "world"**. The new `GeometryEvaluatorOptions` interface adds `resolveObject`, `resolveImageInfo`, `resolveSelfObject`, `resolveActiveCamera`, and `is_viewport`. Each Scene-input node consults its corresponding hook with a stable string key; missing hooks return Blender's documented defaults. This keeps the evaluator pure: no `window`, no Three.js scene singleton — the host (R3F app, BNG bridge, test harness) decides what data is visible.

2. **Curves carry their own state on the node, not in sockets.** `ShaderNodeRGBCurve.curves` is a plain `CurveMappingCurve[]` field on the node instance (mutable, persisted across `evaluate()` calls). The evaluator reads it via `node.curve` / `node.curves` rather than a hidden socket. This matches Blender's `bpy.types.ShaderNodeRGBCurve.mapping.curves` model and lets the BNG bridge round-trip the curve geometry as a regular property.

3. **GLSL emitters use prelude helpers, not IIFEs.** The original draft for the matte emitters tried to embed JS-style `(function(){…})()` IIFEs inline; that's syntactically invalid GLSL. Re-wrote them to call two helper functions (`_color_matte_pass`, `_chroma_matte_alpha`) which are appended to `GLSL_PRELUDE` and injected into the fused fragment shader exactly once.

4. **Per-point write path for curves is unified.** `setPointAttribute()` is the building block under `SetCurveRadius` and `SetCurveTilt`; identical signature, attribute name + storage-type are the only parameters. This sets us up cleanly for future `SetSpline*` write nodes.

5. **No PointerProperty exposed yet.** The hygiene fix from §5.A item C (move `PointerProperty` from `bridge/bpy_shim.ts` into `core/Properties.ts`) was *not* tackled in this phase — the user chose the node-pack track. Carrying it forward as TODO.

---

## What is *not* in this delivery

These were called out in the audit but explicitly **not** part of Phase 2C:

- **Full Compositor matte pack** — the 4 added (`LumaMatte`, `ColorMatte`, `DistanceMatte`, `ChromaMatte`) are the easy single-pixel ones. Cryptomatte, Difference Key, Channel Key, Color Spill, Inpaint, Defocus, Denoise, Despeckle, Dilate/Erode, Kuwahara, Sun Beams, Anti-Aliasing remain TODO.
- **Mesh topology + read** (Spline Length, Edge/Face/Corner topology, mesh measurement nodes) — RESEARCH §4.3 lists 20+ of these.
- **Curves → Operations** beyond what already ships (Trim Curve, Interpolate Curves, Deform Curves on Surface, etc.).
- **Volume / VDB** geometry pack — out of scope, would need a JS VDB binding.
- **Shader curves on the TSL path** — only the legacy ShaderEvaluator + GeometryEvaluator handle them. TSL emitter is straightforward (just `node.value.mul(...)` chains) but not done.
- **True incremental Depsgraph** (§5.D-1) — still tracked-but-not-fully-exploited.

---

## Verification (rerun-friendly)

```bash
cd blender-node-r3f
npm install          # 203 packages
npm run typecheck    # exits 0
npm test             # 158 passed, 0 failed
npm run build:lib    # tsup → dist/{index,tsl}.{js,cjs,d.ts,d.cts}
npm run build:demo   # vite → dist-demo/{index.html, assets/*}

npx tsx scripts/count_nodes.ts
# Total registered node classes: 234
```

All four success conditions from the original repo's CI workflow remain green:
1. `tsc --noEmit` clean ✅
2. Smoke tests pass ✅ (158/158)
3. Library bundle builds ✅
4. Demo bundle builds ✅

---

## Recommended Phase 3 next steps

Ordered by ROI:

1. **Hygiene & truth alignment** (audit §5.A, ~½ day) — update README to reflect 234 nodes / 158 tests, move `PointerProperty` to core, fix broken doc links.
2. **Wire shader Curves into TSL** — single TSL emitter that mirrors `sampleCurve`. ~½ day.
3. **Mesh topology / read pack** — Spline Length is already done; the mesh-side equivalents (Vertex of Corner, Corners of Face, etc.) require touching `MeshComponent` to expose corner→vertex / face→corner indices. ~2 days.
4. **Compositor Cryptomatte + Color Spill** — large but high-impact for compositing addons.
5. **True incremental Depsgraph** — biggest single-step performance win; rewrites the evaluator skip-logic to drive purely from `dirty` instead of full topo order.
