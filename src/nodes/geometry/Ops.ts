/**
 * Geometry data-flow ops (the "round-socket" nodes):
 *   Set Position, Capture Attribute, Store/Remove Named Attribute,
 *   Bounding Box, Realize Instances, Merge by Distance, Subdivision Surface,
 *   Distribute Points on Faces, Instance on Points, Translate/Rotate/Scale
 *   Instances, Mesh to Points, Points to Vertices, Sample Index, Raycast,
 *   Geometry Proximity.
 *
 * All take Geometry + optional Selection Field + extra Fields, and produce
 * a new Geometry.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketBool, NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketGeometry,
  NodeSocketInt, NodeSocketRotation, NodeSocketString, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class GeoDataFlow extends Node {
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
}

/* ------------------------------------------------------------------ */
/*  Set Position                                                      */
/* ------------------------------------------------------------------ */

export class GeometryNodeSetPosition extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSetPosition';
  static override bl_label = 'Set Position';
  static override category = 'Geometry / Write';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketVector, 'Position');           // diamond field
    this.addInput(NodeSocketVector, 'Offset');
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Capture Attribute                                                  */
/* ------------------------------------------------------------------ */

export class GeometryNodeCaptureAttribute extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeCaptureAttribute';
  static override bl_label = 'Capture Attribute';
  static override category = 'Geometry / Attribute';
  static override properties = {
    data_type: EnumProperty({
      items: [
        ['FLOAT', 'Float', ''], ['INT', 'Integer', ''], ['BOOL', 'Boolean', ''],
        ['FLOAT_VECTOR', 'Vector', ''], ['FLOAT_COLOR', 'Color', ''],
      ], default: 'FLOAT_VECTOR', name: 'Type',
    }),
    domain: EnumProperty({
      items: [
        ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
        ['CORNER', 'Face Corner', ''], ['CURVE', 'Spline', ''], ['INSTANCE', 'Instance', ''],
      ], default: 'POINT', name: 'Domain',
    }),
  };
  declare data_type: 'FLOAT' | 'INT' | 'BOOL' | 'FLOAT_VECTOR' | 'FLOAT_COLOR';
  declare domain: 'POINT' | 'EDGE' | 'FACE' | 'CORNER' | 'CURVE' | 'INSTANCE';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketVector, 'Value');
    this.addOutput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketVector, 'Attribute');
  }
}

/* ------------------------------------------------------------------ */
/*  Store / Remove Named Attribute                                    */
/* ------------------------------------------------------------------ */

export class GeometryNodeStoreNamedAttribute extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeStoreNamedAttribute';
  static override bl_label = 'Store Named Attribute';
  static override category = 'Geometry / Attribute';
  static override properties = {
    data_type: EnumProperty({
      items: [
        ['FLOAT', 'Float', ''], ['INT', 'Integer', ''], ['BOOL', 'Boolean', ''],
        ['FLOAT_VECTOR', 'Vector', ''], ['FLOAT_COLOR', 'Color', ''],
      ], default: 'FLOAT_VECTOR', name: 'Type',
    }),
    domain: EnumProperty({
      items: [
        ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
        ['CORNER', 'Face Corner', ''], ['CURVE', 'Spline', ''], ['INSTANCE', 'Instance', ''],
      ], default: 'POINT', name: 'Domain',
    }),
  };
  declare data_type: 'FLOAT' | 'INT' | 'BOOL' | 'FLOAT_VECTOR' | 'FLOAT_COLOR';
  declare domain: 'POINT' | 'EDGE' | 'FACE' | 'CORNER' | 'CURVE' | 'INSTANCE';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketString, 'Name');
    this.addInput(NodeSocketVector, 'Value');
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

export class GeometryNodeRemoveAttribute extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeRemoveAttribute';
  static override bl_label = 'Remove Named Attribute';
  static override category = 'Geometry / Attribute';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketString, 'Name');
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Bounding Box                                                      */
/* ------------------------------------------------------------------ */

export class GeometryNodeBoundBox extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeBoundBox';
  static override bl_label = 'Bounding Box';
  static override category = 'Geometry / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketGeometry, 'Bounding Box');
    this.addOutput(NodeSocketVector, 'Min');
    this.addOutput(NodeSocketVector, 'Max');
  }
}

export class GeometryNodeConvexHull extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeConvexHull';
  static override bl_label = 'Convex Hull';
  static override category = 'Geometry / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketGeometry, 'Convex Hull');
  }
}

/* ------------------------------------------------------------------ */
/*  Merge by Distance                                                 */
/* ------------------------------------------------------------------ */

export class GeometryNodeMergeByDistance extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeMergeByDistance';
  static override bl_label = 'Merge by Distance';
  static override category = 'Geometry / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketFloat, 'Distance', { default_value: 0.001 });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ------------------------------------------------------------------ */
/*  Subdivision Surface (Loop)                                        */
/* ------------------------------------------------------------------ */

export class GeometryNodeSubdivisionSurface extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSubdivisionSurface';
  static override bl_label = 'Subdivision Surface';
  static override category = 'Mesh / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketInt, 'Level', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Edge Crease', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Vertex Crease', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

/* ------------------------------------------------------------------ */
/*  Triangulate                                                       */
/* ------------------------------------------------------------------ */

export class GeometryNodeTriangulate extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeTriangulate';
  static override bl_label = 'Triangulate';
  static override category = 'Mesh / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketInt, 'Minimum Vertices', { default_value: 4 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

/* ------------------------------------------------------------------ */
/*  Distribute Points on Faces                                        */
/* ------------------------------------------------------------------ */

export class GeometryNodeDistributePointsOnFaces extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeDistributePointsOnFaces';
  static override bl_label = 'Distribute Points on Faces';
  static override category = 'Point';
  static override properties = {
    distribute_method: EnumProperty({
      items: [['RANDOM', 'Random', ''], ['POISSON', 'Poisson Disk', '']],
      default: 'RANDOM', name: 'Method',
    }),
  };
  declare distribute_method: 'RANDOM' | 'POISSON';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketFloat, 'Distance Min', { default_value: 0.05 });
    this.addInput(NodeSocketFloat, 'Density Max', { default_value: 10 });
    this.addInput(NodeSocketFloat, 'Density', { default_value: 10 });
    this.addInput(NodeSocketFloat, 'Density Factor', { default_value: 1 });
    this.addInput(NodeSocketInt, 'Seed', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Points');
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketRotation, 'Rotation');
  }
}

/* ------------------------------------------------------------------ */
/*  Mesh ↔ Points / Curve                                             */
/* ------------------------------------------------------------------ */

export class GeometryNodeMeshToPoints extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeMeshToPoints';
  static override bl_label = 'Mesh to Points';
  static override category = 'Mesh / Operations';
  static override properties = {
    mode: EnumProperty({
      items: [['VERTICES', 'Vertices', ''], ['EDGES', 'Edges', ''], ['FACES', 'Faces', ''], ['CORNERS', 'Corners', '']],
      default: 'VERTICES', name: 'Mode',
    }),
  };
  declare mode: 'VERTICES' | 'EDGES' | 'FACES' | 'CORNERS';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketVector, 'Position');
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 0.05 });
    this.addOutput(NodeSocketGeometry, 'Points');
  }
}

export class GeometryNodePointsToVertices extends GeoDataFlow {
  static override bl_idname = 'GeometryNodePointsToVertices';
  static override bl_label = 'Points to Vertices';
  static override category = 'Point';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Points');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

/* ------------------------------------------------------------------ */
/*  Instances                                                          */
/* ------------------------------------------------------------------ */

export class GeometryNodeInstanceOnPoints extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInstanceOnPoints';
  static override bl_label = 'Instance on Points';
  static override category = 'Instances';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Points');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketGeometry, 'Instance');
    this.addInput(NodeSocketBool, 'Pick Instance', { default_value: false });
    this.addInput(NodeSocketInt, 'Instance Index', { default_value: 0 });
    this.addInput(NodeSocketRotation, 'Rotation');
    this.addInput(NodeSocketVector, 'Scale', { default_value: [1, 1, 1] });
    this.addOutput(NodeSocketGeometry, 'Instances');
  }
}

export class GeometryNodeRealizeInstances extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeRealizeInstances';
  static override bl_label = 'Realize Instances';
  static override category = 'Instances';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

export class GeometryNodeTranslateInstances extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeTranslateInstances';
  static override bl_label = 'Translate Instances';
  static override category = 'Instances';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Instances');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketVector, 'Translation', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketBool, 'Local Space', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Instances');
  }
}

export class GeometryNodeRotateInstances extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeRotateInstances';
  static override bl_label = 'Rotate Instances';
  static override category = 'Instances';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Instances');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketRotation, 'Rotation');
    this.addInput(NodeSocketVector, 'Pivot Point', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketBool, 'Local Space', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Instances');
  }
}

export class GeometryNodeScaleInstances extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeScaleInstances';
  static override bl_label = 'Scale Instances';
  static override category = 'Instances';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Instances');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketVector, 'Scale', { default_value: [1, 1, 1] });
    this.addInput(NodeSocketVector, 'Center', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketBool, 'Local Space', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Instances');
  }
}

/* ------------------------------------------------------------------ */
/*  Curve ops                                                          */
/* ------------------------------------------------------------------ */

export class GeometryNodeCurveToMesh extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeCurveToMesh';
  static override bl_label = 'Curve to Mesh';
  static override category = 'Curve / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketGeometry, 'Profile Curve');
    this.addInput(NodeSocketBool, 'Fill Caps', { default_value: false });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeCurveToPoints extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeCurveToPoints';
  static override bl_label = 'Curve to Points';
  static override category = 'Curve / Operations';
  static override properties = {
    mode: EnumProperty({
      items: [['EVALUATED', 'Evaluated', ''], ['COUNT', 'Count', ''], ['LENGTH', 'Length', '']],
      default: 'COUNT', name: 'Mode',
    }),
  };
  declare mode: 'EVALUATED' | 'COUNT' | 'LENGTH';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketInt, 'Count', { default_value: 10 });
    this.addInput(NodeSocketFloat, 'Length', { default_value: 0.1 });
    this.addOutput(NodeSocketGeometry, 'Points');
    this.addOutput(NodeSocketVector, 'Tangent');
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketRotation, 'Rotation');
  }
}

export class GeometryNodeResampleCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeResampleCurve';
  static override bl_label = 'Resample Curve';
  static override category = 'Curve / Operations';
  static override properties = {
    mode: EnumProperty({
      items: [['EVALUATED', 'Evaluated', ''], ['COUNT', 'Count', ''], ['LENGTH', 'Length', '']],
      default: 'COUNT', name: 'Mode',
    }),
  };
  declare mode: 'EVALUATED' | 'COUNT' | 'LENGTH';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketInt, 'Count', { default_value: 10 });
    this.addInput(NodeSocketFloat, 'Length', { default_value: 0.1 });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

export class GeometryNodeReverseCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeReverseCurve';
  static override bl_label = 'Reverse Curve';
  static override category = 'Curve / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

/* ------------------------------------------------------------------ */
/*  Curve primitives                                                  */
/* ------------------------------------------------------------------ */

abstract class CurvePrim extends GeoDataFlow {
  static override category = 'Curve / Primitives';
}

export class GeometryNodeCurveLine extends CurvePrim {
  static override bl_idname = 'GeometryNodeCurvePrimitiveLine';
  static override bl_label = 'Curve Line';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Start', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'End', { default_value: [0, 0, 1] });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

export class GeometryNodeCurveCircle extends CurvePrim {
  static override bl_idname = 'GeometryNodeCurvePrimitiveCircle';
  static override bl_label = 'Curve Circle';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Resolution', { default_value: 32 });
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

export class GeometryNodeCurveBezierSegment extends CurvePrim {
  static override bl_idname = 'GeometryNodeCurvePrimitiveBezierSegment';
  static override bl_label = 'Bezier Segment';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Resolution', { default_value: 16 });
    this.addInput(NodeSocketVector, 'Start', { default_value: [-1, 0, 0] });
    this.addInput(NodeSocketVector, 'Start Handle', { default_value: [-0.5, 0.5, 0] });
    this.addInput(NodeSocketVector, 'End Handle', { default_value: [0.5, 0.5, 0] });
    this.addInput(NodeSocketVector, 'End', { default_value: [1, 0, 0] });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

export class GeometryNodeCurveSpiral extends CurvePrim {
  static override bl_idname = 'GeometryNodeCurveSpiral';
  static override bl_label = 'Spiral';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Resolution', { default_value: 32 });
    this.addInput(NodeSocketFloat, 'Rotations', { default_value: 2 });
    this.addInput(NodeSocketFloat, 'Start Radius', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'End Radius', { default_value: 2 });
    this.addInput(NodeSocketFloat, 'Height', { default_value: 2 });
    this.addInput(NodeSocketBool, 'Reverse', { default_value: false });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

/* ------------------------------------------------------------------ */
/*  Sampling                                                          */
/* ------------------------------------------------------------------ */

export class GeometryNodeSampleIndex extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSampleIndex';
  static override bl_label = 'Sample Index';
  static override category = 'Geometry / Sample';
  static override properties = {
    domain: EnumProperty({
      items: [
        ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
        ['CORNER', 'Face Corner', ''], ['CURVE', 'Spline', ''],
      ], default: 'POINT', name: 'Domain',
    }),
  };
  declare domain: 'POINT' | 'EDGE' | 'FACE' | 'CORNER' | 'CURVE';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketVector, 'Value');
    this.addInput(NodeSocketInt, 'Index', { default_value: 0 });
    this.addOutput(NodeSocketVector, 'Value');
  }
}

export class GeometryNodeSampleNearest extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSampleNearest';
  static override bl_label = 'Sample Nearest';
  static override category = 'Geometry / Sample';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketVector, 'Sample Position');
    this.addOutput(NodeSocketInt, 'Index');
  }
}

export class GeometryNodeProximity extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeProximity';
  static override bl_label = 'Geometry Proximity';
  static override category = 'Geometry / Sample';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Target');
    this.addInput(NodeSocketVector, 'Source Position');
    this.addOutput(NodeSocketVector, 'Position');
    this.addOutput(NodeSocketFloat, 'Distance');
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                      */
/* ------------------------------------------------------------------ */

// -----------------------------------------------------------------------
//  Curve ops — remaining limited/stub implementations.
//  NOTE: These are declared/registered so the bridge can import them.
//  Fill/Fillet are still partial; Sample/Subdivide now have executable
//  poly-curve implementations in the GeometryEvaluator / MeshOps.
// -----------------------------------------------------------------------
export class GeometryNodeFillCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeFillCurve';
  static override bl_label = 'Fill Curve';
  static override category = 'Curve / Operations';
  /* Limited implementation: fills simple planar closed poly-curves using
   * ear clipping. Holes / self-intersections are not handled yet. */
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeFilletCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeFilletCurve';
  static override bl_label = 'Fillet Curve';
  static override category = 'Curve / Operations';
  /* Limited implementation: rounds poly-curve corners by trimming adjacent
   * segments and inserting an approximated circular arc. */
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 0.1 });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

export class GeometryNodeSampleCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSampleCurve';
  static override bl_label = 'Sample Curve';
  static override category = 'Curve / Sample';
  /* Limited implementation: samples the current poly-curve representation at
   * a normalized factor. Multi-curve inputs are partitioned evenly across
   * [0,1]; future work can refine this toward Blender's exact semantics. */
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curves');
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Factor', { default_value: 0 });
    this.addOutput(NodeSocketVector, 'Position');
    this.addOutput(NodeSocketVector, 'Tangent');
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketFloat, 'Value');
    this.addOutput(NodeSocketInt, 'Index');
    this.addOutput(NodeSocketInt, 'Curve Index');
  }
}

export class GeometryNodeSubdivideCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSubdivideCurve';
  static override bl_label = 'Subdivide Curve';
  static override category = 'Curve / Operations';
  /* Inserts `Cuts` evenly-spaced points into every poly-curve segment. */
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Curve');
    this.addInput(NodeSocketInt, 'Cuts', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

let _registered = false;
export class GeometryNodeFlipFaces extends Node {
  static override bl_idname = 'GeometryNodeFlipFaces';
  static override bl_label = 'Flip Faces';
  static override category = 'Mesh / Operations';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export function registerGeometryOps(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeSetPosition,
    GeometryNodeCaptureAttribute,
    GeometryNodeStoreNamedAttribute,
    GeometryNodeRemoveAttribute,
    GeometryNodeBoundBox,
    GeometryNodeConvexHull,
    GeometryNodeMergeByDistance,
    GeometryNodeSubdivisionSurface,
    GeometryNodeTriangulate,
    GeometryNodeDistributePointsOnFaces,
    GeometryNodeMeshToPoints,
    GeometryNodePointsToVertices,
    GeometryNodeInstanceOnPoints,
    GeometryNodeRealizeInstances,
    GeometryNodeTranslateInstances,
    GeometryNodeRotateInstances,
    GeometryNodeScaleInstances,
    GeometryNodeCurveToMesh,
    GeometryNodeCurveToPoints,
    GeometryNodeResampleCurve,
    GeometryNodeReverseCurve,
    GeometryNodeCurveLine,
    GeometryNodeCurveCircle,
    GeometryNodeCurveBezierSegment,
    GeometryNodeCurveSpiral,
    GeometryNodeSampleIndex,
    GeometryNodeSampleNearest,
    GeometryNodeProximity, GeometryNodeFlipFaces,
    GeometryNodeFillCurve, GeometryNodeFilletCurve,
    GeometryNodeSampleCurve, GeometryNodeSubdivideCurve,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}

void StringProperty;
void NodeSocketColor;
