/**
 * CPU implementations of mesh-level operations used by GeometryEvaluator.
 *
 * Each function takes a Geometry (or component) and returns a new one;
 * inputs are never mutated.
 */
import type { Vec3 } from '../../core/types';
import {
  Geometry, MeshComponent, PointCloudComponent, InstancesComponent, CurvesComponent,
  newAttribute,
} from './Geometry';
import type { ScalarTypedArray } from './Geometry';

/* ------------------------------------------------------------------ */
/*  Transform                                                          */
/* ------------------------------------------------------------------ */

export function transformGeometry(geo: Geometry, t: Vec3, r: Vec3, s: Vec3): Geometry {
  const out = geo.cloneOwning();
  const [tx, ty, tz] = t;
  const [sx, sy, sz] = s;
  const [rx, ry, rz] = r;
  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);
  const r00 = cy * cz,                     r01 = -cy * szr,                     r02 = syr;
  const r10 = sxr * syr * cz + cx * szr,   r11 = -sxr * syr * szr + cx * cz,    r12 = -sxr * cy;
  const r20 = -cx * syr * cz + sxr * szr,  r21 = cx * syr * szr + sxr * cz,     r22 = cx * cy;

  const applyTo = (p: Float32Array): void => {
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]! * sx, y = p[i + 1]! * sy, z = p[i + 2]! * sz;
      p[i]     = r00 * x + r01 * y + r02 * z + tx;
      p[i + 1] = r10 * x + r11 * y + r12 * z + ty;
      p[i + 2] = r20 * x + r21 * y + r22 * z + tz;
    }
  };

  if (out.mesh) { applyTo(out.mesh.positions); out.mesh.invalidateCaches(); }
  if (out.curves) applyTo(out.curves.positions);
  if (out.points) applyTo(out.points.positions);
  // Instances: prepend our transform to each instance's matrix.
  if (out.instances) {
    const m = composeMat4(t, r, s);
    for (const it of out.instances.items) it.transform = mat4Mul(m, it.transform);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Join                                                              */
/* ------------------------------------------------------------------ */

export function joinGeometries(sources: Geometry[]): Geometry {
  if (sources.length === 0) return Geometry.empty();
  if (sources.length === 1) return sources[0]!;

  const out = new Geometry();

  // ---- Mesh: concat positions + reindex triangles
  const meshes = sources.map((s) => s.mesh).filter((m): m is MeshComponent => Boolean(m));
  if (meshes.length > 0) {
    let totalV = 0, totalT = 0;
    for (const m of meshes) { totalV += m.positions.length; totalT += m.triangles.length; }
    const positions = new Float32Array(totalV);
    const triangles = new Uint32Array(totalT);
    let vOff = 0, tOff = 0, vCount = 0;
    for (const m of meshes) {
      positions.set(m.positions, vOff);
      for (let i = 0; i < m.triangles.length; i++) triangles[tOff + i] = m.triangles[i]! + vCount;
      vOff += m.positions.length;
      tOff += m.triangles.length;
      vCount += m.numVerts;
    }
    out.mesh = new MeshComponent(positions, triangles);
  }

  // ---- Points: concat positions + radii
  const pts = sources.map((s) => s.points).filter((p): p is PointCloudComponent => Boolean(p));
  if (pts.length > 0) {
    let total = 0;
    for (const p of pts) total += p.numPoints;
    const positions = new Float32Array(total * 3);
    const radii = new Float32Array(total);
    let off = 0;
    for (const p of pts) {
      positions.set(p.positions, off * 3);
      radii.set(p.radii, off);
      off += p.numPoints;
    }
    out.points = new PointCloudComponent(positions, radii);
  }

  // ---- Curves: concat positions + offsets
  const curves = sources.map((s) => s.curves).filter((c): c is CurvesComponent => Boolean(c));
  if (curves.length > 0) {
    let totalP = 0, totalC = 0;
    for (const c of curves) { totalP += c.numPoints; totalC += c.numCurves; }
    const positions = new Float32Array(totalP * 3);
    const offsets = new Uint32Array(totalC + 1);
    const cyclic = new Uint8Array(totalC);
    const res = new Uint16Array(totalC);
    let pOff = 0, cOff = 0;
    for (const c of curves) {
      positions.set(c.positions, pOff * 3);
      for (let i = 0; i < c.numCurves; i++) {
        offsets[cOff + i] = (c.curveOffsets[i] ?? 0) + pOff;
        cyclic[cOff + i] = c.cyclic[i] ?? 0;
        res[cOff + i] = c.resolution[i] ?? 12;
      }
      pOff += c.numPoints;
      cOff += c.numCurves;
    }
    offsets[totalC] = totalP;
    // late import to avoid circular type
    
    out.curves = new CurvesComponent(positions, offsets, cyclic, res);
  }

  // ---- Instances: merge sources + offset indices
  const insts = sources.map((s) => s.instances).filter((i): i is InstancesComponent => Boolean(i));
  if (insts.length > 0) {
    const ic = new InstancesComponent();
    for (const i of insts) {
      const baseIdx = ic.sources.length;
      ic.sources.push(...i.sources);
      for (const it of i.items) {
        ic.items.push({ source: it.source + baseIdx, transform: new Float32Array(it.transform) });
      }
    }
    out.instances = ic;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  Set Position                                                      */
/* ------------------------------------------------------------------ */

/**
 * Sets position for each point where `selection[i]` is truthy:
 *   pos[i] = (position ?? pos[i]) + offset[i]
 *
 * `positionOverride` may be null to mean "keep current position".
 */
export function setPosition(
  geo: Geometry,
  selection: ScalarTypedArray | null,
  positionOverride: Float32Array | null,
  offset: Float32Array | null,
): Geometry {
  const out = geo.cloneOwning();
  // Apply to mesh point domain (the common case).
  const components: { positions: Float32Array }[] = [];
  if (out.mesh) components.push(out.mesh);
  if (out.curves) components.push(out.curves);
  if (out.points) components.push(out.points);
  for (const comp of components) {
    const p = comp.positions;
    const n = p.length / 3;
    for (let i = 0; i < n; i++) {
      if (selection && !selection[i]) continue;
      let x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
      if (positionOverride && positionOverride.length >= (i + 1) * 3) {
        x = positionOverride[i * 3]!;
        y = positionOverride[i * 3 + 1]!;
        z = positionOverride[i * 3 + 2]!;
      }
      if (offset && offset.length >= (i + 1) * 3) {
        x += offset[i * 3]!;
        y += offset[i * 3 + 1]!;
        z += offset[i * 3 + 2]!;
      }
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    }
  }
  if (out.mesh) out.mesh.invalidateCaches();
  return out;
}

/* ------------------------------------------------------------------ */
/*  Capture / Store Named Attribute                                   */
/* ------------------------------------------------------------------ */

export function storeAttributeOn(
  geo: Geometry,
  name: string,
  domain: import('../../core/types').AttributeDomain,
  dataType: 'FLOAT' | 'INT' | 'BOOL' | 'FLOAT_VECTOR' | 'FLOAT_COLOR',
  data: ScalarTypedArray,
  selection?: ScalarTypedArray | null,
): Geometry {
  const out = geo.cloneOwning();
  const blenderToAttr = {
    FLOAT: 'FLOAT', INT: 'INT', BOOL: 'BOOL',
    FLOAT_VECTOR: 'VECTOR', FLOAT_COLOR: 'COLOR',
  } as const;
  const ourType = blenderToAttr[dataType];
  const size = out.domainSize(domain);
  const dims = ourType === 'VECTOR' ? 3 : ourType === 'COLOR' ? 4 : 1;
  const map = out.attributesForDomain(domain);
  const existing = map?.get(name);
  // Use newAttribute to get the right typed array, then copy/overwrite
  // with our (already correctly sized) data.
  const a = newAttribute(name, domain, ourType, size);
  const dst = a.data;

  // Seed from existing values when present so Selection can preserve untouched
  // elements. Otherwise seed with zeros.
  if (existing) {
    const seedLen = Math.min(dst.length, existing.data.length);
    if (dst.constructor === existing.data.constructor) {
      dst.set(existing.data.subarray(0, seedLen) as never);
    } else {
      for (let i = 0; i < seedLen; i++) (dst as unknown as number[])[i] = existing.data[i] as number;
    }
  }

  const sourceDims = Math.max(1, Math.round(data.length / Math.max(1, size)));
  const logicalSize = Math.min(size, selection ? selection.length : size, Math.floor(data.length / Math.max(1, sourceDims)));
  const writeConverted = (i: number): void => {
    for (let d = 0; d < dims; d++) {
      const srcIndex = i * sourceDims + Math.min(d, sourceDims - 1);
      (dst as unknown as number[])[i * dims + d] = data[srcIndex] as number;
    }
  };
  if (selection) {
    for (let i = 0; i < logicalSize; i++) {
      if (!(selection[i] as number)) continue;
      writeConverted(i);
    }
  } else {
    for (let i = 0; i < logicalSize; i++) writeConverted(i);
  }

  if (map) map.set(name, a);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Bounding Box                                                      */
/* ------------------------------------------------------------------ */

function collectPositions(geo: Geometry): number[] {
  const pts: number[] = [];
  const add = (p?: Float32Array): void => {
    if (!p) return;
    for (let i = 0; i < p.length; i += 3) pts.push(p[i]!, p[i + 1]!, p[i + 2]!);
  };
  add(geo.mesh?.positions);
  add(geo.points?.positions);
  add(geo.curves?.positions);
  return pts;
}

export function boundingBox(geo: Geometry): { min: Vec3; max: Vec3; geometry: Geometry } {
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  const accum = (p: Float32Array): void => {
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
  };
  if (geo.mesh) accum(geo.mesh.positions);
  if (geo.curves) accum(geo.curves.positions);
  if (geo.points) accum(geo.points.positions);
  if (!isFinite(mnx)) {
    mnx = mny = mnz = 0;
    mxx = mxy = mxz = 0;
  }
  // build a 8-vert mesh as the bounding box output
  const verts = new Float32Array([
    mnx, mny, mnz,  mxx, mny, mnz,  mxx, mxy, mnz,  mnx, mxy, mnz,
    mnx, mny, mxz,  mxx, mny, mxz,  mxx, mxy, mxz,  mnx, mxy, mxz,
  ]);
  const tris = new Uint32Array([
    0, 2, 1, 0, 3, 2,  4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,  2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,  0, 4, 7, 0, 7, 3,
  ]);
  const out = new Geometry();
  out.mesh = new MeshComponent(verts, tris);
  return { min: [mnx, mny, mnz], max: [mxx, mxy, mxz], geometry: out };
}

/* ------------------------------------------------------------------ */
/*  Convex Hull                                                       */
/* ------------------------------------------------------------------ */

/**
 * Naive 3D convex hull for modest node-graph meshes/point clouds. It tests
 * every point triple and keeps triangles whose supporting plane has all
 * points on one side. Coplanar faces may be over-triangulated, but the result
 * is a valid closed hull boundary for non-degenerate input.
 */
export function convexHull(geo: Geometry): Geometry {
  const raw = collectPositions(geo);
  if (raw.length === 0) return Geometry.empty();

  // Deduplicate positions so coplanar duplicate verts don't explode faces.
  const pts: number[] = [];
  const seen = new Set<string>();
  const q = (x: number) => Math.round(x * 1e6) / 1e6;
  for (let i = 0; i < raw.length; i += 3) {
    const x = q(raw[i]!), y = q(raw[i + 1]!), z = q(raw[i + 2]!);
    const k = `${x},${y},${z}`;
    if (seen.has(k)) continue;
    seen.add(k); pts.push(x, y, z);
  }
  const n = pts.length / 3;
  const out = new Geometry();
  if (n < 3) { out.mesh = new MeshComponent(new Float32Array(pts), new Uint32Array()); return out; }
  if (n === 3) { out.mesh = new MeshComponent(new Float32Array(pts), new Uint32Array([0, 1, 2])); return out; }

  const cx = (() => { let s = 0; for (let i = 0; i < n; i++) s += pts[i * 3]!; return s / n; })();
  const cy = (() => { let s = 0; for (let i = 0; i < n; i++) s += pts[i * 3 + 1]!; return s / n; })();
  const cz = (() => { let s = 0; for (let i = 0; i < n; i++) s += pts[i * 3 + 2]!; return s / n; })();

  const tris: number[] = [];
  const faceKeys = new Set<string>();
  const eps = 1e-6;
  for (let i = 0; i < n - 2; i++) for (let j = i + 1; j < n - 1; j++) for (let k = j + 1; k < n; k++) {
    const ax = pts[i * 3]!, ay = pts[i * 3 + 1]!, az = pts[i * 3 + 2]!;
    const bx = pts[j * 3]!, by = pts[j * 3 + 1]!, bz = pts[j * 3 + 2]!;
    const cxp = pts[k * 3]!, cyp = pts[k * 3 + 1]!, czp = pts[k * 3 + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cxp - ax, vy = cyp - ay, vz = czp - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < eps) continue;
    nx /= len; ny /= len; nz /= len;

    let pos = false, neg = false;
    for (let p = 0; p < n; p++) {
      if (p === i || p === j || p === k) continue;
      const d = nx * (pts[p * 3]! - ax) + ny * (pts[p * 3 + 1]! - ay) + nz * (pts[p * 3 + 2]! - az);
      if (d > eps) pos = true; else if (d < -eps) neg = true;
      if (pos && neg) break;
    }
    if (pos && neg) continue;

    const sortedKey = [i, j, k].sort((a, b) => a - b).join('_');
    if (faceKeys.has(sortedKey)) continue;
    faceKeys.add(sortedKey);
    // Orient outward: normal should point away from centroid.
    const fcX = (ax + bx + cxp) / 3, fcY = (ay + by + cyp) / 3, fcZ = (az + bz + czp) / 3;
    const outward = nx * (fcX - cx) + ny * (fcY - cy) + nz * (fcZ - cz) >= 0;
    if (outward) tris.push(i, j, k); else tris.push(i, k, j);
  }

  out.mesh = new MeshComponent(new Float32Array(pts), new Uint32Array(tris));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Merge by Distance                                                 */
/* ------------------------------------------------------------------ */

/** Simple grid-based vertex welder. O(n) average. */
export function mergeByDistance(
  geo: Geometry,
  selection: ScalarTypedArray | null,
  distance: number,
): Geometry {
  if (!geo.mesh || distance <= 0) return geo;
  const m = geo.mesh;
  const cellSize = Math.max(distance, 1e-6);
  const cells = new Map<string, number>();   // cellKey -> representative vert
  const remap = new Int32Array(m.numVerts);
  const newPositions: number[] = [];

  const key = (x: number, y: number, z: number): string =>
    `${Math.floor(x / cellSize)}_${Math.floor(y / cellSize)}_${Math.floor(z / cellSize)}`;

  for (let i = 0; i < m.numVerts; i++) {
    const x = m.positions[i * 3]!;
    const y = m.positions[i * 3 + 1]!;
    const z = m.positions[i * 3 + 2]!;
    if (selection && !selection[i]) {
      // never merge unselected verts
      remap[i] = newPositions.length / 3;
      newPositions.push(x, y, z);
      continue;
    }
    const k = key(x, y, z);
    const existing = cells.get(k);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      const ni = newPositions.length / 3;
      cells.set(k, ni);
      remap[i] = ni;
      newPositions.push(x, y, z);
    }
  }
  const positions = new Float32Array(newPositions);
  // Rebuild triangles, dropping degenerate ones.
  const trisOut: number[] = [];
  for (let i = 0; i < m.numTris; i++) {
    const a = remap[m.triangles[i * 3]!]!;
    const b = remap[m.triangles[i * 3 + 1]!]!;
    const c = remap[m.triangles[i * 3 + 2]!]!;
    if (a !== b && b !== c && a !== c) trisOut.push(a, b, c);
  }
  const out = geo.copy();
  out.mesh = new MeshComponent(positions, new Uint32Array(trisOut));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Loop subdivision (one pass; iterate for higher levels)            */
/* ------------------------------------------------------------------ */

export function subdivideLoopOnce(mesh: MeshComponent): MeshComponent {
  const positions = mesh.positions;
  const tris = mesh.triangles;
  const nV = mesh.numVerts, nT = mesh.numTris;
  // Build edge → newVertexIndex map and adjacency for smoothing.
  const edgeKey = (a: number, b: number): string => a < b ? `${a}_${b}` : `${b}_${a}`;
  const edgeMid = new Map<string, number>();
  const edgeFaces = new Map<string, number[]>();
  const vAdj: Set<number>[] = Array.from({ length: nV }, () => new Set<number>());
  for (let i = 0; i < nT; i++) {
    const a = tris[i * 3]!, b = tris[i * 3 + 1]!, c = tris[i * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      vAdj[u]!.add(v); vAdj[v]!.add(u);
      const k = edgeKey(u, v);
      (edgeFaces.get(k) ?? edgeFaces.set(k, []).get(k)!).push(i);
    }
  }

  const newPositions: number[] = Array.from(positions);

  // Loop subdivision odd vertices: 3/8 * (a+b) + 1/8 * (c+d) on interior
  // edges; (a+b)/2 on boundary.
  for (const [k, faceIdxs] of edgeFaces) {
    const [aStr, bStr] = k.split('_');
    const a = parseInt(aStr!, 10), b = parseInt(bStr!, 10);
    let x: number, y: number, z: number;
    if (faceIdxs.length === 2) {
      const opposites: number[] = [];
      for (const fi of faceIdxs) {
        for (let k2 = 0; k2 < 3; k2++) {
          const v = tris[fi * 3 + k2]!;
          if (v !== a && v !== b) { opposites.push(v); break; }
        }
      }
      const c = opposites[0]!, d = opposites[1]!;
      x = (3 / 8) * (positions[a * 3]! + positions[b * 3]!) + (1 / 8) * (positions[c * 3]! + positions[d * 3]!);
      y = (3 / 8) * (positions[a * 3 + 1]! + positions[b * 3 + 1]!) + (1 / 8) * (positions[c * 3 + 1]! + positions[d * 3 + 1]!);
      z = (3 / 8) * (positions[a * 3 + 2]! + positions[b * 3 + 2]!) + (1 / 8) * (positions[c * 3 + 2]! + positions[d * 3 + 2]!);
    } else {
      x = (positions[a * 3]! + positions[b * 3]!) / 2;
      y = (positions[a * 3 + 1]! + positions[b * 3 + 1]!) / 2;
      z = (positions[a * 3 + 2]! + positions[b * 3 + 2]!) / 2;
    }
    edgeMid.set(k, newPositions.length / 3);
    newPositions.push(x, y, z);
  }

  // Even vertex smoothing.
  const smoothed = new Float32Array(nV * 3);
  for (let v = 0; v < nV; v++) {
    const adj = vAdj[v]!;
    const n = adj.size;
    if (n === 0) {
      smoothed[v * 3]     = positions[v * 3]!;
      smoothed[v * 3 + 1] = positions[v * 3 + 1]!;
      smoothed[v * 3 + 2] = positions[v * 3 + 2]!;
      continue;
    }
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
    let sx = 0, sy = 0, sz = 0;
    for (const a of adj) { sx += positions[a * 3]!; sy += positions[a * 3 + 1]!; sz += positions[a * 3 + 2]!; }
    smoothed[v * 3]     = (1 - n * beta) * positions[v * 3]!     + beta * sx;
    smoothed[v * 3 + 1] = (1 - n * beta) * positions[v * 3 + 1]! + beta * sy;
    smoothed[v * 3 + 2] = (1 - n * beta) * positions[v * 3 + 2]! + beta * sz;
  }
  for (let v = 0; v < nV; v++) {
    newPositions[v * 3]     = smoothed[v * 3]!;
    newPositions[v * 3 + 1] = smoothed[v * 3 + 1]!;
    newPositions[v * 3 + 2] = smoothed[v * 3 + 2]!;
  }

  // Rebuild triangles: each triangle (a,b,c) → 4 triangles using edge midpoints.
  const newTris: number[] = [];
  for (let i = 0; i < nT; i++) {
    const a = tris[i * 3]!, b = tris[i * 3 + 1]!, c = tris[i * 3 + 2]!;
    const ab = edgeMid.get(edgeKey(a, b))!;
    const bc = edgeMid.get(edgeKey(b, c))!;
    const ca = edgeMid.get(edgeKey(c, a))!;
    newTris.push(a, ab, ca);
    newTris.push(b, bc, ab);
    newTris.push(c, ca, bc);
    newTris.push(ab, bc, ca);
  }
  return new MeshComponent(new Float32Array(newPositions), new Uint32Array(newTris));
}

export function subdivisionSurface(geo: Geometry, levels: number): Geometry {
  if (!geo.mesh || levels <= 0) return geo;
  let m = geo.mesh;
  for (let i = 0; i < levels; i++) m = subdivideLoopOnce(m);
  const out = geo.copy();
  out.mesh = m;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Mesh ↔ Points                                                     */
/* ------------------------------------------------------------------ */

export function meshToPoints(
  geo: Geometry,
  selection: ScalarTypedArray | null,
  positionsOverride: Float32Array | null,
  radii: ScalarTypedArray | null,
  mode: 'VERTICES' | 'EDGES' | 'FACES' | 'CORNERS',
): Geometry {
  if (!geo.mesh) return Geometry.empty();
  const m = geo.mesh;
  const out = new Geometry();

  const pickPos = (logicalIndex: number, fallback: Vec3): Vec3 => {
    if (!positionsOverride || positionsOverride.length < (logicalIndex + 1) * 3) return fallback;
    return [
      positionsOverride[logicalIndex * 3]!,
      positionsOverride[logicalIndex * 3 + 1]!,
      positionsOverride[logicalIndex * 3 + 2]!,
    ];
  };
  const pickRadius = (logicalIndex: number): number => radii ? ((radii[logicalIndex] as number) ?? 0.05) : 0.05;
  const selected = (logicalIndex: number): boolean => !selection || !!selection[logicalIndex];

  if (mode === 'VERTICES' || mode === 'CORNERS') {
    const sourceCount = mode === 'VERTICES' ? m.numVerts : m.numCorners;
    const positions = new Float32Array(sourceCount * 3);
    const radiiArr = new Float32Array(sourceCount);
    let outCount = 0;
    if (mode === 'VERTICES') {
      for (let i = 0; i < m.numVerts; i++) {
        if (!selected(i)) continue;
        const p = pickPos(i, [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!]);
        positions[outCount * 3] = p[0];
        positions[outCount * 3 + 1] = p[1];
        positions[outCount * 3 + 2] = p[2];
        radiiArr[outCount] = pickRadius(i);
        outCount++;
      }
    } else {
      for (let i = 0; i < m.numCorners; i++) {
        if (!selected(i)) continue;
        const v = m.triangles[i] ?? 0;
        const p = pickPos(i, [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!]);
        positions[outCount * 3] = p[0];
        positions[outCount * 3 + 1] = p[1];
        positions[outCount * 3 + 2] = p[2];
        radiiArr[outCount] = pickRadius(i);
        outCount++;
      }
    }
    out.points = new PointCloudComponent(positions.subarray(0, outCount * 3), radiiArr.subarray(0, outCount));
    return out;
  }

  if (mode === 'FACES') {
    const positions = new Float32Array(m.numTris * 3);
    const radiiArr = new Float32Array(m.numTris);
    let outCount = 0;
    for (let i = 0; i < m.numTris; i++) {
      if (!selected(i)) continue;
      const a = m.triangles[i * 3]! * 3, b = m.triangles[i * 3 + 1]! * 3, c = m.triangles[i * 3 + 2]! * 3;
      const centroid: Vec3 = [
        (m.positions[a]! + m.positions[b]! + m.positions[c]!) / 3,
        (m.positions[a + 1]! + m.positions[b + 1]! + m.positions[c + 1]!) / 3,
        (m.positions[a + 2]! + m.positions[b + 2]! + m.positions[c + 2]!) / 3,
      ];
      const p = pickPos(i, centroid);
      positions[outCount * 3] = p[0];
      positions[outCount * 3 + 1] = p[1];
      positions[outCount * 3 + 2] = p[2];
      radiiArr[outCount] = pickRadius(i);
      outCount++;
    }
    out.points = new PointCloudComponent(positions.subarray(0, outCount * 3), radiiArr.subarray(0, outCount));
    return out;
  }

  // EDGES: midpoint of each unique edge. Selection/Position/Radius are in EDGE domain.
  const points: number[] = [];
  const radiiOut: number[] = [];
  const seen = new Map<string, number>();
  const t = m.triangles, p = m.positions;
  let edgeIndex = 0;
  for (let i = 0; i < m.numTris; i++) {
    const a = t[i * 3]!, b = t[i * 3 + 1]!, c = t[i * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (seen.has(k)) continue;
      seen.set(k, edgeIndex++);
      const midpoint: Vec3 = [
        (p[u * 3]! + p[v * 3]!) / 2,
        (p[u * 3 + 1]! + p[v * 3 + 1]!) / 2,
        (p[u * 3 + 2]! + p[v * 3 + 2]!) / 2,
      ];
      const logicalIndex = seen.get(k)!;
      if (!selected(logicalIndex)) continue;
      const pos = pickPos(logicalIndex, midpoint);
      points.push(pos[0], pos[1], pos[2]);
      radiiOut.push(pickRadius(logicalIndex));
    }
  }
  out.points = new PointCloudComponent(new Float32Array(points), new Float32Array(radiiOut));
  return out;
}

export function pointsToVertices(geo: Geometry, selection: ScalarTypedArray | null): Geometry {
  if (!geo.points) return Geometry.empty();
  const pc = geo.points;
  const idxs: number[] = [];
  for (let i = 0; i < pc.numPoints; i++) if (!selection || selection[i]) idxs.push(i);
  const positions = new Float32Array(idxs.length * 3);
  for (let k = 0; k < idxs.length; k++) {
    const v = idxs[k]!;
    positions[k * 3]     = pc.positions[v * 3]!;
    positions[k * 3 + 1] = pc.positions[v * 3 + 1]!;
    positions[k * 3 + 2] = pc.positions[v * 3 + 2]!;
  }
  const out = new Geometry();
  out.mesh = new MeshComponent(positions, new Uint32Array());
  return out;
}

/* ------------------------------------------------------------------ */
/*  Distribute Points on Faces                                        */
/* ------------------------------------------------------------------ */

/** Seeded PRNG (xorshift32). */
function makeRng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

export function distributePointsOnFaces(
  geo: Geometry,
  density: number,
  seed: number,
  method: 'RANDOM' | 'POISSON',
  distanceMin: number,
  selection?: ScalarTypedArray | null,
  densityFactor?: ScalarTypedArray | null,
): { points: Geometry; normals: Float32Array; rotations: Float32Array } {
  if (!geo.mesh) return { points: Geometry.empty(), normals: new Float32Array(), rotations: new Float32Array() };
  const m = geo.mesh;
  const areas = m.faceAreas();
  const faceNormals = m.faceNormals();
  const rng = makeRng(seed);

  const includedFaces: number[] = [];
  let weightedArea = 0;
  for (let f = 0; f < m.numTris; f++) {
    if (selection && !(selection[f] as number)) continue;
    const factor = densityFactor ? Math.max(0, Number(densityFactor[f] ?? 0)) : 1;
    const weight = areas[f]! * factor;
    if (weight <= 0) continue;
    includedFaces.push(f);
    weightedArea += weight;
  }
  if (includedFaces.length === 0 || weightedArea <= 1e-9) {
    return { points: Geometry.empty(), normals: new Float32Array(), rotations: new Float32Array() };
  }

  // Per-face Poisson sampling: each face independently draws
  //   floor(expected) + Bernoulli(frac)  points
  // where expected = faceArea * densityFactor * density.
  //
  // This is mathematically equivalent to a spatial Poisson process and handles
  // meshes with many small triangles (e.g. UV spheres) correctly — the old
  // approach used proportional rounding which caused all small faces to get 0
  // points whenever the per-face expected count < 0.5.
  const posDensity = Math.max(0, density);
  const positions: number[] = [];
  const normalsOut: number[] = [];
  for (const f of includedFaces) {
    const factor = densityFactor ? Math.max(0, Number(densityFactor[f] ?? 0)) : 1;
    const expected = areas[f]! * factor * posDensity;
    // Deterministic floor + probabilistic rounding of the fractional part.
    const floor = Math.floor(expected);
    const frac = expected - floor;
    const facePts = floor + (rng() < frac ? 1 : 0);
    if (facePts === 0) continue;
    const a = m.triangles[f * 3]! * 3, b = m.triangles[f * 3 + 1]! * 3, c = m.triangles[f * 3 + 2]! * 3;
    const nx = faceNormals[f * 3]!, ny = faceNormals[f * 3 + 1]!, nz = faceNormals[f * 3 + 2]!;
    for (let k = 0; k < facePts; k++) {
      let u = rng(), v = rng();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      positions.push(
        m.positions[a]! * w + m.positions[b]! * u + m.positions[c]! * v,
        m.positions[a + 1]! * w + m.positions[b + 1]! * u + m.positions[c + 1]! * v,
        m.positions[a + 2]! * w + m.positions[b + 2]! * u + m.positions[c + 2]! * v,
      );
      normalsOut.push(nx, ny, nz);
    }
  }

  // Poisson disk filtering: O(n^2) brute force; good enough for the M2/M3
  // pass on small/medium meshes.
  let finalPositions = positions;
  let finalNormals = normalsOut;
  if (method === 'POISSON' && distanceMin > 0) {
    const minSq = distanceMin * distanceMin;
    const accP: number[] = [];
    const accN: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
      let keep = true;
      for (let j = 0; j < accP.length; j += 3) {
        const dx = accP[j]! - x, dy = accP[j + 1]! - y, dz = accP[j + 2]! - z;
        if (dx * dx + dy * dy + dz * dz < minSq) { keep = false; break; }
      }
      if (keep) {
        accP.push(x, y, z);
        accN.push(normalsOut[i]!, normalsOut[i + 1]!, normalsOut[i + 2]!);
      }
    }
    finalPositions = accP;
    finalNormals = accN;
  }

  const pts = new PointCloudComponent(new Float32Array(finalPositions));
  const out = new Geometry();
  out.points = pts;

  // Build an XYZ-Euler rotation that aligns Z to the normal (simple variant).
  const rotations = new Float32Array((finalPositions.length / 3) * 3);
  for (let i = 0; i < finalPositions.length / 3; i++) {
    const nx = finalNormals[i * 3]!, ny = finalNormals[i * 3 + 1]!, nz = finalNormals[i * 3 + 2]!;
    rotations[i * 3]     = Math.atan2(ny, nz);
    rotations[i * 3 + 1] = Math.atan2(-nx, Math.hypot(ny, nz));
    rotations[i * 3 + 2] = 0;
  }

  // Store companion attributes on the emitted point cloud so downstream field
  // consumers (e.g. Instance on Points.Rotation) can read them naturally.
  pts.attributes.set('normal', {
    name: 'normal', domain: 'POINT', dimensions: 3, data_type: 'VECTOR', data: new Float32Array(finalNormals),
  });
  pts.attributes.set('rotation', {
    name: 'rotation', domain: 'POINT', dimensions: 3, data_type: 'VECTOR', data: rotations,
  });
  return {
    points: out,
    normals: new Float32Array(finalNormals),
    rotations,
  };
}

/* ------------------------------------------------------------------ */
/*  Instance on Points                                                */
/* ------------------------------------------------------------------ */

export function instanceOnPoints(
  pointsGeo: Geometry,
  instance: Geometry,
  selection: ScalarTypedArray | null,
  pickInstance: boolean,
  instanceIndex: ScalarTypedArray | null,
  rotations: Float32Array | null,
  scales: Float32Array | null,
): Geometry {
  const pos =
    pointsGeo.points?.positions ??
    pointsGeo.mesh?.positions ??
    new Float32Array();
  const n = pos.length / 3;
  const ic = new InstancesComponent();

  const candidates: Geometry[] = [];
  if (pickInstance && instance.instances && instance.instances.items.length > 0) {
    for (const item of instance.instances.items) {
      const src = instance.instances.sources[item.source];
      if (!src) continue;
      const g = src.cloneOwning();
      transformMatBaked(g, item.transform);
      candidates.push(g);
    }
  } else if (instance.mesh || instance.curves || instance.points || instance.instances) {
    candidates.push(instance.cloneOwning());
  }
  if (candidates.length === 0) return new Geometry();
  ic.sources.push(...candidates);

  for (let i = 0; i < n; i++) {
    if (selection && !selection[i]) continue;
    const t: Vec3 = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    const r: Vec3 = rotations
      ? [rotations[i * 3]!, rotations[i * 3 + 1]!, rotations[i * 3 + 2]!]
      : [0, 0, 0];
    const s: Vec3 = scales
      ? [scales[i * 3]!, scales[i * 3 + 1]!, scales[i * 3 + 2]!]
      : [1, 1, 1];
    let source = 0;
    if (pickInstance && candidates.length > 1) {
      const idx = instanceIndex ? Math.round(Number(instanceIndex[i] ?? 0)) : i;
      source = ((idx % candidates.length) + candidates.length) % candidates.length;
    }
    ic.items.push({ source, transform: composeMat4(t, r, s) });
  }
  const out = new Geometry();
  out.instances = ic;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Realize Instances                                                  */
/* ------------------------------------------------------------------ */

export function realizeInstances(geo: Geometry): Geometry {
  if (!geo.instances) return geo;
  const realised: Geometry[] = [];
  // keep any existing components (carry the non-instance parts through)
  const carry = new Geometry();
  if (geo.mesh) carry.mesh = geo.mesh;
  if (geo.curves) carry.curves = geo.curves;
  if (geo.points) carry.points = geo.points;
  if (carry.mesh || carry.curves || carry.points) realised.push(carry);

  for (const it of geo.instances.items) {
    const src = geo.instances.sources[it.source];
    if (!src) continue;
    const cloned = src.cloneOwning();
    transformMatBaked(cloned, it.transform);
    if (cloned.instances) {
      const expanded = realizeInstances(cloned);
      realised.push(expanded);
    } else {
      realised.push(cloned);
    }
  }
  return joinGeometries(realised);
}

function transformMatBaked(geo: Geometry, m: Float32Array): void {
  const applyTo = (p: Float32Array): void => {
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
      p[i]     = m[0]! * x + m[4]! * y + m[8]!  * z + m[12]!;
      p[i + 1] = m[1]! * x + m[5]! * y + m[9]!  * z + m[13]!;
      p[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    }
  };
  if (geo.mesh) { applyTo(geo.mesh.positions); geo.mesh.invalidateCaches(); }
  if (geo.curves) applyTo(geo.curves.positions);
  if (geo.points) applyTo(geo.points.positions);
}

/* ------------------------------------------------------------------ */
/*  Curve helpers / Curve to Mesh / Curve to Points / Resample        */
/* ------------------------------------------------------------------ */

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function stableCurveNormal(tx: number, ty: number, tz: number): Vec3 {
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(ty) > 0.9) { rx = 1; ry = 0; rz = 0; }
  let bx = ry * tz - rz * ty;
  let by = rz * tx - rx * tz;
  let bz = rx * ty - ry * tx;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  let nx = ty * bz - tz * by;
  let ny = tz * bx - tx * bz;
  let nz = tx * by - ty * bx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  return [nx, ny, nz];
}

function averagedScalarAt(data: ScalarTypedArray | undefined, dims: number, pointIndex: number): number {
  if (!data || dims <= 0) return 0;
  if (dims === 1) return (data[pointIndex] as number) ?? 0;
  let sum = 0;
  const base = pointIndex * dims;
  for (let k = 0; k < dims; k++) sum += (data[base + k] as number) ?? 0;
  return sum / dims;
}

export interface CurveSample {
  position: Vec3;
  tangent: Vec3;
  normal: Vec3;
  value: number;
  index: number;
  curveIndex: number;
}

/**
 * Sample the input curves at a normalized factor in [0,1].
 *
 * Current approximation for multi-curve geometry: the factor first selects a
 * curve by evenly partitioning [0,1] across the curve count, then samples
 * within that curve by local factor. For single-curve inputs this matches the
 * expected behaviour directly.
 */
export function sampleCurveAtFactor(
  geo: Geometry,
  factor: number,
  values?: ScalarTypedArray,
  valueDims = 1,
): CurveSample {
  const curves = geo.curves;
  if (!curves || curves.numCurves === 0 || curves.numPoints === 0) {
    return {
      position: [0, 0, 0], tangent: [0, 0, 1], normal: [0, 1, 0], value: 0, index: 0, curveIndex: 0,
    };
  }

  const f = clamp01(factor);
  const curveCount = curves.numCurves;
  const scaled = f * curveCount;
  const curveIndex = Math.min(curveCount - 1, Math.floor(scaled));
  const localFactor = curveCount === 1
    ? f
    : (f >= 1 ? 1 : scaled - curveIndex);

  const start = curves.curveOffsets[curveIndex] ?? 0;
  const end = curves.curveOffsets[curveIndex + 1] ?? start;
  const pointCount = end - start;
  if (pointCount <= 0) {
    return {
      position: [0, 0, 0], tangent: [0, 0, 1], normal: [0, 1, 0], value: 0, index: start, curveIndex,
    };
  }
  if (pointCount === 1) {
    const px = curves.positions[start * 3] ?? 0;
    const py = curves.positions[start * 3 + 1] ?? 0;
    const pz = curves.positions[start * 3 + 2] ?? 0;
    return {
      position: [px, py, pz],
      tangent: [0, 0, 1],
      normal: [0, 1, 0],
      value: averagedScalarAt(values, valueDims, start),
      index: start,
      curveIndex,
    };
  }

  const cyclic = !!curves.cyclic[curveIndex];
  const segmentCount = Math.max(1, cyclic ? pointCount : pointCount - 1);
  const segPos = localFactor * segmentCount;
  const seg = Math.min(segmentCount - 1, Math.floor(segPos));
  const u = localFactor >= 1 ? 1 : segPos - seg;
  const aIndex = start + seg;
  const bIndex = cyclic && seg === pointCount - 1 ? start : Math.min(end - 1, aIndex + 1);

  const ax = curves.positions[aIndex * 3] ?? 0;
  const ay = curves.positions[aIndex * 3 + 1] ?? 0;
  const az = curves.positions[aIndex * 3 + 2] ?? 0;
  const bx = curves.positions[bIndex * 3] ?? ax;
  const by = curves.positions[bIndex * 3 + 1] ?? ay;
  const bz = curves.positions[bIndex * 3 + 2] ?? az;

  let tx = bx - ax;
  let ty = by - ay;
  let tz = bz - az;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;

  const valueA = averagedScalarAt(values, valueDims, aIndex);
  const valueB = averagedScalarAt(values, valueDims, bIndex);
  return {
    position: [ax * (1 - u) + bx * u, ay * (1 - u) + by * u, az * (1 - u) + bz * u],
    tangent: [tx, ty, tz],
    normal: stableCurveNormal(tx, ty, tz),
    value: valueA * (1 - u) + valueB * u,
    index: aIndex,
    curveIndex,
  };
}

export function subdivideCurve(geo: Geometry, cuts: number): Geometry {
  if (!geo.curves || cuts <= 0) return geo;
  const c = geo.curves;
  const newPositions: number[] = [];
  const newOffsets: number[] = [0];
  const newCyclic: number[] = [];
  const newRes: number[] = [];
  const newSpline: number[] = [];

  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? start;
    const n = end - start;
    const cyclic = !!c.cyclic[ci];
    if (n <= 0) {
      newOffsets.push(newPositions.length / 3);
      newCyclic.push(cyclic ? 1 : 0);
      newRes.push(c.resolution[ci] ?? 12);
      newSpline.push(c.splineType[ci] ?? 0);
      continue;
    }

    const segmentCount = cyclic ? n : Math.max(0, n - 1);
    for (let seg = 0; seg < segmentCount; seg++) {
      const a = start + seg;
      const b = cyclic && seg === n - 1 ? start : a + 1;
      const ax = c.positions[a * 3] ?? 0;
      const ay = c.positions[a * 3 + 1] ?? 0;
      const az = c.positions[a * 3 + 2] ?? 0;
      const bx = c.positions[b * 3] ?? ax;
      const by = c.positions[b * 3 + 1] ?? ay;
      const bz = c.positions[b * 3 + 2] ?? az;
      newPositions.push(ax, ay, az);
      for (let cut = 1; cut <= cuts; cut++) {
        const t = cut / (cuts + 1);
        newPositions.push(
          ax * (1 - t) + bx * t,
          ay * (1 - t) + by * t,
          az * (1 - t) + bz * t,
        );
      }
    }
    if (!cyclic) {
      const last = end - 1;
      newPositions.push(
        c.positions[last * 3] ?? 0,
        c.positions[last * 3 + 1] ?? 0,
        c.positions[last * 3 + 2] ?? 0,
      );
    }
    newOffsets.push(newPositions.length / 3);
    newCyclic.push(cyclic ? 1 : 0);
    newRes.push((c.resolution[ci] ?? 12) * (cuts + 1));
    newSpline.push(c.splineType[ci] ?? 0);
  }

  const out = geo.copy();
  out.curves = new CurvesComponent(
    new Float32Array(newPositions),
    new Uint32Array(newOffsets),
    new Uint8Array(newCyclic),
    new Uint16Array(newRes),
    new Uint8Array(newSpline),
  );
  return out;
}

export function filletCurve(geo: Geometry, radius: number): Geometry {
  if (!geo.curves || radius <= 0) return geo;
  const c = geo.curves;
  const newPositions: number[] = [];
  const newOffsets: number[] = [0];
  const newCyclic: number[] = [];
  const newRes: number[] = [];
  const newSpline: number[] = [];

  const getPoint = (idx: number): Vec3 => [
    c.positions[idx * 3] ?? 0,
    c.positions[idx * 3 + 1] ?? 0,
    c.positions[idx * 3 + 2] ?? 0,
  ];
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
  const norm = (a: Vec3): Vec3 => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const pushPoint = (p: Vec3): void => { newPositions.push(p[0], p[1], p[2]); };

  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? start;
    const n = end - start;
    const cyclic = !!c.cyclic[ci];
    if (n <= 0) {
      newOffsets.push(newPositions.length / 3);
      newCyclic.push(cyclic ? 1 : 0);
      newRes.push(c.resolution[ci] ?? 12);
      newSpline.push(c.splineType[ci] ?? 0);
      continue;
    }
    if (!cyclic && n <= 2) {
      for (let i = start; i < end; i++) pushPoint(getPoint(i));
      newOffsets.push(newPositions.length / 3);
      newCyclic.push(0);
      newRes.push(c.resolution[ci] ?? 12);
      newSpline.push(c.splineType[ci] ?? 0);
      continue;
    }

    if (!cyclic) pushPoint(getPoint(start));

    const cornerStart = cyclic ? 0 : 1;
    const cornerEnd = cyclic ? n : n - 1;
    for (let local = cornerStart; local < cornerEnd; local++) {
      const prevIdx = start + (local - 1 + n) % n;
      const currIdx = start + local;
      const nextIdx = start + (local + 1) % n;
      const A = getPoint(prevIdx);
      const B = getPoint(currIdx);
      const C = getPoint(nextIdx);

      const v1 = sub(A, B);
      const v2 = sub(C, B);
      const l1 = len(v1), l2 = len(v2);
      if (l1 < 1e-6 || l2 < 1e-6) {
        pushPoint(B);
        continue;
      }
      const d1 = norm(v1);
      const d2 = norm(v2);
      const cosTheta = Math.max(-1, Math.min(1, dot(d1, d2)));
      const theta = Math.acos(cosTheta);
      if (theta < 1e-3 || Math.abs(Math.PI - theta) < 1e-3) {
        pushPoint(B);
        continue;
      }
      const tangentDist = Math.min(radius / Math.tan(theta / 2), l1 * 0.5, l2 * 0.5);
      if (!isFinite(tangentDist) || tangentDist <= 1e-6) {
        pushPoint(B);
        continue;
      }

      const t1 = add(B, mul(d1, tangentDist));
      const t2 = add(B, mul(d2, tangentDist));
      const bisectorRaw = add(d1, d2);
      const bisectorLen = len(bisectorRaw);
      if (bisectorLen < 1e-6) {
        pushPoint(B);
        continue;
      }
      const bisector = mul(bisectorRaw, 1 / bisectorLen);
      const centerDist = radius / Math.sin(theta / 2);
      const center = add(B, mul(bisector, centerDist));
      const normal = norm(cross(d1, d2));
      if (len(normal) < 1e-6) {
        pushPoint(B);
        continue;
      }

      const r1 = norm(sub(t1, center));
      const r2 = norm(sub(t2, center));
      let sweep = Math.atan2(dot(normal, cross(r1, r2)), dot(r1, r2));
      if (Math.abs(sweep) < 1e-6) {
        pushPoint(B);
        continue;
      }
      const segments = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 8)));

      pushPoint(t1);
      for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const ang = sweep * t;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const kxr = cross(normal, r1);
        const dir: Vec3 = [
          r1[0] * cs + kxr[0] * sn,
          r1[1] * cs + kxr[1] * sn,
          r1[2] * cs + kxr[2] * sn,
        ];
        pushPoint(add(center, mul(dir, radius)));
      }
      pushPoint(t2);
    }

    if (!cyclic) pushPoint(getPoint(end - 1));

    newOffsets.push(newPositions.length / 3);
    newCyclic.push(cyclic ? 1 : 0);
    newRes.push(c.resolution[ci] ?? 12);
    newSpline.push(c.splineType[ci] ?? 0);
  }

  const out = geo.copy();
  out.curves = new CurvesComponent(
    new Float32Array(newPositions),
    new Uint32Array(newOffsets),
    new Uint8Array(newCyclic),
    new Uint16Array(newRes),
    new Uint8Array(newSpline),
  );
  return out;
}

type Vec2 = [number, number];

function newellNormal(points: Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function projectPlanar(points: Vec3[]): { pts2: Vec2[]; dropAxis: 0 | 1 | 2; normal: Vec3 } {
  const normal = newellNormal(points);
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
  const dropAxis: 0 | 1 | 2 = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const pts2 = points.map((p) =>
    dropAxis === 0 ? [p[1], p[2]] as Vec2 : dropAxis === 1 ? [p[0], p[2]] as Vec2 : [p[0], p[1]] as Vec2,
  );
  return { pts2, dropAxis, normal };
}

function polygonArea2D(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function pointInTri2D(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const sign = (p1: Vec2, p2: Vec2, p3: Vec2) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = ab[1] * ac[2] - ab[2] * ac[1];
  const ny = ab[2] * ac[0] - ab[0] * ac[2];
  const nz = ab[0] * ac[1] - ab[1] * ac[0];
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function dot3(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function earClipPolygon(points3: Vec3[]): number[] {
  if (points3.length < 3) return [];
  const { pts2, normal } = projectPlanar(points3);
  const ccw = polygonArea2D(pts2) > 0;
  const verts = [...Array(points3.length).keys()];
  const tris: number[] = [];
  const orient = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  let guard = 0;
  while (verts.length > 3 && guard++ < 4096) {
    let clipped = false;
    for (let i = 0; i < verts.length; i++) {
      const i0 = verts[(i - 1 + verts.length) % verts.length]!;
      const i1 = verts[i]!;
      const i2 = verts[(i + 1) % verts.length]!;
      const a = pts2[i0]!, b = pts2[i1]!, c = pts2[i2]!;
      const turn = orient(a, b, c);
      if (ccw ? turn <= 1e-8 : turn >= -1e-8) continue;
      let contains = false;
      for (const vi of verts) {
        if (vi === i0 || vi === i1 || vi === i2) continue;
        if (pointInTri2D(pts2[vi]!, a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      tris.push(i0, i1, i2);
      verts.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (verts.length === 3) tris.push(verts[0]!, verts[1]!, verts[2]!);
  if (tris.length >= 3) {
    const tn = triangleNormal(points3[tris[0]!]!, points3[tris[1]!]!, points3[tris[2]!]!);
    if (dot3(tn, normal) < 0) {
      for (let i = 0; i < tris.length; i += 3) {
        const tmp = tris[i + 1]!;
        tris[i + 1] = tris[i + 2]!;
        tris[i + 2] = tmp;
      }
    }
  }
  return tris;
}

export function fillCurve(geo: Geometry): Geometry {
  if (!geo.curves) return Geometry.empty();
  const c = geo.curves;
  const positions: number[] = [];
  const triangles: number[] = [];
  let vertBase = 0;

  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? start;
    const cyclic = !!c.cyclic[ci];
    const pts3: Vec3[] = [];
    for (let i = start; i < end; i++) {
      pts3.push([
        c.positions[i * 3] ?? 0,
        c.positions[i * 3 + 1] ?? 0,
        c.positions[i * 3 + 2] ?? 0,
      ]);
    }
    if (pts3.length >= 2) {
      const first = pts3[0]!;
      const last = pts3[pts3.length - 1]!;
      const closeLoop = Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 1e-6;
      if (closeLoop) pts3.pop();
      if (!cyclic && !closeLoop) continue;
    }
    if (pts3.length < 3) continue;

    const localTris = earClipPolygon(pts3);
    if (localTris.length < 3) continue;
    for (const p of pts3) positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < localTris.length; i++) triangles.push(localTris[i]! + vertBase);
    vertBase += pts3.length;
  }

  if (positions.length === 0 || triangles.length === 0) return Geometry.empty();
  const out = new Geometry();
  out.mesh = new MeshComponent(new Float32Array(positions), new Uint32Array(triangles));
  return out;
}

export function curveToMesh(curveGeo: Geometry, profileGeo: Geometry | null, fillCaps = false): Geometry {
  if (!curveGeo.curves) return Geometry.empty();
  const c = curveGeo.curves;
  // No profile → emit a polyline mesh (edges only). We approximate with a
  // ribbon of zero-radius — for visibility, emit lone vertices for now.
  if (!profileGeo || !profileGeo.curves) {
    const out = new Geometry();
    out.mesh = new MeshComponent(new Float32Array(c.positions), new Uint32Array());
    return out;
  }
  // With a profile: sweep the profile along each curve.
  const profile = profileGeo.curves;
  const profileStart = profile.curveOffsets[0] ?? 0;
  const profileEnd = profile.curveOffsets[1] ?? profile.numPoints;
  const profilePts = Math.max(0, profileEnd - profileStart);
  const profilePoints3: Vec3[] = [];
  for (let i = profileStart; i < profileEnd; i++) {
    profilePoints3.push([
      profile.positions[i * 3] ?? 0,
      profile.positions[i * 3 + 1] ?? 0,
      profile.positions[i * 3 + 2] ?? 0,
    ]);
  }
  const capTris = fillCaps && profilePts >= 3 ? earClipPolygon(profilePoints3) : [];
  const verts: number[] = [];
  const tris: number[] = [];

  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? 0;
    const count = end - start;
    if (count < 2 || profilePts < 2) continue;

    const ringBase = verts.length / 3;
    for (let i = 0; i < count; i++) {
      const ax = c.positions[(start + i) * 3]!;
      const ay = c.positions[(start + i) * 3 + 1]!;
      const az = c.positions[(start + i) * 3 + 2]!;
      // Tangent (finite difference)
      let tx: number, ty: number, tz: number;
      if (i < count - 1) {
        tx = c.positions[(start + i + 1) * 3]!     - ax;
        ty = c.positions[(start + i + 1) * 3 + 1]! - ay;
        tz = c.positions[(start + i + 1) * 3 + 2]! - az;
      } else {
        tx = ax - c.positions[(start + i - 1) * 3]!;
        ty = ay - c.positions[(start + i - 1) * 3 + 1]!;
        tz = az - c.positions[(start + i - 1) * 3 + 2]!;
      }
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // Stable up: world up, avoid colinearity
      let upx = 0, upy = 1, upz = 0;
      if (Math.abs(ty) > 0.9) { upx = 1; upy = 0; upz = 0; }
      // u = up x t
      let ux = upy * tz - upz * ty, uy = upz * tx - upx * tz, uz = upx * ty - upy * tx;
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      // v = t x u
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      for (let p = 0; p < profilePts; p++) {
        const pi = profileStart + p;
        const px = profile.positions[pi * 3]!;
        const py = profile.positions[pi * 3 + 1]!;
        const _pz = profile.positions[pi * 3 + 2]!; void _pz;
        // Place profile in (u,v) plane around the curve point.
        verts.push(
          ax + ux * px + vx * py,
          ay + uy * px + vy * py,
          az + uz * px + vz * py,
        );
      }
    }
    // Triangulate the ribbon: between ring i and ring i+1
    for (let i = 0; i < count - 1; i++) {
      for (let p = 0; p < profilePts; p++) {
        const pNext = (p + 1) % profilePts;
        const a = ringBase + i * profilePts + p;
        const b = ringBase + i * profilePts + pNext;
        const cIdx = ringBase + (i + 1) * profilePts + p;
        const d = ringBase + (i + 1) * profilePts + pNext;
        tris.push(a, c.cyclic[ci] && p === profilePts - 1 ? a - profilePts + 1 : b, cIdx);
        tris.push(b, d, cIdx);
      }
    }
    if (capTris.length > 0) {
      const startRing = ringBase;
      const endRing = ringBase + (count - 1) * profilePts;
      for (let i = 0; i < capTris.length; i += 3) {
        tris.push(
          startRing + capTris[i]!,
          startRing + capTris[i + 2]!,
          startRing + capTris[i + 1]!,
        );
        tris.push(
          endRing + capTris[i]!,
          endRing + capTris[i + 1]!,
          endRing + capTris[i + 2]!,
        );
      }
    }
  }

  const out = new Geometry();
  out.mesh = new MeshComponent(new Float32Array(verts), new Uint32Array(tris));
  return out;
}

export function curveToPoints(
  geo: Geometry,
  mode: 'EVALUATED' | 'COUNT' | 'LENGTH',
  count: number,
  length: number,
): Geometry {
  if (!geo.curves) return Geometry.empty();
  const c = geo.curves;
  const positions: number[] = [];
  const tangents: number[] = [];
  const normals: number[] = [];
  const rotations: number[] = [];
  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? 0;
    const n = end - start;
    if (n < 2) continue;

    // Compute polyline arc length
    const cumLen: number[] = [0];
    for (let i = 1; i < n; i++) {
      const dx = c.positions[(start + i) * 3]! - c.positions[(start + i - 1) * 3]!;
      const dy = c.positions[(start + i) * 3 + 1]! - c.positions[(start + i - 1) * 3 + 1]!;
      const dz = c.positions[(start + i) * 3 + 2]! - c.positions[(start + i - 1) * 3 + 2]!;
      cumLen.push(cumLen[i - 1]! + Math.hypot(dx, dy, dz));
    }
    const totalLen = cumLen[n - 1]!;
    if (totalLen < 1e-9) continue;

    let samples: number;
    if (mode === 'EVALUATED') samples = n;
    else if (mode === 'LENGTH') samples = Math.max(2, Math.floor(totalLen / Math.max(length, 1e-6)) + 1);
    else samples = Math.max(2, count);

    for (let s = 0; s < samples; s++) {
      const t = (s / (samples - 1)) * totalLen;
      // find segment
      let seg = 0;
      while (seg < n - 1 && cumLen[seg + 1]! < t) seg++;
      const segLen = (cumLen[seg + 1]! - cumLen[seg]!) || 1;
      const u = (t - cumLen[seg]!) / segLen;
      const a = start + seg, b = start + Math.min(seg + 1, n - 1);
      const px = c.positions[a * 3]! * (1 - u) + c.positions[b * 3]! * u;
      const py = c.positions[a * 3 + 1]! * (1 - u) + c.positions[b * 3 + 1]! * u;
      const pz = c.positions[a * 3 + 2]! * (1 - u) + c.positions[b * 3 + 2]! * u;
      positions.push(px, py, pz);
      let tx = c.positions[b * 3]! - c.positions[a * 3]!;
      let ty = c.positions[b * 3 + 1]! - c.positions[a * 3 + 1]!;
      let tz = c.positions[b * 3 + 2]! - c.positions[a * 3 + 2]!;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      tangents.push(tx, ty, tz);
      const normal = stableCurveNormal(tx, ty, tz);
      normals.push(normal[0], normal[1], normal[2]);
      rotations.push(
        Math.atan2(normal[1], normal[2] || 1e-9),
        Math.atan2(-normal[0], Math.hypot(normal[1], normal[2])),
        0,
      );
    }
  }
  const out = new Geometry();
  out.points = new PointCloudComponent(new Float32Array(positions));
  if (out.points) {
    out.points.attributes.set('tangent', {
      name: 'tangent', domain: 'POINT', dimensions: 3, data_type: 'VECTOR', data: new Float32Array(tangents),
    });
    out.points.attributes.set('normal', {
      name: 'normal', domain: 'POINT', dimensions: 3, data_type: 'VECTOR', data: new Float32Array(normals),
    });
    out.points.attributes.set('rotation', {
      name: 'rotation', domain: 'POINT', dimensions: 3, data_type: 'VECTOR', data: new Float32Array(rotations),
    });
  }
  return out;
}

export function resampleCurve(
  geo: Geometry,
  mode: 'EVALUATED' | 'COUNT' | 'LENGTH',
  count: number,
  length: number,
  selection?: ScalarTypedArray | null,
): Geometry {
  if (!geo.curves) return geo;
  const c = geo.curves;
  const newPositions: number[] = [];
  const newOffsets: number[] = [0];
  const newCyclic: number[] = [];
  const newRes: number[] = [];

  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? 0;
    const n = end - start;
    const selected = !selection || !!selection[ci];
    if (n < 2 || !selected) {
      for (let i = start; i < end; i++) {
        newPositions.push(c.positions[i * 3] ?? 0, c.positions[i * 3 + 1] ?? 0, c.positions[i * 3 + 2] ?? 0);
      }
      newOffsets.push(newPositions.length / 3);
      newCyclic.push(c.cyclic[ci] ?? 0);
      newRes.push(c.resolution[ci] ?? 12);
      continue;
    }

    const cumLen: number[] = [0];
    for (let i = 1; i < n; i++) {
      const dx = c.positions[(start + i) * 3]! - c.positions[(start + i - 1) * 3]!;
      const dy = c.positions[(start + i) * 3 + 1]! - c.positions[(start + i - 1) * 3 + 1]!;
      const dz = c.positions[(start + i) * 3 + 2]! - c.positions[(start + i - 1) * 3 + 2]!;
      cumLen.push(cumLen[i - 1]! + Math.hypot(dx, dy, dz));
    }
    const totalLen = cumLen[n - 1]!;
    if (totalLen < 1e-9) {
      for (let i = start; i < end; i++) {
        newPositions.push(c.positions[i * 3] ?? 0, c.positions[i * 3 + 1] ?? 0, c.positions[i * 3 + 2] ?? 0);
      }
      newOffsets.push(newPositions.length / 3);
      newCyclic.push(c.cyclic[ci] ?? 0);
      newRes.push(c.resolution[ci] ?? 12);
      continue;
    }

    let samples: number;
    if (mode === 'EVALUATED') samples = n;
    else if (mode === 'LENGTH') samples = Math.max(2, Math.floor(totalLen / Math.max(length, 1e-6)) + 1);
    else samples = Math.max(2, count);

    const before = newPositions.length / 3;
    for (let s = 0; s < samples; s++) {
      const t = (s / (samples - 1)) * totalLen;
      let seg = 0;
      while (seg < n - 1 && cumLen[seg + 1]! < t) seg++;
      const segLen = (cumLen[seg + 1]! - cumLen[seg]!) || 1;
      const u = (t - cumLen[seg]!) / segLen;
      const a = start + seg, b = start + Math.min(seg + 1, n - 1);
      newPositions.push(
        c.positions[a * 3]!     * (1 - u) + c.positions[b * 3]!     * u,
        c.positions[a * 3 + 1]! * (1 - u) + c.positions[b * 3 + 1]! * u,
        c.positions[a * 3 + 2]! * (1 - u) + c.positions[b * 3 + 2]! * u,
      );
    }
    newOffsets.push(before + samples);
    newCyclic.push(c.cyclic[ci] ?? 0);
    newRes.push(c.resolution[ci] ?? 12);
  }

  const out = geo.copy();
  out.curves = new CurvesComponent(
    new Float32Array(newPositions),
    new Uint32Array(newOffsets),
    new Uint8Array(newCyclic),
    new Uint16Array(newRes),
  );
  return out;
}

export function reverseCurve(geo: Geometry, selection?: ScalarTypedArray | null): Geometry {
  if (!geo.curves) return geo;
  const c = geo.curves;
  const positions = new Float32Array(c.positions.length);
  for (let ci = 0; ci < c.numCurves; ci++) {
    const start = c.curveOffsets[ci] ?? 0;
    const end = c.curveOffsets[ci + 1] ?? 0;
    const n = end - start;
    const selected = !selection || !!selection[ci];
    for (let i = 0; i < n; i++) {
      const srcIndex = selected ? (start + (n - 1 - i)) : (start + i);
      const src = srcIndex * 3;
      const dst = (start + i) * 3;
      positions[dst]     = c.positions[src]!;
      positions[dst + 1] = c.positions[src + 1]!;
      positions[dst + 2] = c.positions[src + 2]!;
    }
  }
  const out = geo.copy();

  out.curves = new CurvesComponent(
    positions,
    new Uint32Array(c.curveOffsets),
    new Uint8Array(c.cyclic),
    new Uint16Array(c.resolution),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/*  Sampling                                                          */
/* ------------------------------------------------------------------ */

export function sampleNearestIndex(geo: Geometry, sample: Vec3): number {
  const pos =
    geo.mesh?.positions ??
    geo.curves?.positions ??
    geo.points?.positions;
  if (!pos) return 0;
  const n = pos.length / 3;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3]! - sample[0];
    const dy = pos[i * 3 + 1]! - sample[1];
    const dz = pos[i * 3 + 2]! - sample[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function closestPointSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const denom = abx * abx + aby * aby + abz * abz;
  const t = denom > 1e-12 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / denom)) : 0;
  return [a[0] + abx * t, a[1] + aby * t, a[2] + abz * t];
}

function closestPointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
  if (d1 <= 0 && d2 <= 0) return a;

  const bp: Vec3 = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
  const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }

  const cp: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
  const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const e: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + e[0] * w, b[1] + e[1] * w, b[2] + e[2] * w];
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ];
}

export function geometryProximity(geo: Geometry, sample: Vec3): { position: Vec3; distance: number } {
  let best: Vec3 = [0, 0, 0];
  let bestD = Infinity;

  if (geo.mesh && geo.mesh.numTris > 0) {
    const p = geo.mesh.positions;
    const t = geo.mesh.triangles;
    for (let i = 0; i < geo.mesh.numTris; i++) {
      const ai = t[i * 3]! * 3, bi = t[i * 3 + 1]! * 3, ci = t[i * 3 + 2]! * 3;
      const a: Vec3 = [p[ai]!, p[ai + 1]!, p[ai + 2]!];
      const b: Vec3 = [p[bi]!, p[bi + 1]!, p[bi + 2]!];
      const c: Vec3 = [p[ci]!, p[ci + 1]!, p[ci + 2]!];
      const q = closestPointTriangle(sample, a, b, c);
      const d = Math.hypot(q[0] - sample[0], q[1] - sample[1], q[2] - sample[2]);
      if (d < bestD) { bestD = d; best = q; }
    }
    return { position: best, distance: bestD };
  }

  if (geo.curves && geo.curves.numPoints > 1) {
    const c = geo.curves;
    for (let ci = 0; ci < c.numCurves; ci++) {
      const start = c.curveOffsets[ci] ?? 0;
      const end = c.curveOffsets[ci + 1] ?? start;
      const cyclic = !!c.cyclic[ci];
      for (let i = start; i < end - 1 + (cyclic ? 1 : 0); i++) {
        const aIdx = i;
        const bIdx = (i + 1 < end) ? i + 1 : start;
        const a: Vec3 = [c.positions[aIdx * 3]!, c.positions[aIdx * 3 + 1]!, c.positions[aIdx * 3 + 2]!];
        const b: Vec3 = [c.positions[bIdx * 3]!, c.positions[bIdx * 3 + 1]!, c.positions[bIdx * 3 + 2]!];
        const q = closestPointSegment(sample, a, b);
        const d = Math.hypot(q[0] - sample[0], q[1] - sample[1], q[2] - sample[2]);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    return { position: best, distance: bestD };
  }

  const pos = geo.points?.positions ?? geo.mesh?.positions;
  if (!pos) return { position: [0, 0, 0], distance: 0 };
  const idx = sampleNearestIndex(geo, sample);
  const x = pos[idx * 3]!, y = pos[idx * 3 + 1]!, z = pos[idx * 3 + 2]!;
  return {
    position: [x, y, z],
    distance: Math.hypot(x - sample[0], y - sample[1], z - sample[2]),
  };
}

/* ------------------------------------------------------------------ */
/*  Matrix helpers                                                    */
/* ------------------------------------------------------------------ */

export function translationMat4(t: Vec3): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

export function scaleMat4(s: Vec3): Float32Array {
  const m = new Float32Array(16);
  m[0] = s[0]; m[5] = s[1]; m[10] = s[2]; m[15] = 1;
  return m;
}

export function rotationMat4(r: Vec3): Float32Array {
  return composeMat4([0, 0, 0], r, [1, 1, 1]);
}

/** Returns a column-major mat4 = T * R(XYZ) * S. */
export function composeMat4(t: Vec3, r: Vec3, s: Vec3): Float32Array {
  const cx = Math.cos(r[0]), sxr = Math.sin(r[0]);
  const cy = Math.cos(r[1]), syr = Math.sin(r[1]);
  const cz = Math.cos(r[2]), szr = Math.sin(r[2]);
  const r00 = cy * cz,                     r01 = -cy * szr,                     r02 = syr;
  const r10 = sxr * syr * cz + cx * szr,   r11 = -sxr * syr * szr + cx * cz,    r12 = -sxr * cy;
  const r20 = -cx * syr * cz + sxr * szr,  r21 = cx * syr * szr + sxr * cz,     r22 = cx * cy;
  const sx = s[0], sy = s[1], sz = s[2];
  // column-major
  const m = new Float32Array(16);
  m[0]  = r00 * sx; m[1]  = r10 * sx; m[2]  = r20 * sx; m[3]  = 0;
  m[4]  = r01 * sy; m[5]  = r11 * sy; m[6]  = r21 * sy; m[7]  = 0;
  m[8]  = r02 * sz; m[9]  = r12 * sz; m[10] = r22 * sz; m[11] = 0;
  m[12] = t[0];     m[13] = t[1];     m[14] = t[2];     m[15] = 1;
  return m;
}

export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    o[i * 4 + j] =
      a[0 * 4 + j]! * b[i * 4 + 0]! +
      a[1 * 4 + j]! * b[i * 4 + 1]! +
      a[2 * 4 + j]! * b[i * 4 + 2]! +
      a[3 * 4 + j]! * b[i * 4 + 3]!;
  }
  return o;
}

export function transformAroundPivotMat4(transform: Float32Array, pivot: Vec3): Float32Array {
  return mat4Mul(
    translationMat4(pivot),
    mat4Mul(transform, translationMat4([-pivot[0], -pivot[1], -pivot[2]])),
  );
}

export function transformInstances(
  geo: Geometry,
  selection: ScalarTypedArray | null,
  transform: Float32Array,
  localSpace: boolean,
): Geometry {
  const out = geo.cloneOwning();
  if (!out.instances) return out;
  for (let i = 0; i < out.instances.items.length; i++) {
    if (selection && !selection[i]) continue;
    const it = out.instances.items[i]!;
    it.transform = localSpace ? mat4Mul(it.transform, transform) : mat4Mul(transform, it.transform);
  }
  return out;
}

/**
 * Flip Faces — reverse the winding of selected triangles (or all when no
 * selection mask is supplied), inverting face normals.
 */
export function flipFaces(geo: Geometry, selection?: ScalarTypedArray | null): Geometry {
  const out = geo.cloneOwning();
  if (out.mesh) {
    const tris = out.mesh.triangles;
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const face = i / 3;
      if (selection && !selection[face]) continue;
      const tmp = tris[i + 1]!;
      tris[i + 1] = tris[i + 2]!;
      tris[i + 2] = tmp;
    }
    out.mesh.invalidateCaches();
  }
  return out;
}
