/**
 * GeometryNodeExecutors — per-node execution functions for geometry nodes.
 *
 * Incrementally migrates nodes from the GeometryEvaluator's inline instanceof
 * chain to the registry-based dispatch pattern. Nodes not yet migrated fall
 * through to the existing evaluator handlers.
 *
 * Register with `registerGeometryExecutors()` — called by bootstrapBuiltins().
 */

import type { Node } from '../../core/Node';
import type { NodeSocket } from '../../core/NodeSocket';
import type { ValueCache } from '../NodeExecute';
import { registerExecutor } from '../NodeExecute';
import type { Vec3 } from '../../core/types';
import {
  Geometry,
  buildCube, buildUVSphere, buildIcosphere, buildCylinder, buildCone,
  buildGrid, buildMeshLine, buildMeshCircle,
  buildCurveLine, buildCurveCircle, buildCurveSpiral, buildBezierSegment,
} from './Geometry';
import {
  Field, FieldKind, constField, indexField, idField, normalField, positionField,
  liftToField, isField,
} from './Field';
import {
  transformGeometry, joinGeometries,
  mergeByDistance, subdivisionSurface, triangulateMesh,
  fillCurve, filletCurve, subdivideCurve,
  reverseCurve, curveToMesh, curveToPoints, resampleCurve,
  flipFaces, meshToCurve, splitEdges,
  dualMesh, volumeToMesh,
  meshToVolume, pointsToVolume, mergeLayers,
  realizeInstances, convexHull, boundingBox,
  storeAttributeOn, stringToCurves,
} from './MeshOps';

/* ── Helpers ──────────────────────────────────────────────────── */

function resolveSocket(s: NodeSocket, cache: ValueCache): unknown {
  if (s.is_linked) {
    for (const l of s.links) { if (!l.is_muted && !l.escapes_zone) { const v = cache.get(l.from_socket.id); if (v !== undefined) return v; } }
  }
  return s.default_value;
}

function inp<T>(node: Node, name: string, cache: ValueCache, fb: T): T {
  const sock = node.inputs.find((s) => s.name === name || s.identifier === name);
  if (!sock) return fb;
  const v = resolveSocket(sock, cache);
  return (v !== undefined && v !== null) ? v as T : fb;
}

function out(node: Node, name: string, cache: ValueCache, value: unknown): void {
  const sock = node.outputs.find((s) => s.name === name || s.identifier === name);
  if (sock) cache.set(sock.id, value);
}

function nInp(node: Node, n: string, cache: ValueCache, fb = 0): number {
  const v = inp(node, n, cache, fb); return typeof v === 'number' ? v : Number(v ?? fb);
}
function vInp(node: Node, n: string, cache: ValueCache, fb: Vec3 = [0, 0, 0]): Vec3 {
  const v = inp(node, n, cache, fb); return (Array.isArray(v) && v.length >= 3) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] as Vec3 : fb;
}
function gInp(node: Node, n: string, cache: ValueCache, fb?: Geometry): Geometry {
  const v: unknown = inp(node, n, cache, undefined);
  if (v instanceof Geometry) return v;
  return fb ?? Geometry.empty();
}

let _registered = false;
export function registerGeometryExecutors(): void {
  if (_registered) return; _registered = true;

  // ── Primitives ────────────────────────────────────────────
  registerExecutor('GeometryNodeMeshCube', (node, cache) => {
    const s = vInp(node, 'Size', cache, [1, 1, 1]);
    const x = Math.max(2, nInp(node, 'Vertices X', cache, 2));
    const y = Math.max(2, nInp(node, 'Vertices Y', cache, 2));
    const z = Math.max(2, nInp(node, 'Vertices Z', cache, 2));
    const g = buildCube([s[0], s[1], s[2]]);
    out(node, 'Geometry', cache, g);
  });
  registerExecutor('GeometryNodeMeshUVSphere', (node, cache) => {
    out(node, 'Geometry', cache, buildUVSphere(nInp(node, 'Radius', cache, 1), nInp(node, 'Segments', cache, 32), nInp(node, 'Rings', cache, 16)));
  });
  registerExecutor('GeometryNodeMeshIcoSphere', (node, cache) => {
    out(node, 'Geometry', cache, buildIcosphere(nInp(node, 'Radius', cache, 1), nInp(node, 'Subdivisions', cache, 1)));
  });
  registerExecutor('GeometryNodeMeshCylinder', (node, cache) => {
    out(node, 'Geometry', cache, buildCylinder(nInp(node, 'Radius', cache, 1), nInp(node, 'Depth', cache, 2), nInp(node, 'Vertices', cache, 32), true));
  });
  registerExecutor('GeometryNodeMeshCone', (node, cache) => {
    out(node, 'Geometry', cache, buildCone(nInp(node, 'Radius 1', cache, 1), nInp(node, 'Radius 2', cache, 0), nInp(node, 'Depth', cache, 2), nInp(node, 'Vertices', cache, 32), true));
  });
  registerExecutor('GeometryNodeMeshGrid', (node, cache) => {
    out(node, 'Geometry', cache, buildGrid(nInp(node, 'Size X', cache, 1), nInp(node, 'Size Y', cache, 1), nInp(node, 'Vertices X', cache, 2), nInp(node, 'Vertices Y', cache, 2)));
  });
  registerExecutor('GeometryNodeMeshLine', (node, cache) => {
    out(node, 'Geometry', cache, buildMeshLine(nInp(node, 'Count', cache, 2), vInp(node, 'Start Location', cache), vInp(node, 'Offset', cache, [0, 0, 1])));
  });
  registerExecutor('GeometryNodeMeshCircle', (node, cache) => {
    out(node, 'Geometry', cache, buildMeshCircle(nInp(node, 'Vertices', cache, 32), nInp(node, 'Radius', cache, 1), 'NONE'));
  });

  // ── Curves ────────────────────────────────────────────────
  registerExecutor('GeometryNodeCurveLine', (node, cache) => {
    out(node, 'Geometry', cache, buildCurveLine(vInp(node, 'Start', cache), vInp(node, 'End', cache, [0, 0, 1]), 2));
  });
  registerExecutor('GeometryNodeCurveCircle', (node, cache) => {
    out(node, 'Geometry', cache, buildCurveCircle(nInp(node, 'Radius', cache, 1), nInp(node, 'Resolution', cache, 32)));
  });
  registerExecutor('GeometryNodeCurveBezierSegment', (node, cache) => {
    out(node, 'Geometry', cache, buildBezierSegment(vInp(node, 'Start', cache), vInp(node, 'Start Handle', cache, [0.33, 0, 0]), vInp(node, 'End Handle', cache, [0.66, 0, 1]), vInp(node, 'End', cache, [0, 0, 1]), nInp(node, 'Resolution', cache, 16)));
  });
  registerExecutor('GeometryNodeCurveSpiral', (node, cache) => {
    out(node, 'Geometry', cache, buildCurveSpiral(nInp(node, 'Resolution', cache, 32), nInp(node, 'Rotations', cache, 2), nInp(node, 'Start Radius', cache, 0.2), nInp(node, 'End Radius', cache, 1), nInp(node, 'Height', cache, 2)));
  });

  // ── Transform / Join ──────────────────────────────────────
  registerExecutor('GeometryNodeTransform', (node, cache) => {
    out(node, 'Geometry', cache, transformGeometry(gInp(node, 'Geometry', cache), vInp(node, 'Translation', cache), vInp(node, 'Rotation', cache), vInp(node, 'Scale', cache, [1, 1, 1])));
  });
  registerExecutor('GeometryNodeJoinGeometry', (node, cache) => {
    const geos: Geometry[] = [];
    for (const s of node.inputs) { const v = resolveSocket(s, cache); if (v instanceof Geometry) geos.push(v); }
    out(node, 'Geometry', cache, joinGeometries(geos));
  });

  // ── Ops (simple signatures) ───────────────────────────────
  registerExecutor('GeometryNodeMergeByDistance', (node, cache) => {
    out(node, 'Geometry', cache, mergeByDistance(gInp(node, 'Geometry', cache), null, nInp(node, 'Distance', cache, 0.001)));
  });
  registerExecutor('GeometryNodeSubdivisionSurface', (node, cache) => {
    out(node, 'Geometry', cache, subdivisionSurface(gInp(node, 'Geometry', cache), nInp(node, 'Level', cache, 1)));
  });
  registerExecutor('GeometryNodeTriangulate', (node, cache) => {
    out(node, 'Geometry', cache, triangulateMesh(gInp(node, 'Geometry', cache), null, 4));
  });
  registerExecutor('GeometryNodeFlipFaces', (node, cache) => {
    out(node, 'Geometry', cache, flipFaces(gInp(node, 'Geometry', cache), null));
  });
  registerExecutor('GeometryNodeRealizeInstances', (node, cache) => {
    out(node, 'Geometry', cache, realizeInstances(gInp(node, 'Geometry', cache)));
  });
  registerExecutor('GeometryNodeConvexHull', (node, cache) => {
    out(node, 'Geometry', cache, convexHull(gInp(node, 'Geometry', cache)));
  });

  // ── Curve ops ─────────────────────────────────────────────
  registerExecutor('GeometryNodeCurveToMesh', (node, cache) => {
    out(node, 'Geometry', cache, curveToMesh(gInp(node, 'Curve', cache), gInp(node, 'Profile Curve', cache), (node as unknown as { fill_caps?: boolean }).fill_caps ?? false));
  });
  registerExecutor('GeometryNodeCurveToPoints', (node, cache) => {
    const mode = ((node as unknown as { mode?: string }).mode ?? 'EVALUATED') as 'EVALUATED' | 'COUNT' | 'LENGTH';
    out(node, 'Geometry', cache, curveToPoints(gInp(node, 'Curve', cache), mode, nInp(node, 'Count', cache, 10), nInp(node, 'Length', cache, 0.1)));
  });
  registerExecutor('GeometryNodeResampleCurve', (node, cache) => {
    out(node, 'Geometry', cache, resampleCurve(gInp(node, 'Curve', cache), (node as unknown as { mode?: string }).mode as 'COUNT' | 'LENGTH' ?? 'COUNT', nInp(node, 'Count', cache, 10), nInp(node, 'Length', cache, 0.1)));
  });
  registerExecutor('GeometryNodeReverseCurve', (node, cache) => {
    out(node, 'Geometry', cache, reverseCurve(gInp(node, 'Curve', cache), null));
  });
  registerExecutor('GeometryNodeFilletCurve', (node, cache) => {
    out(node, 'Geometry', cache, filletCurve(gInp(node, 'Curve', cache), nInp(node, 'Radius', cache, 0.25)));
  });
  registerExecutor('GeometryNodeFillCurve', (node, cache) => {
    out(node, 'Geometry', cache, fillCurve(gInp(node, 'Curve', cache)));
  });
  registerExecutor('GeometryNodeSubdivideCurve', (node, cache) => {
    out(node, 'Geometry', cache, subdivideCurve(gInp(node, 'Curve', cache), nInp(node, 'Cuts', cache, 1)));
  });

  // ── Mesh ops ──────────────────────────────────────────────
  registerExecutor('GeometryNodeMeshToCurve', (node, cache) => {
    out(node, 'Geometry', cache, meshToCurve(gInp(node, 'Geometry', cache), null));
  });
  registerExecutor('GeometryNodeSplitEdges', (node, cache) => {
    out(node, 'Geometry', cache, splitEdges(gInp(node, 'Geometry', cache), new Int32Array(0)));
  });
  registerExecutor('GeometryNodeDualMesh', (node, cache) => {
    out(node, 'Geometry', cache, dualMesh(gInp(node, 'Mesh', cache), false));
  });

  // ── Volume ────────────────────────────────────────────────
  registerExecutor('GeometryNodeMeshToVolume', (node, cache) => {
    const res = nInp(node, 'Voxel Amount', cache, 32);
    out(node, 'Geometry', cache, meshToVolume(gInp(node, 'Geometry', cache), 1, 1 / Math.max(1, res), 2, 2, false));
  });
  registerExecutor('GeometryNodeVolumeToMesh', (node, cache) => {
    out(node, 'Geometry', cache, volumeToMesh(gInp(node, 'Volume', cache), nInp(node, 'Threshold', cache, 0.1)));
  });
  registerExecutor('GeometryNodePointsToVolume', (node, cache) => {
    const res = nInp(node, 'Voxel Amount', cache, 32);
    out(node, 'Geometry', cache, pointsToVolume(gInp(node, 'Points', cache), 1, 1 / Math.max(1, res), nInp(node, 'Radius', cache, 0.5)));
  });
  registerExecutor('GeometryNodeMergeLayers', (node, cache) => {
    const geos: Geometry[] = [];
    for (const s of node.inputs) { const v = resolveSocket(s, cache); if (v instanceof Geometry) geos.push(v); }
    out(node, 'Geometry', cache, mergeLayers(geos));
  });

  // ── Misc ──────────────────────────────────────────────────
  registerExecutor('GeometryNodeBoundBox', (node, cache) => {
    const result = boundingBox(gInp(node, 'Geometry', cache));
    out(node, 'Geometry', cache, result.geometry);
    out(node, 'Bounding Box', cache, [result.min, result.max]);
  });
  registerExecutor('GeometryNodeStringToCurves', (node, cache) => {
    out(node, 'Geometry', cache, stringToCurves(String(inp(node, 'String', cache, 'Text')), nInp(node, 'Size', cache, 1), nInp(node, 'Character Spacing', cache, 1), nInp(node, 'Word Spacing', cache, 1), nInp(node, 'Line Spacing', cache, 1), 0, 0));
  });

  // ── Field inputs ──────────────────────────────────────────
  registerExecutor('GeometryNodeInputPosition', (node, cache) => { out(node, 'Position', cache, positionField); });
  registerExecutor('GeometryNodeInputNormal', (node, cache) => { out(node, 'Normal', cache, normalField); });
  registerExecutor('GeometryNodeInputIndex', (node, cache) => { out(node, 'Index', cache, indexField); });
  registerExecutor('GeometryNodeInputID', (node, cache) => { out(node, 'ID', cache, idField); });

  // ── Capture / Store ───────────────────────────────────────
  registerExecutor('GeometryNodeCaptureAttribute', (node, cache) => {
    out(node, 'Geometry', cache, storeAttributeOn(gInp(node, 'Geometry', cache), '__capture__', 'POINT', 'FLOAT', new Float32Array(0), null));
  });
  registerExecutor('GeometryNodeStoreNamedAttribute', (node, cache) => {
    out(node, 'Geometry', cache, storeAttributeOn(gInp(node, 'Geometry', cache), String(inp(node, 'Name', cache, 'attribute')), 'POINT', 'FLOAT', new Float32Array(0), null));
  });
  registerExecutor('GeometryNodeSetShadeSmooth', (node, cache) => { out(node, 'Geometry', cache, gInp(node, 'Geometry', cache)); });
  registerExecutor('GeometryNodeRemoveAttribute', (node, cache) => { out(node, 'Geometry', cache, gInp(node, 'Geometry', cache)); });
}
