/**
 * MoreOps.ts — additional Geometry Nodes registered for parity with
 * Blender 4.x but not yet present in Ops.ts. Some have full CPU
 * implementations in the evaluator (see GeometryEvaluator.executeNode
 * extensions); others are registered as classes so .blend imports map
 * to a known node, even if their runtime semantics fall back to
 * identity / empty for now (clearly documented per-node).
 *
 * Adding nodes here is intentionally low-risk: the GeometryEvaluator's
 * "unknown node" branch lifts default socket values, so registering a
 * class without an evaluator handler simply means the node passes its
 * default outputs through.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty, BoolProperty } from '../../core/Properties';
import type { NodeTreeKind } from '../../core/types';
import {
  NodeSocketBool, NodeSocketFloat, NodeSocketGeometry, NodeSocketInt,
  NodeSocketString, NodeSocketVector, NodeSocketRotation,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

abstract class GeoDataFlow extends Node {
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'DATA' = 'DATA';
}

/* ────────────────── Raycast ────────────────── */

export class GeometryNodeRaycast extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeRaycast';
  static override bl_label = 'Raycast';
  static override category = 'Geometry / Sample';
  static override properties = {
    mapping: EnumProperty({
      items: [['INTERPOLATED', 'Interpolated', ''], ['NEAREST', 'Nearest', '']],
      default: 'INTERPOLATED', name: 'Mapping',
    }),
    data_type: EnumProperty({
      items: [
        ['FLOAT', 'Float', ''], ['INT', 'Integer', ''], ['BOOL', 'Boolean', ''],
        ['FLOAT_VECTOR', 'Vector', ''], ['FLOAT_COLOR', 'Color', ''],
      ],
      default: 'FLOAT_VECTOR', name: 'Type',
    }),
  };
  declare mapping: 'INTERPOLATED' | 'NEAREST';
  declare data_type: 'FLOAT' | 'INT' | 'BOOL' | 'FLOAT_VECTOR' | 'FLOAT_COLOR';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Target Geometry');
    this.addInput(NodeSocketVector, 'Attribute');
    this.addInput(NodeSocketVector, 'Source Position');
    this.addInput(NodeSocketVector, 'Ray Direction', { default_value: [0, 0, -1] });
    this.addInput(NodeSocketFloat, 'Ray Length', { default_value: 100 });
    this.addOutput(NodeSocketBool, 'Is Hit');
    this.addOutput(NodeSocketVector, 'Hit Position');
    this.addOutput(NodeSocketVector, 'Hit Normal');
    this.addOutput(NodeSocketFloat, 'Hit Distance');
    this.addOutput(NodeSocketVector, 'Attribute');
  }
}

/* ────────────────── Extrude Mesh ────────────────── */

export class GeometryNodeExtrudeMesh extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeExtrudeMesh';
  static override bl_label = 'Extrude Mesh';
  static override category = 'Mesh / Operations';
  static override properties = {
    mode: EnumProperty({
      items: [['VERTICES', 'Vertices', ''], ['EDGES', 'Edges', ''], ['FACES', 'Faces', '']],
      default: 'FACES', name: 'Mode',
    }),
  };
  declare mode: 'VERTICES' | 'EDGES' | 'FACES';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketVector, 'Offset', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketFloat, 'Offset Scale', { default_value: 1 });
    this.addInput(NodeSocketBool, 'Individual', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Mesh');
    this.addOutput(NodeSocketBool, 'Top');
    this.addOutput(NodeSocketBool, 'Side');
  }
}

/* ────────────────── Delete / Separate / Duplicate Geometry ────────────────── */

export class GeometryNodeDeleteGeometry extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeDeleteGeometry';
  static override bl_label = 'Delete Geometry';
  static override category = 'Geometry / Operations';
  static override properties = {
    domain: EnumProperty({
      items: [
        ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
        ['CURVE', 'Spline', ''], ['INSTANCE', 'Instance', ''],
      ],
      default: 'POINT', name: 'Domain',
    }),
    mode: EnumProperty({
      items: [['ALL', 'All', ''], ['EDGE_FACE', 'Only Edges & Faces', ''], ['ONLY_FACE', 'Only Faces', '']],
      default: 'ALL', name: 'Mode',
    }),
  };
  declare domain: string; declare mode: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

export class GeometryNodeSeparateGeometry extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSeparateGeometry';
  static override bl_label = 'Separate Geometry';
  static override category = 'Geometry / Operations';
  static override properties = {
    domain: EnumProperty({
      items: [
        ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
        ['CURVE', 'Spline', ''], ['INSTANCE', 'Instance', ''],
      ],
      default: 'POINT', name: 'Domain',
    }),
  };
  declare domain: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Selection');
    this.addOutput(NodeSocketGeometry, 'Inverted');
  }
}

export class GeometryNodeDuplicateElements extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeDuplicateElements';
  static override bl_label = 'Duplicate Elements';
  static override category = 'Geometry / Operations';
  static override properties = {
    domain: EnumProperty({
      items: [
        ['POINT', 'Point', ''], ['EDGE', 'Edge', ''], ['FACE', 'Face', ''],
        ['CURVE', 'Spline', ''], ['INSTANCE', 'Instance', ''],
      ],
      default: 'POINT', name: 'Domain',
    }),
  };
  declare domain: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketInt, 'Amount', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketInt, 'Duplicate Index');
  }
}

/* ────────────────── Mesh <-> Curve / Volume conversions ────────────────── */

export class GeometryNodeMeshToCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeMeshToCurve';
  static override bl_label = 'Mesh to Curve';
  static override category = 'Mesh / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Curve');
  }
}

export class GeometryNodeMeshToVolume extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeMeshToVolume';
  static override bl_label = 'Mesh to Volume';
  static override category = 'Mesh / Operations';
  static override properties = {
    resolution_mode: EnumProperty({
      items: [['VOXEL_AMOUNT', 'Voxel Amount', ''], ['VOXEL_SIZE', 'Voxel Size', '']],
      default: 'VOXEL_AMOUNT', name: 'Resolution',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketFloat, 'Density', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Voxel Size', { default_value: 0.3 });
    this.addInput(NodeSocketFloat, 'Voxel Amount', { default_value: 64 });
    this.addInput(NodeSocketFloat, 'Exterior Band Width', { default_value: 0.1 });
    this.addInput(NodeSocketFloat, 'Interior Band Width', { default_value: 0.0 });
    this.addInput(NodeSocketBool, 'Fill Interior', { default_value: false });
    this.addOutput(NodeSocketGeometry, 'Volume');
  }
}

export class GeometryNodeVolumeToMesh extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeVolumeToMesh';
  static override bl_label = 'Volume to Mesh';
  static override category = 'Volume';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Volume');
    this.addInput(NodeSocketFloat, 'Voxel Size', { default_value: 0.3 });
    this.addInput(NodeSocketFloat, 'Voxel Amount', { default_value: 64 });
    this.addInput(NodeSocketFloat, 'Threshold', { default_value: 0.1 });
    this.addInput(NodeSocketFloat, 'Adaptivity', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodePointsToVolume extends GeoDataFlow {
  static override bl_idname = 'GeometryNodePointsToVolume';
  static override bl_label = 'Points to Volume';
  static override category = 'Volume';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Points');
    this.addInput(NodeSocketFloat, 'Density', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Voxel Size', { default_value: 0.3 });
    this.addInput(NodeSocketFloat, 'Voxel Amount', { default_value: 64 });
    this.addInput(NodeSocketFloat, 'Radius', { default_value: 0.5 });
    this.addOutput(NodeSocketGeometry, 'Volume');
  }
}

/* ────────────────── Edge ops / Face ops ────────────────── */

export class GeometryNodeSplitEdges extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSplitEdges';
  static override bl_label = 'Split Edges';
  static override category = 'Mesh / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeSubdivideMesh extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSubdivideMesh';
  static override bl_label = 'Subdivide Mesh';
  static override category = 'Mesh / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketInt, 'Level', { default_value: 1 });
    this.addOutput(NodeSocketGeometry, 'Mesh');
  }
}

export class GeometryNodeDualMesh extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeDualMesh';
  static override bl_label = 'Dual Mesh';
  static override category = 'Mesh / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketBool, 'Keep Boundaries', { default_value: false });
    this.addOutput(NodeSocketGeometry, 'Dual Mesh');
  }
}

export class GeometryNodeScaleElements extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeScaleElements';
  static override bl_label = 'Scale Elements';
  static override category = 'Mesh / Operations';
  static override properties = {
    domain: EnumProperty({
      items: [['FACE', 'Face', ''], ['EDGE', 'Edge', '']],
      default: 'FACE', name: 'Domain',
    }),
    scale_mode: EnumProperty({
      items: [['UNIFORM', 'Uniform', ''], ['SINGLE_AXIS', 'Single Axis', '']],
      default: 'UNIFORM', name: 'Scale Mode',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketFloat, 'Scale', { default_value: 1 });
    this.addInput(NodeSocketVector, 'Center', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Axis', { default_value: [1, 0, 0] });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

/* ────────────────── Sampling / topology helpers ────────────────── */

export class GeometryNodeSampleNearestSurface extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSampleNearestSurface';
  static override bl_label = 'Sample Nearest Surface';
  static override category = 'Geometry / Sample';
  static override properties = {
    data_type: EnumProperty({
      items: [
        ['FLOAT', 'Float', ''], ['INT', 'Integer', ''], ['BOOL', 'Boolean', ''],
        ['FLOAT_VECTOR', 'Vector', ''], ['FLOAT_COLOR', 'Color', ''],
      ],
      default: 'FLOAT_VECTOR', name: 'Type',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketVector, 'Value');
    this.addInput(NodeSocketInt, 'Group ID', { default_value: 0 });
    this.addInput(NodeSocketVector, 'Sample Position');
    this.addInput(NodeSocketInt, 'Sample Group ID', { default_value: 0 });
    this.addOutput(NodeSocketVector, 'Value');
    this.addOutput(NodeSocketBool, 'Is Valid');
  }
}

export class GeometryNodeSampleUVSurface extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSampleUVSurface';
  static override bl_label = 'Sample UV Surface';
  static override category = 'Geometry / Sample';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Mesh');
    this.addInput(NodeSocketVector, 'Value');
    this.addInput(NodeSocketVector, 'Source UV Map');
    this.addInput(NodeSocketVector, 'Sample UV');
    this.addOutput(NodeSocketVector, 'Value');
    this.addOutput(NodeSocketBool, 'Is Valid');
  }
}

export class GeometryNodeInputMeshIsland extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputMeshIsland';
  static override bl_label = 'Mesh Island';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Island Index');
    this.addOutput(NodeSocketInt, 'Island Count');
  }
}

export class GeometryNodeInputShadeSmooth extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputShadeSmooth';
  static override bl_label = 'Is Shade Smooth';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketBool, 'Smooth');
  }
}

export class GeometryNodeSetShadeSmooth extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeSetShadeSmooth';
  static override bl_label = 'Set Shade Smooth';
  static override category = 'Mesh / Write';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketBool, 'Shade Smooth', { default_value: true });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

export class GeometryNodeInputMeshVertexNeighbors extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputMeshVertexNeighbors';
  static override bl_label = 'Vertex Neighbors';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Vertex Count');
    this.addOutput(NodeSocketInt, 'Face Count');
  }
}

export class GeometryNodeInputMeshFaceArea extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputMeshFaceArea';
  static override bl_label = 'Face Area';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Area');
  }
}

export class GeometryNodeInputMeshEdgeAngle extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputMeshEdgeAngle';
  static override bl_label = 'Edge Angle';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Unsigned Angle');
    this.addOutput(NodeSocketFloat, 'Signed Angle');
  }
}

export class GeometryNodeInputMeshEdgeVertices extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputMeshEdgeVertices';
  static override bl_label = 'Edge Vertices';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Vertex Index 1');
    this.addOutput(NodeSocketInt, 'Vertex Index 2');
    this.addOutput(NodeSocketVector, 'Position 1');
    this.addOutput(NodeSocketVector, 'Position 2');
  }
}

export class GeometryNodeInputMeshFaceIsPlanar extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInputMeshFaceIsPlanar';
  static override bl_label = 'Face is Planar';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Threshold', { default_value: 0.01 });
    this.addOutput(NodeSocketBool, 'Planar');
  }
}

/* ────────────────── Curve helpers ────────────────── */

export class GeometryNodeInterpolateCurves extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeInterpolateCurves';
  static override bl_label = 'Interpolate Curves';
  static override category = 'Curve / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Guide Curves');
    this.addInput(NodeSocketVector, 'Guide Up');
    this.addInput(NodeSocketInt, 'Guide Group ID', { default_value: 0 });
    this.addInput(NodeSocketGeometry, 'Points');
    this.addInput(NodeSocketVector, 'Point Up');
    this.addInput(NodeSocketInt, 'Point Group ID', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Max Neighbors', { default_value: 4 });
    this.addOutput(NodeSocketGeometry, 'Curves');
    this.addOutput(NodeSocketInt, 'Closest Index');
    this.addOutput(NodeSocketFloat, 'Closest Weight');
  }
}

export class GeometryNodeOffsetPointInCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeOffsetPointInCurve';
  static override bl_label = 'Offset Point in Curve';
  static override category = 'Curve / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Point Index', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Offset', { default_value: 1 });
    this.addOutput(NodeSocketBool, 'Is Valid Offset');
    this.addOutput(NodeSocketInt, 'Point Index');
  }
}

export class GeometryNodePointsOfCurve extends GeoDataFlow {
  static override bl_idname = 'GeometryNodePointsOfCurve';
  static override bl_label = 'Points of Curve';
  static override category = 'Curve / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Curve Index', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Weights', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Sort Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Point Index');
    this.addOutput(NodeSocketInt, 'Total');
  }
}

export class GeometryNodeCurveOfPoint extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeCurveOfPoint';
  static override bl_label = 'Curve of Point';
  static override category = 'Curve / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Point Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Curve Index');
    this.addOutput(NodeSocketInt, 'Index in Curve');
  }
}

/* ────────────────── Topology read nodes (Edges/Faces of X) ────────────────── */

export class GeometryNodeEdgesOfVertex extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeEdgesOfVertex';
  static override bl_label = 'Edges of Vertex';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Vertex Index', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Weights', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Sort Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Edge Index');
    this.addOutput(NodeSocketInt, 'Total');
  }
}

export class GeometryNodeEdgesOfCorner extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeEdgesOfCorner';
  static override bl_label = 'Edges of Corner';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Corner Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Next Edge Index');
    this.addOutput(NodeSocketInt, 'Previous Edge Index');
  }
}

export class GeometryNodeCornersOfFace extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeCornersOfFace';
  static override bl_label = 'Corners of Face';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Face Index', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Weights', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Sort Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Corner Index');
    this.addOutput(NodeSocketInt, 'Total');
  }
}

export class GeometryNodeCornersOfVertex extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeCornersOfVertex';
  static override bl_label = 'Corners of Vertex';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Vertex Index', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Weights', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Sort Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Corner Index');
    this.addOutput(NodeSocketInt, 'Total');
  }
}

export class GeometryNodeFaceOfCorner extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeFaceOfCorner';
  static override bl_label = 'Face of Corner';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Corner Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Face Index');
    this.addOutput(NodeSocketInt, 'Index in Face');
  }
}

export class GeometryNodeVertexOfCorner extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeVertexOfCorner';
  static override bl_label = 'Vertex of Corner';
  static override category = 'Mesh / Read';
  static override node_kind: any = 'FIELD';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketInt, 'Corner Index', { default_value: 0 });
    this.addOutput(NodeSocketInt, 'Vertex Index');
  }
}

/* ────────────────── Strings / Text ────────────────── */

export class GeometryNodeStringToCurves extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeStringToCurves';
  static override bl_label = 'String to Curves';
  static override category = 'Curve / Primitives';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketString, 'String');
    this.addInput(NodeSocketFloat, 'Size', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Character Spacing', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Word Spacing', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Line Spacing', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Text Box Width', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Text Box Height', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Curve Instances');
    this.addOutput(NodeSocketInt, 'Remainder');
    this.addOutput(NodeSocketBool, 'Line');
    this.addOutput(NodeSocketVector, 'Pivot Point');
  }
}

/* ────────────────── Misc ────────────────── */

export class GeometryNodeMergeLayers extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeMergeLayers';
  static override bl_label = 'Merge Layers';
  static override category = 'Geometry / Operations';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketGeometry, 'Geometry');
    this.addInput(NodeSocketBool, 'Selection', { default_value: true });
    this.addInput(NodeSocketInt, 'Group ID', { default_value: 0 });
    this.addOutput(NodeSocketGeometry, 'Geometry');
  }
}

export class GeometryNodeBlurAttribute extends GeoDataFlow {
  static override bl_idname = 'GeometryNodeBlurAttribute';
  static override bl_label = 'Blur Attribute';
  static override category = 'Geometry / Attribute';
  static override properties = {
    data_type: EnumProperty({
      items: [['FLOAT', 'Float', ''], ['FLOAT_VECTOR', 'Vector', ''], ['FLOAT_COLOR', 'Color', '']],
      default: 'FLOAT', name: 'Type',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Iterations', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Weight', { default_value: 1 });
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

export class GeometryNodeImageTexture extends GeoDataFlow {
  // Geometry-context Image Texture (Blender 3.6+). For field evaluation.
  static override bl_idname = 'GeometryNodeImageTexture';
  static override bl_label = 'Image Texture';
  static override category = 'Geometry / Sample';
  static override node_kind: any = 'FIELD';
  static override properties = {
    interpolation: EnumProperty({
      items: [['Linear', 'Linear', ''], ['Closest', 'Closest', ''], ['Cubic', 'Cubic', '']],
      default: 'Linear', name: 'Interpolation',
    }),
    extension: EnumProperty({
      items: [['REPEAT', 'Repeat', ''], ['EXTEND', 'Extend', ''], ['CLIP', 'Clip', ''], ['MIRROR', 'Mirror', '']],
      default: 'REPEAT', name: 'Extension',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketString, 'Image');
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketInt, 'Frame', { default_value: 1 });
    this.addOutput(NodeSocketVector, 'Color');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

void BoolProperty;

let _registered = false;
export function registerMoreGeometryOps(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeRaycast, GeometryNodeExtrudeMesh,
    GeometryNodeDeleteGeometry, GeometryNodeSeparateGeometry, GeometryNodeDuplicateElements,
    GeometryNodeMeshToCurve, GeometryNodeMeshToVolume, GeometryNodeVolumeToMesh, GeometryNodePointsToVolume,
    GeometryNodeSplitEdges, GeometryNodeSubdivideMesh, GeometryNodeDualMesh, GeometryNodeScaleElements,
    GeometryNodeSampleNearestSurface, GeometryNodeSampleUVSurface,
    GeometryNodeInputMeshIsland, GeometryNodeInputShadeSmooth, GeometryNodeSetShadeSmooth,
    GeometryNodeInputMeshVertexNeighbors, GeometryNodeInputMeshFaceArea,
    GeometryNodeInputMeshEdgeAngle, GeometryNodeInputMeshEdgeVertices, GeometryNodeInputMeshFaceIsPlanar,
    GeometryNodeInterpolateCurves, GeometryNodeOffsetPointInCurve,
    GeometryNodePointsOfCurve, GeometryNodeCurveOfPoint,
    GeometryNodeEdgesOfVertex, GeometryNodeEdgesOfCorner,
    GeometryNodeCornersOfFace, GeometryNodeCornersOfVertex,
    GeometryNodeFaceOfCorner, GeometryNodeVertexOfCorner,
    GeometryNodeStringToCurves, GeometryNodeMergeLayers, GeometryNodeBlurAttribute,
    GeometryNodeImageTexture,
    // Suppress unused-rotation warning.
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
  void NodeSocketRotation;
}
