/**
 * CommonExecutors — shared executor functions for all common nodes.
 *
 * These replace the duplicated instanceof chains in ShaderEvaluator and
 * GeometryEvaluator. Each executor reads inputs from the cache via ctx,
 * computes the result, and writes outputs back to the cache.
 *
 * Evaluators should call `registerCommonExecutors()` during bootstrap.
 * They can then call `dispatchNode()` which routes to the right function
 * by bl_idname, falling back to evaluator-specific handlers for system-
 * specific nodes (BSDFs, geo ops, etc.).
 */
import type { ValueCache, ExecCtx } from './NodeExecute';
import { registerExecutor } from './NodeExecute';
import type { Node } from '../core/Node';
import type { Vec3, RGBA } from '../core/types';
import { rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb } from './MathLib';

import { ValueNode, RGBNode, VectorNode } from '../nodes/common/Value';
import { MathNode } from '../nodes/common/Math';
import { VectorMathNode } from '../nodes/common/VectorMath';
import { MixNode } from '../nodes/common/MixColor';
import { MapRangeNode } from '../nodes/common/MapRange';
import { ClampNode } from '../nodes/common/Clamp';
import { ColorRampNode } from '../nodes/common/ColorRamp';
import { CombineXYZNode, SeparateXYZNode, CombineColorNode, SeparateColorNode } from '../nodes/common/CombineSeparate';
import { BooleanMathNode, CompareNode, RandomValueNode, SwitchNode } from '../nodes/common/Logic';
import { ShaderNodeFloatCurve, ShaderNodeVectorCurve, ShaderNodeRGBCurve } from '../nodes/common/Curves';
import { RerouteNode, NodeGroupInput, NodeGroupOutput } from '../nodes/common';
import { NodeGroupBase } from '../nodes/common/Group';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Resolve an input socket to a typed value, with fallback. */
function inp<T>(node: Node, name: string, cache: ValueCache, ctx: ExecCtx, fallback: T): T {
  const sock = node.inputs.find((s) => s.name === name || s.identifier === name);
  if (!sock) return fallback;
  const v = ctx.socketValue(sock, cache);
  if (v === undefined || v === null) return fallback;
  return v as T;
}

/** Write a value to an output socket by name or identifier. */
function out(node: Node, name: string, cache: ValueCache, value: unknown): void {
  const sock = node.outputs.find((s) => s.name === name || s.identifier === name);
  if (sock) cache.set(sock.id, value);
}

// ─── Registration ────────────────────────────────────────────────────────

let _registered = false;

export function registerCommonExecutors(): void {
  if (_registered) return;
  _registered = true;

  // Value nodes
  registerExecutor(ValueNode.bl_idname, (node, cache, ctx) => {
    out(node, 'Value', cache, (node as unknown as { value: number }).value);
  });

  registerExecutor(RGBNode.bl_idname, (node, cache, ctx) => {
    out(node, 'Color', cache, [...(node as unknown as { rgb: RGBA }).rgb]);
  });

  registerExecutor(VectorNode.bl_idname, (node, cache, ctx) => {
    out(node, 'Vector', cache, [...(node as unknown as { vector: Vec3 }).vector]);
  });

  // Math
  registerExecutor(MathNode.bl_idname, (node, cache, ctx) => {
    const a = inp<number>(node, 'A', cache, ctx, 0);
    const b = inp<number>(node, 'B', cache, ctx, 0);
    const c = inp<number>(node, 'C', cache, ctx, 0);
    const mn = node as unknown as { operation: string; use_clamp: boolean };
    out(node, 'Value', cache, MathNode.compute(
      mn.operation as any, a, b, c, mn.use_clamp,
    ));
  });

  // Vector Math
  registerExecutor(VectorMathNode.bl_idname, (node, cache, ctx) => {
    const a = inp<Vec3>(node, 'A', cache, ctx, [0, 0, 0]);
    const b = inp<Vec3>(node, 'B', cache, ctx, [0, 0, 0]);
    const c = inp<Vec3>(node, 'C', cache, ctx, [0, 0, 0]);
    const s = inp<number>(node, 'Scale', cache, ctx, 1);
    const mn = node as unknown as { operation: string };
    const r = VectorMathNode.compute(mn.operation as any, a, b, c, s);
    out(node, 'Vector', cache, r.vec);
    out(node, 'Value', cache, r.val);
  });

  // Mix
  registerExecutor(MixNode.bl_idname, (node, cache, ctx) => {
    const mn = node as unknown as { data_type: string; blend_type: string };
    const f = inp<number>(node, 'Factor', cache, ctx, 0.5);
    if (mn.data_type === 'FLOAT') {
      const a = inp<number>(node, 'A', cache, ctx, 0);
      const b = inp<number>(node, 'B', cache, ctx, 0);
      out(node, 'Result', cache, MixNode.mixFloat(a, b, f));
    } else if (mn.data_type === 'VECTOR') {
      const a = inp<Vec3>(node, 'A_Vector', cache, ctx, [0, 0, 0]);
      const b = inp<Vec3>(node, 'B_Vector', cache, ctx, [0, 0, 0]);
      out(node, 'Result_Vector', cache, MixNode.mixVec(a, b, f));
    } else {
      const a = inp<RGBA>(node, 'A_Color', cache, ctx, [0.5, 0.5, 0.5, 1]);
      const b = inp<RGBA>(node, 'B_Color', cache, ctx, [0.5, 0.5, 0.5, 1]);
      out(node, 'Result_Color', cache, MixNode.mixColor(a, b, f, mn.blend_type as any));
    }
  });

  // Map Range
  registerExecutor(MapRangeNode.bl_idname, (node, cache, ctx) => {
    const mn = node as unknown as {
      data_type: string; interpolation_type: string; clamp: boolean;
    };
    if (mn.data_type === 'FLOAT_VECTOR') {
      const v = inp<Vec3>(node, 'Value', cache, ctx, [1, 1, 1]);
      const fmn = inp<Vec3>(node, 'From Min', cache, ctx, [0, 0, 0]);
      const fmx = inp<Vec3>(node, 'From Max', cache, ctx, [1, 1, 1]);
      const tmn = inp<Vec3>(node, 'To Min', cache, ctx, [0, 0, 0]);
      const tmx = inp<Vec3>(node, 'To Max', cache, ctx, [1, 1, 1]);
      const steps = inp<number>(node, 'Steps', cache, ctx, 4);
      out(node, 'Vector', cache, MapRangeNode.computeVec(
        v, fmn, fmx, tmn, tmx, steps, mn.interpolation_type as any, mn.clamp,
      ));
    } else {
      const v = inp<number>(node, 'Value', cache, ctx, 1);
      const fmn = inp<number>(node, 'From Min', cache, ctx, 0);
      const fmx = inp<number>(node, 'From Max', cache, ctx, 1);
      const tmn = inp<number>(node, 'To Min', cache, ctx, 0);
      const tmx = inp<number>(node, 'To Max', cache, ctx, 1);
      const steps = inp<number>(node, 'Steps', cache, ctx, 4);
      out(node, 'Result', cache, MapRangeNode.computeFloat(
        v, fmn, fmx, tmn, tmx, steps, mn.interpolation_type as any, mn.clamp,
      ));
    }
  });

  // Clamp
  registerExecutor(ClampNode.bl_idname, (node, cache, ctx) => {
    const v = inp<number>(node, 'Value', cache, ctx, 1);
    const mn = inp<number>(node, 'Min', cache, ctx, 0);
    const mx = inp<number>(node, 'Max', cache, ctx, 1);
    const cn = node as unknown as { clamp_type: string };
    out(node, 'Result', cache, ClampNode.compute(v, mn, mx, cn.clamp_type as any));
  });

  // Color Ramp
  registerExecutor(ColorRampNode.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { stops: ColorRampNode['stops']; interpolation: ColorRampNode['interpolation'] };
    const t = inp<number>(node, 'Fac', cache, ctx, 0.5);
    const c = ColorRampNode.sample(cn.stops, cn.interpolation, t);
    out(node, 'Color', cache, c);
    out(node, 'Alpha', cache, c[3]);
  });

  // Combine XYZ
  registerExecutor(CombineXYZNode.bl_idname, (node, cache, ctx) => {
    const x = inp<number>(node, 'X', cache, ctx, 0);
    const y = inp<number>(node, 'Y', cache, ctx, 0);
    const z = inp<number>(node, 'Z', cache, ctx, 0);
    out(node, 'Vector', cache, [x, y, z] as Vec3);
  });

  // Separate XYZ
  registerExecutor(SeparateXYZNode.bl_idname, (node, cache, ctx) => {
    const v = inp<Vec3>(node, 'Vector', cache, ctx, [0, 0, 0]);
    out(node, 'X', cache, v[0]);
    out(node, 'Y', cache, v[1]);
    out(node, 'Z', cache, v[2]);
  });

  // Combine Color
  registerExecutor(CombineColorNode.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { mode: string };
    const r = inp<number>(node, 'Red', cache, ctx, 0);
    const g = inp<number>(node, 'Green', cache, ctx, 0);
    const b = inp<number>(node, 'Blue', cache, ctx, 0);
    let result: RGBA;
    switch (cn.mode) {
      case 'HSV': {
        const [rv, gv, bv] = hsvToRgb(r, g, b);
        result = [rv, gv, bv, 1];
        break;
      }
      case 'HSL': {
        const [rv, gv, bv] = hslToRgb(r, g, b);
        result = [rv, gv, bv, 1];
        break;
      }
      default:
        result = [r, g, b, 1];
    }
    out(node, 'Color', cache, result);
  });

  // Separate Color
  registerExecutor(SeparateColorNode.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { mode: string };
    const c = inp<RGBA>(node, 'Color', cache, ctx, [1, 1, 1, 1]);
    let a = c[0], b = c[1], d = c[2];
    if (cn.mode === 'HSV') [a, b, d] = rgbToHsv(c[0], c[1], c[2]);
    else if (cn.mode === 'HSL') [a, b, d] = rgbToHsl(c[0], c[1], c[2]);
    out(node, 'Red', cache, a);
    out(node, 'Green', cache, b);
    out(node, 'Blue', cache, d);
  });

  // Boolean Math
  registerExecutor(BooleanMathNode.bl_idname, (node, cache, ctx) => {
    const bn = node as unknown as { operation: string };
    const a = !!inp<boolean>(node, 'Boolean', cache, ctx, false);
    const b2 = !!(node.inputs[1] ? ctx.socketValue(node.inputs[1], cache) : false);
    out(node, 'Boolean', cache, BooleanMathNode.compute(bn.operation as any, a, b2));
  });

  // Compare (Float / Int / Vector / Color)
  registerExecutor(CompareNode.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { operation: string; data_type: string };
    const eps = inp<number>(node, 'Epsilon', cache, ctx, 0);
    let result = false;
    switch (cn.data_type) {
      case 'INT': {
        const a = inp<number>(node, 'A', cache, ctx, 0) | 0;
        const b = inp<number>(node, 'B', cache, ctx, 0) | 0;
        result = CompareNode.compute(cn.operation as any, a, b, 0);
        break;
      }
      case 'VECTOR': {
        const a = inp<Vec3>(node, 'A', cache, ctx, [0, 0, 0]);
        const b = inp<Vec3>(node, 'B', cache, ctx, [0, 0, 0]);
        result = CompareNode.computeVec(cn.operation as any, a, b, eps);
        break;
      }
      case 'RGBA': {
        const a = inp<RGBA>(node, 'A', cache, ctx, [0, 0, 0, 1]);
        const b = inp<RGBA>(node, 'B', cache, ctx, [0, 0, 0, 1]);
        result = CompareNode.computeColor(cn.operation as any, a, b, eps);
        break;
      }
      case 'STRING': {
        const a = inp<unknown>(node, 'A', cache, ctx, '');
        const b = inp<unknown>(node, 'B', cache, ctx, '');
        const as = String(a), bs = String(b);
        result = cn.operation === 'NOT_EQUAL' ? as !== bs : as === bs;
        break;
      }
      case 'FLOAT':
      default: {
        const a = inp<number>(node, 'A', cache, ctx, 0);
        const b = inp<number>(node, 'B', cache, ctx, 0);
        result = CompareNode.compute(cn.operation as any, a, b, eps);
      }
    }
    out(node, 'Result', cache, result);
  });

  // Random Value
  registerExecutor(RandomValueNode.bl_idname, (node, cache, ctx) => {
    const id = inp<number>(node, 'ID', cache, ctx, 0);
    const seed = inp<number>(node, 'Seed', cache, ctx, 0);
    const r0 = RandomValueNode.hash(id | 0, seed | 0);
    out(node, 'Value', cache, r0); // float output
  });

  // Switch (dynamic-typed: looks up by name "False"/"True"/"Output").
  registerExecutor(SwitchNode.bl_idname, (node, cache, ctx) => {
    const cond = !!inp<boolean>(node, 'Switch', cache, ctx, false);
    const falseSock = node.inputs.find((s) => s.name === 'False');
    const trueSock  = node.inputs.find((s) => s.name === 'True');
    const falseV = falseSock ? ctx.socketValue(falseSock, cache) : undefined;
    const trueV  = trueSock  ? ctx.socketValue(trueSock,  cache) : undefined;
    out(node, 'Output', cache, cond ? trueV : falseV);
  });

  // Float Curve
  registerExecutor(ShaderNodeFloatCurve.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { curve: ShaderNodeFloatCurve['curve'] };
    const fac = inp<number>(node, 'Factor', cache, ctx, 1);
    const v = inp<number>(node, 'Value', cache, ctx, 0.5);
    out(node, 'Value', cache, ShaderNodeFloatCurve.compute(cn.curve, v, fac));
  });

  // Vector Curves
  registerExecutor(ShaderNodeVectorCurve.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { curves: ShaderNodeVectorCurve['curves'] };
    const fac = inp<number>(node, 'Factor', cache, ctx, 1);
    const v = inp<Vec3>(node, 'Vector', cache, ctx, [0, 0, 0]);
    out(node, 'Vector', cache, ShaderNodeVectorCurve.compute(cn.curves, v, fac));
  });

  // RGB Curves
  registerExecutor(ShaderNodeRGBCurve.bl_idname, (node, cache, ctx) => {
    const cn = node as unknown as { curves: ShaderNodeRGBCurve['curves'] };
    const fac = inp<number>(node, 'Factor', cache, ctx, 1);
    const c = inp<RGBA>(node, 'Color', cache, ctx, [0.5, 0.5, 0.5, 1]);
    out(node, 'Color', cache, ShaderNodeRGBCurve.compute(cn.curves, c, fac));
  });

  // Reroute
  registerExecutor(RerouteNode.bl_idname, (node, cache, ctx) => {
    const input = node.inputs[0];
    if (input) {
      const v = ctx.socketValue(input, cache);
      out(node, 'Output', cache, v);
    }
  });

  // Group Input / Output — handled by evaluator's group logic; no-op here.
  registerExecutor(NodeGroupInput.bl_idname, (_node, _cache, _ctx) => {});
  registerExecutor(NodeGroupOutput.bl_idname, (_node, _cache, _ctx) => {});
}
