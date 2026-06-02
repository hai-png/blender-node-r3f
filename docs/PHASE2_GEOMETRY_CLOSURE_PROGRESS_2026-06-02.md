# Phase 2 — Geometry Closure Progress
_Date: 2026-06-02_

This document tracks the first implementation tranche of the geometry-closure phase.

## Scope completed in this pass

### 1. `GeometryNodeSubdivideCurve` is now implemented
Previously this node was a pure pass-through stub.

It now:
- inserts `Cuts` evenly-spaced points into every poly-curve segment
- supports open and cyclic curves
- preserves per-curve offsets/cyclic flags
- scales stored curve resolution metadata with subdivision density

Current implementation target:
- the repo's present **poly-curve representation**
- not Blender's full Bezier/NURBS subdivision semantics yet

### 2. `GeometryNodeSampleCurve` now has an executable implementation
Previously it emitted constant zero/default fields.

It now produces real field outputs for:
- `Position`
- `Tangent`
- `Normal`
- `Value`
- `Index`
- `Curve Index`

Current behaviour:
- samples the current poly-curve representation at a normalized factor
- evaluates the incoming `Value` field on the input curve's point domain
- linearly interpolates sampled scalar values between sampled segment endpoints
- computes a stable tangent and a derived normal
- for multi-curve inputs, partitions `[0,1]` evenly across curve count, then samples locally within the selected curve

This is a useful, executable approximation and a clear improvement over the former stub, while still leaving room for Blender-faithful refinement later.

### 3. `GeometryNodeFilletCurve` now has a limited poly-curve implementation
Previously this node was a pass-through stub.

It now:
- rounds poly-curve corners by trimming adjacent segments
- inserts an approximated circular arc at each valid corner
- supports open and cyclic poly-curves

Current implementation target:
- poly-curve corners only
- fixed arc tessellation derived from corner angle
- not Blender's full spline-handle / richer curve-type semantics yet

### 4. `GeometryNodeFillCurve` now has a limited planar fill implementation
Previously this node returned empty geometry.

It now:
- fills simple planar closed poly-curves into a mesh
- uses ear clipping triangulation
- supports multiple independent closed curves as separate filled islands

Current implementation limits:
- no hole handling yet
- no self-intersection handling
- expects simple planar loops

### 5. Geometry-tree shader texture nodes are now executable
Previously the geometry tree registered a broad set of shader texture nodes,
but `GeometryEvaluator` did not execute them.

The following are now supported as geometry-field producers:
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

Notes:
- these evaluate as field-like outputs inside `GeometryEvaluator`
- `ShaderNodeTexImage` now supports an optional `resolveImage(imageSrc)` hook on `GeometryEvaluator`
- `ShaderNodeTexEnvironment` reuses the same image resolver path with equirectangular-style sampling
- current behaviour is an executable approximation aimed at parity closure, not pixel-perfect Blender equivalence

## Files changed
- `src/eval/geometry/MeshOps.ts`
- `src/eval/GeometryEvaluator.ts`
- `src/nodes/geometry/Ops.ts`
- `scripts/smoketest.ts`

## Verification
All project checks still pass after this change:
- `npm run typecheck` ✅
- `npm test` ✅ `92 passed / 0 failed`
- `npm run build` ✅

## New/updated test coverage
Updated smoke tests now verify:
- `FillCurve` fills a planar closed curve into a mesh
- `FilletCurve` adds points around poly-curve corners
- `SampleCurve` samples position/value along a line
- `SubdivideCurve` inserts evenly-spaced cuts per segment
- all registered geometry-tree shader texture nodes evaluate without throw
- geometry image resolver integration is called when `ShaderNodeTexImage.image_src` is set

## Remaining geometry-closure items
Still open:
- richer `FilletCurve` semantics for non-poly spline types
- richer `FillCurve` semantics for holes / nested loops / complex polygons
- possible future fidelity upgrades for `SampleCurve` multi-curve semantics and richer curve attribute propagation
- possible future fidelity upgrades for procedural texture exactness versus Blender
