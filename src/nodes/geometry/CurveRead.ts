/**
 * Geometry-Node "Curves → Read" + "Curves → Write" field nodes (Phase 2C).
 *
 * Read side (field inputs, no incoming Geometry socket):
 *   GeometryNodeSplineLength             → Length (per CURVE), Point Count (per CURVE)
 *   GeometryNodeCurveLength              → Total length (single scalar) — convenience
 *   GeometryNodeCurveTangent             → Tangent vector per POINT
 *   GeometryNodeCurveTilt                → Tilt scalar per POINT
 *   GeometryNodeInputSplineCyclic        → Bool per CURVE
 *   GeometryNodeInputSplineResolution    → Int per CURVE
 *   GeometryNodeInputCurveParameter      → Float in [0,1] per POINT (arc-length)
 *   GeometryNodeEndpointSelection        → Bool per POINT (first N + last N)
 *
 * Write side (data-flow nodes, take Geometry + selection + value):
 *   GeometryNodeSetCurveRadius
 *   GeometryNodeSetCurveTilt
 *   GeometryNodeSetSplineCyclic
 *   GeometryNodeSetSplineResolution
 *
 * The evaluator implementations live in GeometryEvaluator (added in the
 * same patch). Field inputs use `node_kind: 'FIELD'`; write nodes use
 * `node_kind: 'DATA'`.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketBool, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketGeometry,
  NodeSocketInt, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

/* ------------------------------------------------------------------ */
/*  Base                                                              */
/* ------------------------------------------------------------------ */

abstract class CurveReadField extends Node {
  static override category = 'Curve / Read';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'FIELD' = 'FIELD';
}

abstract class CurveWriteData extends Node {
  static override category = 'Curve / Write';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
}

/* ------------------------------------------------------------------ */
/*  Read                                                              */
/* ------------------------------------------------------------------ */

/** Spline Length — per-curve length + point count fields. */
export class GeometryNodeSplineLength extends CurveReadField {
  static override bl_idname = 'GeometryNodeSplineLength';
  static override bl_label = 'Spline Length';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Length');
    this.addOutput(NodeSocketInt, 'Point Count');
  }
}

/** Curve Length — convenience scalar: sum of all spline lengths. */
export class GeometryNodeCurveLength extends Node {
  static override bl_idname = 'GeometryNodeCurveLength';
  static override bl_label = 'Curve Length';
  static override category = 'Curve / Read';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addOutput(NodeSocketFloat, 'Length');
  }
}

/** Tangent vector per curve point — unit vector along the curve. */
export class GeometryNodeInputTangent extends CurveReadField {
  static override bl_idname = 'GeometryNodeInputTangent';
  static override bl_label = 'Curve Tangent';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketVector, 'Tangent');
  }
}

/** Tilt scalar per curve point (degrees in Blender; we keep the raw float). */
export class GeometryNodeInputCurveTilt extends CurveReadField {
  static override bl_idname = 'GeometryNodeInputCurveTilt';
  static override bl_label = 'Curve Tilt';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Tilt');
  }
}

/** Per-spline cyclic flag (bool field on CURVE domain). */
export class GeometryNodeInputSplineCyclic extends CurveReadField {
  static override bl_idname = 'GeometryNodeInputSplineCyclic';
  static override bl_label = 'Is Spline Cyclic';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketBool, 'Cyclic');
  }
}

/** Per-spline render-resolution int (Bezier/NURBS only — falls back to 12). */
export class GeometryNodeInputSplineResolution extends CurveReadField {
  static override bl_idname = 'GeometryNodeInputSplineResolution';
  static override bl_label = 'Spline Resolution';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Resolution');
  }
}

/**
 * Curve Parameter — normalized arc-length [0, 1] per POINT (Factor),
 * 0-based integer index along the spline (Index), and the curve index.
 */
export class GeometryNodeCurveParameter extends CurveReadField {
  static override bl_idname = 'GeometryNodeCurveParameter';
  static override bl_label = 'Curve Parameter';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Factor');
    this.addOutput(NodeSocketFloat, 'Length');
    this.addOutput(NodeSocketInt, 'Index');
  }
}

/**
 * Endpoint Selection — true for the first `Start Size` and last `End Size`
 * points of every spline. Inputs are unlinked scalars (per Blender 4.x).
 */
export class GeometryNodeCurveEndpointSelection extends CurveReadField {
  static override bl_idname = 'GeometryNodeCurveEndpointSelection';
  static override bl_label = 'Endpoint Selection';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Start Size', { default_value: 1 });
    this.addInput(NodeSocketInt, 'End Size', { default_value: 1 });
    this.addOutput(NodeSocketBool, 'Selection');
  }
}

/* ------------------------------------------------------------------ */
/*  Write                                                             */
/* ------------------------------------------------------------------ */

/**
 * Set Curve Radius — writes a per-POINT `radius` attribute on the curve.
 * Selection (factor in [0,1]) gates the write; non-selected points keep
 * their previous radius.
 */
export class GeometryNodeSetCurveRadius extends CurveWriteData {
  static override bl_idname = 'GeometryNodeSetCurveRadius';
  static override bl_label = 'Set Curve Radius';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketFloatFactor, 'Selection', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

/** Set Curve Tilt — writes a per-POINT `tilt` attribute. */
export class GeometryNodeSetCurveTilt extends CurveWriteData {
  static override bl_idname = 'GeometryNodeSetCurveTilt';
  static override bl_label = 'Set Curve Tilt';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketFloatFactor, 'Selection', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Tilt', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

/** Set Spline Cyclic — writes the per-CURVE `cyclic` flag. */
export class GeometryNodeSetSplineCyclic extends CurveWriteData {
  static override bl_idname = 'GeometryNodeSetSplineCyclic';
  static override bl_label = 'Set Spline Cyclic';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketFloatFactor, 'Selection', { default_value: 1 });
    this.addInput(NodeSocketBool, 'Cyclic', { default_value: false });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/** Set Spline Resolution — writes the per-CURVE `resolution` (int). */
export class GeometryNodeSetSplineResolution extends CurveWriteData {
  static override bl_idname = 'GeometryNodeSetSplineResolution';
  static override bl_label = 'Set Spline Resolution';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketFloatFactor, 'Selection', { default_value: 1 });
    this.addInput(NodeSocketInt, 'Resolution', { default_value: 12 });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */
let _registered = false;
export function registerCurveReadWriteNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeSplineLength,
    GeometryNodeCurveLength,
    GeometryNodeInputTangent,
    GeometryNodeInputCurveTilt,
    GeometryNodeInputSplineCyclic,
    GeometryNodeInputSplineResolution,
    GeometryNodeCurveParameter,
    GeometryNodeCurveEndpointSelection,
    GeometryNodeSetCurveRadius,
    GeometryNodeSetCurveTilt,
    GeometryNodeSetSplineCyclic,
    GeometryNodeSetSplineResolution,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
