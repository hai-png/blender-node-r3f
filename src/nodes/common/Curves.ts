/**
 * Curve nodes — Blender's "Curves" widget exposes 1-D piecewise interpolators
 * that retarget a scalar/vector/color through a user-drawn graph.
 *
 * Three flavours:
 *   ShaderNodeFloatCurve       — single Float input, single Float output (1 curve)
 *   ShaderNodeVectorCurve      — Vector input, Vector output (3 curves: X/Y/Z)
 *   ShaderNodeRGBCurve         — Color input, Color output (4 curves: C, R, G, B)
 *
 * The data model is a list of `CurveMappingCurve` (one per channel), each
 * holding `points: { x, y }[]` sorted by x and an interpolation hint
 * ('AUTO' | 'LINEAR' | 'CONSTANT'). We default to AUTO (Catmull-Rom-ish).
 *
 * The implementations register on Shader + Compositor + Geometry trees so
 * they can be used wherever Blender allows; the evaluator dispatch (CPU
 * sampler) is shared via the static `sample()` helper below.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { FloatProperty } from '../../core/Properties';
import type { NodeTreeKind, RGBA, Vec3 } from '../../core/types';
import {
  NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

/* ------------------------------------------------------------------ */
/*  Curve mapping data                                                */
/* ------------------------------------------------------------------ */

export type CurveInterp = 'AUTO' | 'LINEAR' | 'CONSTANT';

export interface CurvePoint {
  x: number;
  y: number;
  /** Per-point handle type — Blender's default is AUTO. */
  handle?: CurveInterp;
}

export interface CurveMappingCurve {
  /** Sorted ascending by x. Must contain at least 2 points. */
  points: CurvePoint[];
  interp: CurveInterp;
}

/**
 * Evaluate a 1-D curve at parameter `x`. Outputs are clamped to [0,1] in
 * Blender's curve widget; we keep that behaviour by default but expose a
 * `clamp` arg for callers (Vector Curve outputs are *not* clamped).
 *
 * Interpolation modes:
 *   - LINEAR: piecewise linear between adjacent points
 *   - CONSTANT: step (uses left value)
 *   - AUTO: Catmull-Rom-ish cubic with finite differences (Blender's default)
 */
export function sampleCurve(curve: CurveMappingCurve, x: number, clamp = true): number {
  const pts = curve.points;
  if (pts.length === 0) return clamp ? Math.max(0, Math.min(1, x)) : x;
  if (pts.length === 1) {
    const y = pts[0]!.y;
    return clamp ? Math.max(0, Math.min(1, y)) : y;
  }
  // Endpoint extrapolation: clamp to nearest point's y (Blender behaviour).
  if (x <= pts[0]!.x) return clamp ? Math.max(0, Math.min(1, pts[0]!.y)) : pts[0]!.y;
  const last = pts[pts.length - 1]!;
  if (x >= last.x) return clamp ? Math.max(0, Math.min(1, last.y)) : last.y;
  // Find bracketing segment by binary search.
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.x <= x) lo = mid; else hi = mid;
  }
  const a = pts[lo]!, b = pts[hi]!;
  const denom = b.x - a.x || 1e-12;
  const t = (x - a.x) / denom;
  let y: number;
  if (curve.interp === 'CONSTANT') {
    y = a.y;
  } else if (curve.interp === 'LINEAR') {
    y = a.y + (b.y - a.y) * t;
  } else {
    // AUTO: cubic Hermite with tangents from neighbouring points (Catmull-Rom).
    const p0 = pts[lo - 1] ?? a;
    const p1 = a;
    const p2 = b;
    const p3 = pts[hi + 1] ?? b;
    const m1 = (p2.y - p0.y) / Math.max(1e-12, p2.x - p0.x) * (p2.x - p1.x);
    const m2 = (p3.y - p1.y) / Math.max(1e-12, p3.x - p1.x) * (p2.x - p1.x);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    y = h00 * p1.y + h10 * m1 + h01 * p2.y + h11 * m2;
  }
  return clamp ? Math.max(0, Math.min(1, y)) : y;
}

/** Convenience: identity curve (y = x), used as the default for every channel. */
export function identityCurve(): CurveMappingCurve {
  return {
    points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    interp: 'AUTO',
  };
}

/* ------------------------------------------------------------------ */
/*  Float Curve                                                       */
/* ------------------------------------------------------------------ */

export class ShaderNodeFloatCurve extends Node {
  static override bl_idname = 'ShaderNodeFloatCurve';
  static override bl_label = 'Float Curve';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree'];
  static override bl_width_default = 220;
  static override properties = {
    /** Domain min/max — Blender uses min_x/max_x = 0/1 by default. */
    min_x: FloatProperty({ default: 0, name: 'Min X' }),
    max_x: FloatProperty({ default: 1, name: 'Max X' }),
    min_y: FloatProperty({ default: 0, name: 'Min Y' }),
    max_y: FloatProperty({ default: 1, name: 'Max Y' }),
  };
  declare min_x: number; declare max_x: number;
  declare min_y: number; declare max_y: number;

  /** Single curve (mutable for the Inspector). */
  curve: CurveMappingCurve = identityCurve();

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Factor', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0.5 });
    this.addOutput(NodeSocketFloat, 'Value');
  }

  /** Pure CPU evaluator. `fac` mixes between input and curve output. */
  static compute(curve: CurveMappingCurve, value: number, fac: number): number {
    const mapped = sampleCurve(curve, value, false);
    return value + (mapped - value) * Math.max(0, Math.min(1, fac));
  }
}

/* ------------------------------------------------------------------ */
/*  Vector Curves                                                     */
/* ------------------------------------------------------------------ */

export class ShaderNodeVectorCurve extends Node {
  static override bl_idname = 'ShaderNodeVectorCurve';
  static override bl_label = 'Vector Curves';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree'];
  static override bl_width_default = 240;

  /** Three per-axis curves: X, Y, Z. */
  curves: [CurveMappingCurve, CurveMappingCurve, CurveMappingCurve] = [
    identityCurve(), identityCurve(), identityCurve(),
  ];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Factor', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Vector', { default_value: [0, 0, 0] });
    this.addOutput(NodeSocketVector, 'Vector');
  }

  static compute(
    curves: ShaderNodeVectorCurve['curves'],
    v: Vec3,
    fac: number,
  ): Vec3 {
    const f = Math.max(0, Math.min(1, fac));
    const lerp = (a: number, b: number) => a + (b - a) * f;
    return [
      lerp(v[0], sampleCurve(curves[0], v[0], false)),
      lerp(v[1], sampleCurve(curves[1], v[1], false)),
      lerp(v[2], sampleCurve(curves[2], v[2], false)),
    ];
  }
}

/* ------------------------------------------------------------------ */
/*  RGB Curves                                                        */
/* ------------------------------------------------------------------ */

export class ShaderNodeRGBCurve extends Node {
  static override bl_idname = 'ShaderNodeRGBCurve';
  static override bl_label = 'RGB Curves';
  static override category = 'Color';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override bl_width_default = 240;

  /**
   * Four curves — the first is "Combined" (applied to luma before R/G/B
   * per-channel curves), then R, G, B. Matches Blender's UI: tabs C/R/G/B.
   */
  curves: [CurveMappingCurve, CurveMappingCurve, CurveMappingCurve, CurveMappingCurve] = [
    identityCurve(), identityCurve(), identityCurve(), identityCurve(),
  ];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Factor', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Color', { default_value: [0.5, 0.5, 0.5, 1] });
    this.addOutput(NodeSocketColor, 'Color');
  }

  static compute(curves: ShaderNodeRGBCurve['curves'], c: RGBA, fac: number): RGBA {
    // Combined curve applies first (across all three channels).
    let r = sampleCurve(curves[0], c[0]);
    let g = sampleCurve(curves[0], c[1]);
    let b = sampleCurve(curves[0], c[2]);
    // Per-channel curves.
    r = sampleCurve(curves[1], r);
    g = sampleCurve(curves[2], g);
    b = sampleCurve(curves[3], b);
    // Fac mixes back toward the original.
    const f = Math.max(0, Math.min(1, fac));
    return [
      c[0] + (r - c[0]) * f,
      c[1] + (g - c[1]) * f,
      c[2] + (b - c[2]) * f,
      c[3],
    ];
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */
let _registered = false;
export function registerCurveNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [ShaderNodeFloatCurve, ShaderNodeVectorCurve, ShaderNodeRGBCurve]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
