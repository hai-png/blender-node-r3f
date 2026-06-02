# Phase 3 — Shader Parity Progress
_Date: 2026-06-02_

This document records the next closure pass after the geometry phase.

## Scope completed in this pass

### 1. Legacy `ShaderEvaluator` now executes the previously missing shared/common shader-tree nodes
Added execution support for:
- `FunctionNodeBooleanMath`
- `FunctionNodeCompare`
- `GeometryNodeSwitch`
- `FunctionNodeRandomValue`
- `ShaderNodeCombineColor`
- `ShaderNodeSeparateColor`

Notes:
- `CombineColor` / `SeparateColor` now support RGB plus approximate HSV/HSL handling in the legacy path
- `RandomValue` now produces deterministic outputs through the shared hash logic and populates all relevant outputs

### 2. `TSLShaderEvaluator` now has emitters for the previously missing shared/common shader-tree nodes
Added TSL emitters for:
- `FunctionNodeBooleanMath`
- `FunctionNodeCompare`
- `GeometryNodeSwitch`
- `FunctionNodeRandomValue`
- `ShaderNodeCombineColor`
- `ShaderNodeSeparateColor`

Notes:
- this closes the concrete emitter-coverage gap identified in the systematic audit
- `CombineColor` / `SeparateColor` in TSL are currently implemented with an RGB-first approximation
- the key improvement here is that they are now **real executable nodes** in the TSL path rather than falling back to literal defaults

## Files changed
- `src/eval/ShaderEvaluator.ts`
- `src/eval/tsl/TSLShaderEvaluator.ts`
- `scripts/smoketest.ts`

## Verification
All project checks still pass after this change:
- `npm run typecheck` ✅
- `npm test` ✅ `98 passed / 0 failed`
- `npm run build` ✅

## New test coverage
Added shader-parity smoke tests for:
- legacy `Compare + BooleanMath + Switch`
- legacy `CombineColor + SeparateColor`
- legacy `RandomValue`
- TSL common logic emitters
- TSL common color emitters
- TSL common random emitter

## Result
This pass materially reduces the shader-tree registry/evaluator mismatch and closes the most obvious missing common-node support in both shader paths.

## Remaining likely next steps
Most important remaining cross-tree closure work is now:
- compositor/tree shared-node support mismatch
- texture/tree shared-node support mismatch
- remaining shader semantic fidelity improvements where current implementations are still approximations
