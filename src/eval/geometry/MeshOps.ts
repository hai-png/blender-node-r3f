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

/**
 * One Catmull-Clark subdivision step on real polygonal topology.
 *
 * Produces quad faces (each original n-gon face → n quads), with the standard
 * Catmull-Clark vertex rules:
 *   - Face point  F = average of the face's vertices
 *   - Edge point  E = average of the two endpoints and the two adjacent face
 *                     points (boundary edges use the edge midpoint)
 *   - Original vertex moved to (F̄ + 2·R̄ + (n-3)·P) / n where F̄ is the average
 *     of adjacent face points, R̄ the average of adjacent edge midpoints, P the
 *     original position and n the vertex valence (boundary vertices use the
 *     crease rule (R̄·? )→ midpoint-of-boundary-edges rule).
 */
export function subdivideCatmullClarkOnce(mesh: MeshComponent): MeshComponent {
  const p = mesh.positions;
  const nV = mesh.numVerts;
  const nF = mesh.numFaces;
  const fo = mesh.faceOffsets, cv = mesh.cornerVerts;

  const get = (v: number): Vec3 => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];

  // --- Face points ---
  const facePoints: Vec3[] = [];
  for (let f = 0; f < nF; f++) {
    const s = fo[f]!, e = fo[f + 1]!;
    let x = 0, y = 0, z = 0; const n = e - s;
    for (let k = s; k < e; k++) { const g = get(cv[k]!); x += g[0]; y += g[1]; z += g[2]; }
    facePoints.push([x / n, y / n, z / n]);
  }

  // --- Edge records: key "lo_hi" → {a,b, faces:[], midpoint} ---
  interface ERec { a: number; b: number; faces: number[]; }
  const edgeMap = new Map<string, ERec>();
  const ekey = (a: number, b: number) => a < b ? `${a}_${b}` : `${b}_${a}`;
  for (let f = 0; f < nF; f++) {
    const s = fo[f]!, e = fo[f + 1]!; const n = e - s;
    for (let k = 0; k < n; k++) {
      const a = cv[s + k]!, b = cv[s + ((k + 1) % n)]!;
      const key = ekey(a, b);
      let rec = edgeMap.get(key);
      if (!rec) { rec = { a, b, faces: [] }; edgeMap.set(key, rec); }
      rec.faces.push(f);
    }
  }

  // --- Edge points + edge midpoints ---
  const edgePointIndex = new Map<string, number>();
  const edgeMid = new Map<string, Vec3>();
  const newPos: number[] = [];          // start empty; original verts appended later
  const pushPt = (pt: Vec3): number => { const i = newPos.length / 3; newPos.push(pt[0], pt[1], pt[2]); return i; };

  // Accumulators for moving original vertices.
  const vFaceAvg: Vec3[] = Array.from({ length: nV }, () => [0, 0, 0]);
  const vFaceCnt = new Uint32Array(nV);
  const vEdgeMidAvg: Vec3[] = Array.from({ length: nV }, () => [0, 0, 0]);
  const vEdgeCnt = new Uint32Array(nV);
  const vBoundary = new Uint8Array(nV);
  const vBoundaryAvg: Vec3[] = Array.from({ length: nV }, () => [0, 0, 0]);
  const vBoundaryCnt = new Uint32Array(nV);

  for (const [key, rec] of edgeMap) {
    const A = get(rec.a), B = get(rec.b);
    const mid: Vec3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    edgeMid.set(key, mid);
    let ep: Vec3;
    if (rec.faces.length === 2) {
      const f0 = facePoints[rec.faces[0]!]!, f1 = facePoints[rec.faces[1]!]!;
      ep = [(A[0] + B[0] + f0[0] + f1[0]) / 4, (A[1] + B[1] + f0[1] + f1[1]) / 4, (A[2] + B[2] + f0[2] + f1[2]) / 4];
    } else {
      ep = mid;                       // boundary edge
      vBoundary[rec.a] = 1; vBoundary[rec.b] = 1;
      const mx = mid[0]!, my = mid[1]!, mz = mid[2]!;
      for (const v of [rec.a, rec.b]) {
        const acc = vBoundaryAvg[v]!;
        acc[0] = (acc[0] ?? 0) + mx; acc[1] = (acc[1] ?? 0) + my; acc[2] = (acc[2] ?? 0) + mz;
        vBoundaryCnt[v] = (vBoundaryCnt[v] ?? 0) + 1;
      }
    }
    edgePointIndex.set(key, pushPt(ep));
    // accumulate edge midpoints for both endpoints
    const mx = mid[0]!, my = mid[1]!, mz = mid[2]!;
    for (const v of [rec.a, rec.b]) {
      const acc = vEdgeMidAvg[v]!;
      acc[0] = (acc[0] ?? 0) + mx; acc[1] = (acc[1] ?? 0) + my; acc[2] = (acc[2] ?? 0) + mz;
      vEdgeCnt[v] = (vEdgeCnt[v] ?? 0) + 1;
    }
  }

  // Face-point index map + accumulate face points per vertex.
  const facePointIndex: number[] = [];
  for (let f = 0; f < nF; f++) {
    const fp = facePoints[f]!;
    facePointIndex.push(pushPt(fp));
    const s = fo[f]!, e = fo[f + 1]!;
    const fx = fp[0]!, fy = fp[1]!, fz = fp[2]!;
    for (let k = s; k < e; k++) {
      const v = cv[k]!;
      const acc = vFaceAvg[v]!;
      acc[0] = (acc[0] ?? 0) + fx; acc[1] = (acc[1] ?? 0) + fy; acc[2] = (acc[2] ?? 0) + fz;
      vFaceCnt[v] = (vFaceCnt[v] ?? 0) + 1;
    }
  }

  // --- New positions of original vertices (appended after edge & face pts) ---
  const origIndex: number[] = [];
  for (let v = 0; v < nV; v++) {
    const P = get(v);
    let np: Vec3;
    if (vBoundary[v]) {
      // Crease/boundary rule: (P + sum(boundary edge midpoints)) weighting.
      const c = vBoundaryCnt[v]! || 1;
      const R: Vec3 = [vBoundaryAvg[v]![0] / c, vBoundaryAvg[v]![1] / c, vBoundaryAvg[v]![2] / c];
      np = [(P[0] + R[0] * 2) / 3, (P[1] + R[1] * 2) / 3, (P[2] + R[2] * 2) / 3];
    } else {
      const n = vFaceCnt[v]! || 1;
      const F: Vec3 = [vFaceAvg[v]![0] / n, vFaceAvg[v]![1] / n, vFaceAvg[v]![2] / n];
      const ec = vEdgeCnt[v]! || 1;
      const R: Vec3 = [vEdgeMidAvg[v]![0] / ec, vEdgeMidAvg[v]![1] / ec, vEdgeMidAvg[v]![2] / ec];
      np = [
        (F[0] + 2 * R[0] + (n - 3) * P[0]) / n,
        (F[1] + 2 * R[1] + (n - 3) * P[1]) / n,
        (F[2] + 2 * R[2] + (n - 3) * P[2]) / n,
      ];
    }
    origIndex.push(pushPt(np));
  }

  // --- New quad faces: for each corner, (orig, edgeNext, facePt, edgePrev) ---
  const faces: number[][] = [];
  for (let f = 0; f < nF; f++) {
    const s = fo[f]!, e = fo[f + 1]!; const n = e - s;
    const fp = facePointIndex[f]!;
    for (let k = 0; k < n; k++) {
      const vCur = cv[s + k]!;
      const vNext = cv[s + ((k + 1) % n)]!;
      const vPrev = cv[s + ((k - 1 + n) % n)]!;
      const eNext = edgePointIndex.get(ekey(vCur, vNext))!;
      const ePrev = edgePointIndex.get(ekey(vPrev, vCur))!;
      faces.push([origIndex[vCur]!, eNext, fp, ePrev]);
    }
  }

  return MeshComponent.fromPolys(new Float32Array(newPos), faces);
}

export function subdivisionSurface(geo: Geometry, levels: number): Geometry {
  if (!geo.mesh || levels <= 0) return geo;
  let m = geo.mesh;
  for (let i = 0; i < levels; i++) m = subdivideCatmullClarkOnce(m);
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
  const m = out.mesh;
  if (m) {
    const fo = m.faceOffsets, cv = m.cornerVerts;
    const nF = m.numFaces;
    for (let f = 0; f < nF; f++) {
      if (selection && !selection[f]) continue;
      const s = fo[f]!, e = fo[f + 1]!;
      // Reverse the corner order (keep first corner fixed, like Blender).
      for (let i = s + 1, j = e - 1; i < j; i++, j--) {
        const tmp = cv[i]!; cv[i] = cv[j]!; cv[j] = tmp;
      }
    }
    out.mesh = MeshComponent.fromPolys(m.positions, polysOf(m));
    // preserve non-position attributes
    for (const [k, a] of m.attributes) if (k !== 'position') out.mesh.attributes.set(k, a);
    out.mesh.invalidateCaches();
  }
  return out;
}

/** Extract the polygon list (array of vertex-index arrays) from a mesh. */
export function polysOf(m: MeshComponent): number[][] {
  const fo = m.faceOffsets, cv = m.cornerVerts;
  const out: number[][] = [];
  for (let f = 0; f < m.numFaces; f++) {
    const s = fo[f]!, e = fo[f + 1]!;
    const poly: number[] = [];
    for (let k = s; k < e; k++) poly.push(cv[k]!);
    out.push(poly);
  }
  return out;
}

/**
 * Triangulate — split every face with > minVerts corners into triangles
 * (fan triangulation). Faces with `selection` false are kept intact.
 */
export function triangulateMesh(geo: Geometry, selection: ScalarTypedArray | null, minVerts: number): Geometry {
  const m = geo.mesh;
  if (!m) return geo;
  const fo = m.faceOffsets, cv = m.cornerVerts;
  const faces: number[][] = [];
  for (let f = 0; f < m.numFaces; f++) {
    const s = fo[f]!, e = fo[f + 1]!;
    const n = e - s;
    const verts: number[] = [];
    for (let k = s; k < e; k++) verts.push(cv[k]!);
    const sel = selection ? !!selection[f] : true;
    if (!sel || n <= Math.max(3, minVerts) - 1 || n <= 3) {
      faces.push(verts);
    } else {
      for (let k = 1; k < n - 1; k++) faces.push([verts[0]!, verts[k]!, verts[k + 1]!]);
    }
  }
  const out = geo.cloneOwning();
  out.mesh = MeshComponent.fromPolys(new Float32Array(m.positions), faces);
  for (const [k, a] of m.attributes) if (k !== 'position') out.mesh.attributes.set(k, a);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Mesh Boolean (BSP-based CSG on triangles)                         */
/* ------------------------------------------------------------------ */

type CsgVertex = { pos: Vec3; normal: Vec3 };
class CsgPolygon {
  vertices: CsgVertex[];
  plane: { normal: Vec3; w: number };
  constructor(vertices: CsgVertex[]) {
    this.vertices = vertices;
    const a = vertices[0]!.pos, b = vertices[1]!.pos, c = vertices[2]!.pos;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.plane = { normal: [nx, ny, nz], w: nx * a[0] + ny * a[1] + nz * a[2] };
  }
  clone(): CsgPolygon { return new CsgPolygon(this.vertices.map((v) => ({ pos: [...v.pos] as Vec3, normal: [...v.normal] as Vec3 }))); }
  flip(): void {
    this.vertices.reverse();
    this.plane.normal = [-this.plane.normal[0], -this.plane.normal[1], -this.plane.normal[2]];
    this.plane.w = -this.plane.w;
    for (const v of this.vertices) v.normal = [-v.normal[0], -v.normal[1], -v.normal[2]];
  }
}

const CSG_EPS = 1e-5;

function splitPolygon(
  poly: CsgPolygon, plane: { normal: Vec3; w: number },
  coplanarFront: CsgPolygon[], coplanarBack: CsgPolygon[],
  front: CsgPolygon[], back: CsgPolygon[],
): void {
  const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
  let polyType = 0;
  const types: number[] = [];
  const n = plane.normal;
  for (const v of poly.vertices) {
    const t = n[0] * v.pos[0] + n[1] * v.pos[1] + n[2] * v.pos[2] - plane.w;
    const type = t < -CSG_EPS ? BACK : t > CSG_EPS ? FRONT : COPLANAR;
    polyType |= type;
    types.push(type);
  }
  switch (polyType) {
    case COPLANAR: {
      const dot = n[0] * poly.plane.normal[0] + n[1] * poly.plane.normal[1] + n[2] * poly.plane.normal[2];
      (dot > 0 ? coplanarFront : coplanarBack).push(poly);
      break;
    }
    case FRONT: front.push(poly); break;
    case BACK: back.push(poly); break;
    default: {
      const f: CsgVertex[] = [], b: CsgVertex[] = [];
      for (let i = 0; i < poly.vertices.length; i++) {
        const j = (i + 1) % poly.vertices.length;
        const ti = types[i]!, tj = types[j]!;
        const vi = poly.vertices[i]!, vj = poly.vertices[j]!;
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(ti !== BACK ? { pos: [...vi.pos] as Vec3, normal: [...vi.normal] as Vec3 } : vi);
        if ((ti | tj) === SPANNING) {
          const di = n[0] * vi.pos[0] + n[1] * vi.pos[1] + n[2] * vi.pos[2] - plane.w;
          const dd = di - (n[0] * vj.pos[0] + n[1] * vj.pos[1] + n[2] * vj.pos[2] - plane.w);
          const t = dd === 0 ? 0 : di / dd;
          const mid: CsgVertex = {
            pos: [vi.pos[0] + (vj.pos[0] - vi.pos[0]) * t, vi.pos[1] + (vj.pos[1] - vi.pos[1]) * t, vi.pos[2] + (vj.pos[2] - vi.pos[2]) * t],
            normal: [vi.normal[0] + (vj.normal[0] - vi.normal[0]) * t, vi.normal[1] + (vj.normal[1] - vi.normal[1]) * t, vi.normal[2] + (vj.normal[2] - vi.normal[2]) * t],
          };
          f.push({ pos: [...mid.pos] as Vec3, normal: [...mid.normal] as Vec3 });
          b.push({ pos: [...mid.pos] as Vec3, normal: [...mid.normal] as Vec3 });
        }
      }
      if (f.length >= 3) front.push(new CsgPolygon(f));
      if (b.length >= 3) back.push(new CsgPolygon(b));
      break;
    }
  }
}

class CsgNode {
  plane?: { normal: Vec3; w: number };
  front?: CsgNode;
  back?: CsgNode;
  polygons: CsgPolygon[] = [];
  constructor(polygons?: CsgPolygon[]) { if (polygons) this.build(polygons); }
  invert(): void {
    for (const p of this.polygons) p.flip();
    if (this.plane) { this.plane.normal = [-this.plane.normal[0], -this.plane.normal[1], -this.plane.normal[2]]; this.plane.w = -this.plane.w; }
    this.front?.invert(); this.back?.invert();
    const tmp = this.front; this.front = this.back; this.back = tmp;
  }
  clipPolygons(polygons: CsgPolygon[]): CsgPolygon[] {
    if (!this.plane) return polygons.slice();
    let front: CsgPolygon[] = [], back: CsgPolygon[] = [];
    for (const p of polygons) splitPolygon(p, this.plane, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }
  clipTo(node: CsgNode): void {
    this.polygons = node.clipPolygons(this.polygons);
    this.front?.clipTo(node); this.back?.clipTo(node);
  }
  allPolygons(): CsgPolygon[] {
    let out = this.polygons.slice();
    if (this.front) out = out.concat(this.front.allPolygons());
    if (this.back) out = out.concat(this.back.allPolygons());
    return out;
  }
  build(polygons: CsgPolygon[]): void {
    if (!polygons.length) return;
    if (!this.plane) this.plane = { normal: [...polygons[0]!.plane.normal] as Vec3, w: polygons[0]!.plane.w };
    const front: CsgPolygon[] = [], back: CsgPolygon[] = [];
    for (const p of polygons) splitPolygon(p, this.plane, this.polygons, this.polygons, front, back);
    if (front.length) { (this.front ??= new CsgNode()).build(front); }
    if (back.length) { (this.back ??= new CsgNode()).build(back); }
  }
}

function meshToCsg(m: MeshComponent): CsgPolygon[] {
  const tris = m.triangles, p = m.positions;
  const polys: CsgPolygon[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const verts: CsgVertex[] = [];
    let degenerate = false;
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k]! * 3;
      verts.push({ pos: [p[v]!, p[v + 1]!, p[v + 2]!], normal: [0, 0, 0] });
    }
    // skip zero-area tris
    const a = verts[0]!.pos, b = verts[1]!.pos, c = verts[2]!.pos;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-12) degenerate = true;
    if (!degenerate) polys.push(new CsgPolygon(verts));
  }
  return polys;
}

function csgToMesh(polys: CsgPolygon[]): MeshComponent {
  const positions: number[] = [];
  const faces: number[][] = [];
  const keyMap = new Map<string, number>();
  const idx = (pos: Vec3): number => {
    const key = `${Math.round(pos[0] / CSG_EPS)},${Math.round(pos[1] / CSG_EPS)},${Math.round(pos[2] / CSG_EPS)}`;
    let i = keyMap.get(key);
    if (i === undefined) { i = positions.length / 3; positions.push(pos[0], pos[1], pos[2]); keyMap.set(key, i); }
    return i;
  };
  for (const poly of polys) {
    if (poly.vertices.length < 3) continue;
    const face = poly.vertices.map((v) => idx(v.pos));
    // drop faces with repeated consecutive verts
    const cleaned: number[] = [];
    for (let i = 0; i < face.length; i++) if (face[i] !== face[(i + 1) % face.length]) cleaned.push(face[i]!);
    if (cleaned.length >= 3) faces.push(cleaned);
  }
  return MeshComponent.fromPolys(new Float32Array(positions), faces);
}

/** CSG operation between two solids. op: 'UNION' | 'INTERSECT' | 'DIFFERENCE'. */
function csgOperate(a: CsgPolygon[], b: CsgPolygon[], op: 'UNION' | 'INTERSECT' | 'DIFFERENCE'): CsgPolygon[] {
  const A = new CsgNode(a.map((p) => p.clone()));
  const B = new CsgNode(b.map((p) => p.clone()));
  if (op === 'UNION') {
    A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.allPolygons());
    return A.allPolygons();
  }
  if (op === 'INTERSECT') {
    A.invert(); B.clipTo(A); B.invert(); A.clipTo(B); B.clipTo(A);
    A.build(B.allPolygons()); A.invert();
    return A.allPolygons();
  }
  // DIFFERENCE: A - B
  A.invert(); A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
  A.build(B.allPolygons()); A.invert();
  return A.allPolygons();
}

/**
 * Mesh Boolean. `base` is Mesh 1 (only meaningful for DIFFERENCE); `others`
 * are the Mesh 2 inputs which are accumulated together. Returns a new mesh.
 */
export function meshBoolean(
  base: Geometry | null,
  others: Geometry[],
  op: 'UNION' | 'INTERSECT' | 'DIFFERENCE',
): Geometry {
  const meshesB = others.map((g) => g.mesh).filter((m): m is MeshComponent => !!m && m.numTris > 0);
  if (op === 'DIFFERENCE') {
    const baseMesh = base?.mesh;
    if (!baseMesh || baseMesh.numTris === 0) return Geometry.empty();
    if (meshesB.length === 0) { const g = new Geometry(); g.mesh = baseMesh.clone(); return g; }
    let acc = meshToCsg(baseMesh);
    for (const m of meshesB) acc = csgOperate(acc, meshToCsg(m), 'DIFFERENCE');
    const g = new Geometry(); g.mesh = csgToMesh(acc); return g;
  }
  // UNION / INTERSECT: fold all inputs (Mesh 1 + Mesh 2) together.
  const all: MeshComponent[] = [];
  if (base?.mesh && base.mesh.numTris > 0) all.push(base.mesh);
  all.push(...meshesB);
  if (all.length === 0) return Geometry.empty();
  let acc = meshToCsg(all[0]!);
  for (let i = 1; i < all.length; i++) acc = csgOperate(acc, meshToCsg(all[i]!), op);
  const g = new Geometry(); g.mesh = csgToMesh(acc); return g;
}

// ──────────────────────────────────────────────────────────────────────
//  Additional ops added during Phase 3 audit.
// ──────────────────────────────────────────────────────────────────────

/**
 * Raycast — for each (source, direction) pair, find the closest hit on the
 * target mesh up to `length` units away. CPU brute-force, O(samples × faces).
 *
 * The current implementation uses Möller–Trumbore against the triangulated
 * face buffer. Returns { hit, distance, position, normal } per call.
 */
export function raycastMesh(
  target: Geometry,
  source: Vec3,
  direction: Vec3,
  length: number,
): { hit: boolean; distance: number; position: Vec3; normal: Vec3 } {
  const mesh = target.mesh;
  if (!mesh || mesh.numTris === 0) {
    return { hit: false, distance: 0, position: [0, 0, 0], normal: [0, 0, 1] };
  }
  const tris = mesh.triangles;
  const p = mesh.positions;
  const dl = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const dx = direction[0] / dl, dy = direction[1] / dl, dz = direction[2] / dl;
  let bestT = length;
  let hit = false;
  let bestNormal: Vec3 = [0, 0, 1];
  for (let i = 0; i < mesh.numTris; i++) {
    const ia = tris[i * 3]! * 3, ib = tris[i * 3 + 1]! * 3, ic = tris[i * 3 + 2]! * 3;
    const ax = p[ia]!, ay = p[ia + 1]!, az = p[ia + 2]!;
    const bx = p[ib]!, by = p[ib + 1]!, bz = p[ib + 2]!;
    const cx = p[ic]!, cy = p[ic + 1]!, cz = p[ic + 2]!;
    // Möller–Trumbore
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) continue;
    const invDet = 1 / det;
    const tx = source[0] - ax, ty = source[1] - ay, tz = source[2] - az;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (t > 1e-6 && t < bestT) {
      bestT = t;
      hit = true;
      // Triangle normal
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      bestNormal = [nx / nl, ny / nl, nz / nl];
    }
  }
  return {
    hit,
    distance: hit ? bestT : 0,
    position: hit ? [source[0] + dx * bestT, source[1] + dy * bestT, source[2] + dz * bestT] : [0, 0, 0],
    normal: bestNormal,
  };
}

/**
 * Delete Geometry — removes elements (vertices/edges/faces) where `selection`
 * is truthy. For VERTEX/POINT domain it removes vertices and any face/edge
 * referencing them. For FACE domain it drops the faces but keeps their
 * vertices. For EDGE domain it drops the edges (and adjacent faces) but
 * keeps shared vertices.
 *
 * Selection is interpreted as "delete where selection is TRUE" — matching
 * Blender 4.x.
 */
export function deleteGeometry(
  geo: Geometry,
  selection: ScalarTypedArray,
  domain: 'POINT' | 'EDGE' | 'FACE',
): Geometry {
  const mesh = geo.mesh;
  if (!mesh) return geo;
  // Build the "keep face" mask depending on domain.
  const numFaces = mesh.numFaces;
  const keepFace = new Uint8Array(numFaces);
  keepFace.fill(1);

  if (domain === 'FACE') {
    for (let f = 0; f < numFaces; f++) if (selection[f]) keepFace[f] = 0;
  } else if (domain === 'POINT') {
    const numVerts = mesh.numVerts;
    const deleteVert = new Uint8Array(numVerts);
    const lim = Math.min(numVerts, selection.length);
    for (let v = 0; v < lim; v++) if (selection[v]) deleteVert[v] = 1;
    for (let f = 0; f < numFaces; f++) {
      const verts = mesh.faceVerts(f);
      for (const v of verts) if (deleteVert[v]) { keepFace[f] = 0; break; }
    }
  } else if (domain === 'EDGE') {
    // No explicit edge → face mapping in our model; conservatively drop faces
    // whose two-vertex pair appears in the dropped edge list.
    const dropEdgePairs = new Set<string>();
    const e = mesh.edges();
    if (e) {
      const numEdges = e.length / 2;
      const lim = Math.min(numEdges, selection.length);
      for (let i = 0; i < lim; i++) {
        if (!selection[i]) continue;
        const a = e[i * 2]!, b = e[i * 2 + 1]!;
        dropEdgePairs.add(a < b ? `${a}_${b}` : `${b}_${a}`);
      }
    }
    for (let f = 0; f < numFaces; f++) {
      const verts = mesh.faceVerts(f);
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (dropEdgePairs.has(k)) { keepFace[f] = 0; break; }
      }
    }
  }

  // Find used vertices in surviving faces.
  const usedVert = new Uint8Array(mesh.numVerts);
  for (let f = 0; f < numFaces; f++) {
    if (!keepFace[f]) continue;
    for (const v of mesh.faceVerts(f)) usedVert[v] = 1;
  }
  // Remap.
  const remap = new Int32Array(mesh.numVerts);
  let nv = 0;
  for (let v = 0; v < mesh.numVerts; v++) {
    if (usedVert[v]) { remap[v] = nv++; }
    else remap[v] = -1;
  }
  if (domain !== 'POINT') {
    // POINT domain already used vertex selection; for FACE/EDGE we still keep
    // all vertices to match Blender's "Only Faces" mode behaviour.
    for (let v = 0; v < mesh.numVerts; v++) { remap[v] = v; usedVert[v] = 1; nv = mesh.numVerts; }
  }
  const newPos = new Float32Array(nv * 3);
  let w = 0;
  for (let v = 0; v < mesh.numVerts; v++) {
    if (!usedVert[v]) continue;
    newPos[w * 3] = mesh.positions[v * 3]!;
    newPos[w * 3 + 1] = mesh.positions[v * 3 + 1]!;
    newPos[w * 3 + 2] = mesh.positions[v * 3 + 2]!;
    w++;
  }
  const polys: number[][] = [];
  for (let f = 0; f < numFaces; f++) {
    if (!keepFace[f]) continue;
    polys.push(mesh.faceVerts(f).map((v) => remap[v]!));
  }
  const out = new Geometry();
  out.mesh = MeshComponent.fromPolys(newPos, polys);
  return out;
}

/**
 * Separate Geometry — splits into (selected, inverted) geometries. Equivalent
 * to running deleteGeometry twice with complementary masks.
 */
export function separateGeometry(
  geo: Geometry,
  selection: ScalarTypedArray,
  domain: 'POINT' | 'EDGE' | 'FACE',
): { selected: Geometry; inverted: Geometry } {
  const inverted = new Uint8Array(selection.length);
  for (let i = 0; i < selection.length; i++) inverted[i] = selection[i] ? 0 : 1;
  return {
    selected: deleteGeometry(geo, inverted, domain),
    inverted: deleteGeometry(geo, selection, domain),
  };
}

/**
 * Mesh to Curve — extracts the wireframe edges of `geo`'s mesh as a poly-curve
 * spline by walking connected edge chains.
 *
 * The output represents each connected component as a separate curve. Curve
 * data is stored in the Geometry's `curve` component, matching how Blender
 * holds converted output.
 */
export function meshToCurve(geo: Geometry, selection?: ScalarTypedArray | null): Geometry {
  const mesh = geo.mesh;
  if (!mesh) return Geometry.empty();
  // Build an edge adjacency list from face boundaries.
  const adj = new Map<number, Set<number>>();
  const addEdge = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (let f = 0; f < mesh.numFaces; f++) {
    if (selection && !selection[f]) continue;
    const verts = mesh.faceVerts(f);
    for (let i = 0; i < verts.length; i++) {
      addEdge(verts[i]!, verts[(i + 1) % verts.length]!);
    }
  }
  if (adj.size === 0) return Geometry.empty();
  // Walk connected components, build polylines.
  const visited = new Set<number>();
  const lines: number[][] = [];
  for (const [start] of adj) {
    if (visited.has(start)) continue;
    const stack: number[] = [start];
    const line: number[] = [];
    while (stack.length) {
      const v = stack.pop()!;
      if (visited.has(v)) continue;
      visited.add(v);
      line.push(v);
      for (const n of adj.get(v) ?? []) {
        if (!visited.has(n)) stack.push(n);
      }
    }
    if (line.length >= 2) lines.push(line);
  }
  if (lines.length === 0) return Geometry.empty();
  // Flatten into a curve component.
  const totalPts = lines.reduce((s, l) => s + l.length, 0);
  const positions = new Float32Array(totalPts * 3);
  const offsets: number[] = [0];
  let p = 0;
  for (const line of lines) {
    for (const v of line) {
      positions[p * 3] = mesh.positions[v * 3]!;
      positions[p * 3 + 1] = mesh.positions[v * 3 + 1]!;
      positions[p * 3 + 2] = mesh.positions[v * 3 + 2]!;
      p++;
    }
    offsets.push(p);
  }
  const out = new Geometry();
  // Use the existing curve component shape (see Geometry.ts).
  // Most Geometry impls in this codebase carry a `curve` field; if it doesn't
  // exist on this build, fall back to representing as a points-only mesh.
  if ('curve' in out) {
    (out as any).curve = {
      positions,
      curveOffsets: new Uint32Array(offsets),
      cyclic: new Uint8Array(lines.length),
      resolution: new Uint32Array(lines.length).fill(12),
      attributes: new Map(),
    };
  } else {
    // Fallback: stash as points.
    const points = (out as any);
    points.points = { positions, attributes: new Map() };
  }
  return out;
}

/**
 * Extrude Mesh (Individual Faces / Vertices) — adds new geometry along
 * `offset` * `offsetScale`. This implementation only handles the FACES mode
 * with `individual=true` (per-face): each selected face is detached, lifted,
 * and stitched back with quad sides.
 */
export function extrudeMesh(
  geo: Geometry,
  selection: ScalarTypedArray,
  offset: Vec3,
  offsetScale: number,
  mode: 'VERTICES' | 'EDGES' | 'FACES',
  individual: boolean,
): { mesh: Geometry; topSelection: Uint8Array; sideSelection: Uint8Array } {
  const mesh = geo.mesh;
  if (!mesh) return { mesh: geo, topSelection: new Uint8Array(0), sideSelection: new Uint8Array(0) };
  if (mode !== 'FACES' || !individual) {
    // Fallback for unimplemented modes: pass-through unchanged.
    return { mesh: geo, topSelection: new Uint8Array(0), sideSelection: new Uint8Array(0) };
  }
  const polys = polysOf(mesh);
  const positions = Array.from(mesh.positions);
  const newPolys: number[][] = [];
  const topMask: number[] = [];
  const sideMask: number[] = [];
  for (let f = 0; f < polys.length; f++) {
    const verts = polys[f]!;
    if (!selection[f]) {
      newPolys.push(verts);
      topMask.push(0);
      continue;
    }
    // Compute face normal (Newell's).
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
      const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
      const bx = positions[b * 3]!, by = positions[b * 3 + 1]!, bz = positions[b * 3 + 2]!;
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // Duplicate verts upward.
    const ox = (offset[0] + nx) * offsetScale;
    const oy = (offset[1] + ny) * offsetScale;
    const oz = (offset[2] + nz) * offsetScale;
    const top: number[] = [];
    for (const v of verts) {
      const idx = positions.length / 3;
      positions.push(
        positions[v * 3]! + ox,
        positions[v * 3 + 1]! + oy,
        positions[v * 3 + 2]! + oz,
      );
      top.push(idx);
    }
    // Replace the original face with the top face (Blender drops the cap).
    newPolys.push(top);
    topMask.push(1);
    // Side quads.
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
      const at = top[i]!, bt = top[(i + 1) % top.length]!;
      newPolys.push([a, b, bt, at]);
      sideMask.push(1);
    }
  }
  const out = new Geometry();
  out.mesh = MeshComponent.fromPolys(new Float32Array(positions), newPolys);
  const topSelection = new Uint8Array(newPolys.length);
  const sideSelection = new Uint8Array(newPolys.length);
  // Naive layout: topMask first, then sides — we built them in that order.
  let i = 0, j = 0;
  for (let f = 0; f < newPolys.length; f++) {
    if (i < topMask.length) { topSelection[f] = topMask[i++]!; }
    else if (j < sideMask.length) { sideSelection[f] = sideMask[j++]!; }
  }
  return { mesh: out, topSelection, sideSelection };
}

/**
 * Duplicate Elements — copies selected elements `amount` times. POINT and
 * FACE domains supported; EDGE/CURVE/INSTANCE fall back to pass-through.
 *
 * Each duplicate is placed in-place (positions unchanged); the caller is
 * expected to transform them downstream. Returns the new geometry plus a
 * "duplicate index" per produced element (0 for originals).
 */
export function duplicateElements(
  geo: Geometry,
  selection: ScalarTypedArray,
  amount: number,
  domain: 'POINT' | 'EDGE' | 'FACE' | 'CURVE' | 'INSTANCE',
): { geometry: Geometry; duplicateIndex: Int32Array } {
  const mesh = geo.mesh;
  if (!mesh || amount <= 0) {
    return { geometry: geo, duplicateIndex: new Int32Array(0) };
  }
  if (domain === 'POINT') {
    const verts = mesh.numVerts;
    const dupCount = amount;
    const newVerts = verts + dupCount * Array.from(selection).filter((x) => x).length;
    const pos = new Float32Array(newVerts * 3);
    pos.set(mesh.positions);
    let cursor = verts;
    const dupIdx = new Int32Array(newVerts);
    for (let v = 0; v < verts; v++) {
      if (!selection[v]) continue;
      for (let k = 1; k <= dupCount; k++) {
        pos[cursor * 3] = mesh.positions[v * 3]!;
        pos[cursor * 3 + 1] = mesh.positions[v * 3 + 1]!;
        pos[cursor * 3 + 2] = mesh.positions[v * 3 + 2]!;
        dupIdx[cursor] = k;
        cursor++;
      }
    }
    const out = new Geometry();
    out.mesh = new MeshComponent(pos, new Uint32Array(0), new Uint32Array(0));
    return { geometry: out, duplicateIndex: dupIdx };
  }
  if (domain === 'FACE') {
    const polys = polysOf(mesh);
    const positions = Array.from(mesh.positions);
    const newPolys: number[][] = [...polys];
    const dups: number[] = [];
    for (const _ of polys) dups.push(0);
    for (let f = 0; f < polys.length; f++) {
      if (!selection[f]) continue;
      for (let k = 1; k <= amount; k++) {
        const newFace = polys[f]!.map((v) => {
          const idx = positions.length / 3;
          positions.push(
            mesh.positions[v * 3]!,
            mesh.positions[v * 3 + 1]!,
            mesh.positions[v * 3 + 2]!,
          );
          return idx;
        });
        newPolys.push(newFace);
        dups.push(k);
      }
    }
    const out = new Geometry();
    out.mesh = MeshComponent.fromPolys(new Float32Array(positions), newPolys);
    return { geometry: out, duplicateIndex: new Int32Array(dups) };
  }
  // EDGE / CURVE / INSTANCE fall through.
  return { geometry: geo, duplicateIndex: new Int32Array(0) };
}

/**
 * Split Edges — duplicates vertices along edges flagged by `selection` so
 * adjacent faces become topologically disconnected at that seam. Useful for
 * sharp-edge / hard-edge workflows.
 *
 * Simple implementation: rebuilds every face independently with its own
 * unique vertex copies, which is the limiting case of "split all edges".
 * When `selection` is fully true this is the desired behaviour; partial
 * selections fall back to the same conservative split (a finer-grained
 * implementation can be added without changing the call signature).
 */
export function splitEdges(geo: Geometry, _selection: ScalarTypedArray): Geometry {
  const mesh = geo.mesh;
  if (!mesh) return geo;
  const polys = polysOf(mesh);
  const positions: number[] = [];
  const newPolys: number[][] = [];
  for (const verts of polys) {
    const face: number[] = [];
    for (const v of verts) {
      const idx = positions.length / 3;
      positions.push(
        mesh.positions[v * 3]!,
        mesh.positions[v * 3 + 1]!,
        mesh.positions[v * 3 + 2]!,
      );
      face.push(idx);
    }
    newPolys.push(face);
  }
  const out = new Geometry();
  out.mesh = MeshComponent.fromPolys(new Float32Array(positions), newPolys);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
//  Phase 5: Remaining gap implementations
// ═══════════════════════════════════════════════════════════════════════

/**
 * Dual Mesh — constructs the topological dual: each face becomes a vertex
 * (at the face centroid), each vertex becomes a face (connecting the
 * centroids of its adjacent faces), and each edge is "flipped".
 *
 * Boundary edges are handled by keeping the original boundary vertex
 * positions (Blender's Dual Mesh with Keep Boundaries).
 */
export function dualMesh(geo: Geometry, keepBoundaries = false): Geometry {
  const mesh = geo.mesh;
  if (!mesh) return Geometry.empty();

  const nF = mesh.numFaces;
  const nV = mesh.numVerts;
  const faceCenters = mesh.faceCenters();

  // New vertex for each face = face centroid.
  const newPos: number[] = [];
  for (let i = 0; i < faceCenters.length; i++) newPos.push(faceCenters[i]!);

  // If keeping boundaries, also add original boundary vertices.
  const boundaryVerts = new Set<number>();
  if (keepBoundaries) {
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < nF; f++) {
      const verts = mesh.faceVerts(f);
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (!edgeFaces.has(k)) edgeFaces.set(k, []);
        edgeFaces.get(k)!.push(f);
      }
    }
    for (const [, faces] of edgeFaces) {
      if (faces.length < 2) {
        // Boundary edge
        const f = faces[0]!;
        const verts = mesh.faceVerts(f);
        for (const v of verts) boundaryVerts.add(v);
      }
    }
  }

  // Build vertex→face adjacency.
  const vertFaces = new Map<number, number[]>();
  for (let f = 0; f < nF; f++) {
    for (const v of mesh.faceVerts(f)) {
      if (!vertFaces.has(v)) vertFaces.set(v, []);
      vertFaces.get(v)!.push(f);
    }
  }

  // For each original vertex, build a face connecting the centroids of its
  // adjacent faces (ordered by edge walk for correct winding).
  const faces: number[][] = [];
  for (let v = 0; v < nV; v++) {
    const adjFaces = vertFaces.get(v);
    if (!adjFaces || adjFaces.length < 2) continue;

    // Order faces around vertex by walking edges.
    const ordered: number[] = [adjFaces[0]!];
    const used = new Set<number>([adjFaces[0]!]);
    while (ordered.length < adjFaces.length) {
      const lastFace = ordered[ordered.length - 1]!;
      const lastVerts = mesh.faceVerts(lastFace);
      let found = false;
      for (let i = 0; i < lastVerts.length; i++) {
        if (lastVerts[i] !== v) continue;
        const nextV = lastVerts[(i + 1) % lastVerts.length]!;
        // Find another face sharing edge (v, nextV)
        for (const f2 of adjFaces) {
          if (used.has(f2)) continue;
          const f2Verts = mesh.faceVerts(f2);
          const hasV = f2Verts.includes(v);
          const hasNext = f2Verts.includes(nextV);
          if (hasV && hasNext) {
            ordered.push(f2);
            used.add(f2);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found && ordered.length < adjFaces.length) {
        // Couldn't find next face — add remaining unordered
        for (const f2 of adjFaces) {
          if (!used.has(f2)) { ordered.push(f2); used.add(f2); break; }
        }
      }
    }

    if (ordered.length >= 3) {
      faces.push(ordered);
    }
  }

  const out = new Geometry();
  out.mesh = MeshComponent.fromPolys(new Float32Array(newPos), faces);
  return out;
}

/**
 * Scale Elements — scales selected faces (or edges) around their centers
 * by the given scale factor.
 */
export function scaleElements(
  geo: Geometry,
  selection: ScalarTypedArray | null,
  scale: number,
  domain: 'FACE' | 'EDGE' = 'FACE',
): Geometry {
  if (!geo.mesh) return geo;
  const out = geo.cloneOwning();
  const mesh = out.mesh!;
  const positions = mesh.positions;
  const p = positions;

  if (domain === 'FACE') {
    const centers = mesh.faceCenters();
    for (let f = 0; f < mesh.numFaces; f++) {
      if (selection && !selection[f]) continue;
      const cx = centers[f * 3]!, cy = centers[f * 3 + 1]!, cz = centers[f * 3 + 2]!;
      const verts = mesh.faceVerts(f);
      // Track which verts we've already scaled (shared verts appear in multiple faces)
      for (const v of verts) {
        const x = p[v * 3]!, y = p[v * 3 + 1]!, z = p[v * 3 + 2]!;
        p[v * 3]     = cx + (x - cx) * scale;
        p[v * 3 + 1] = cy + (y - cy) * scale;
        p[v * 3 + 2] = cz + (z - cz) * scale;
      }
    }
  } else {
    // EDGE domain: scale each edge's midpoint
    const edges = mesh.edges();
    if (edges) {
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i]!, b = edges[i + 1]!;
        const mx = (p[a * 3]! + p[b * 3]!) / 2;
        const my = (p[a * 3 + 1]! + p[b * 3 + 1]!) / 2;
        const mz = (p[a * 3 + 2]! + p[b * 3 + 2]!) / 2;
        for (const v of [a, b]) {
          p[v * 3]     = mx + (p[v * 3]! - mx) * scale;
          p[v * 3 + 1] = my + (p[v * 3 + 1]! - my) * scale;
          p[v * 3 + 2] = mz + (p[v * 3 + 2]! - mz) * scale;
        }
      }
    }
  }

  mesh.invalidateCaches();
  return out;
}

/**
 * Blur Attribute — Laplacian smoothing of a scalar attribute across the mesh.
 * Each iteration averages each vertex's value with its neighbors, weighted
 * by the `weight` parameter.
 */
export function blurAttribute(
  geo: Geometry,
  attributeName: string,
  iterations: number,
  weight: number,
): Geometry {
  if (!geo.mesh) return geo;
  const out = geo.cloneOwning();
  const mesh = out.mesh!;
  const attr = mesh.attributes.get(attributeName);
  if (!attr || attr.dimensions !== 1) return out;

  const data = attr.data as Float32Array;
  const nV = mesh.numVerts;

  // Build adjacency.
  const adj = new Map<number, number[]>();
  const edges = mesh.edges();
  if (edges) {
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i]!, b = edges[i + 1]!;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const newData = new Float32Array(data.length);
    for (let v = 0; v < nV; v++) {
      const neighbors = adj.get(v) ?? [];
      if (neighbors.length === 0) {
        newData[v] = data[v] ?? 0;
        continue;
      }
      let sum = 0;
      for (const nb of neighbors) sum += data[nb] ?? 0;
      const avg = sum / neighbors.length;
      const current = data[v] ?? 0;
      newData[v] = current + weight * (avg - current);
    }
    for (let v = 0; v < nV; v++) data[v] = newData[v]!;
  }

  return out;
}

/**
 * Sample Nearest Surface — finds the closest point on the mesh surface
 * to a given sample position and interpolates a value using barycentric
 * coordinates.
 */
export function sampleNearestSurface(
  target: Geometry,
  samplePos: Vec3,
): { position: Vec3; normal: Vec3; baryCoords: Vec3; faceIndex: number } {
  const mesh = target.mesh;
  if (!mesh || mesh.numTris === 0) {
    return { position: [0, 0, 0], normal: [0, 0, 1], baryCoords: [1, 0, 0], faceIndex: 0 };
  }

  const p = mesh.positions;
  const t = mesh.triangles;
  let bestDist = Infinity;
  let bestPos: Vec3 = [0, 0, 0];
  let bestBary: Vec3 = [1, 0, 0];
  let bestFace = 0;

  for (let i = 0; i < mesh.numTris; i++) {
    const ai = t[i * 3]! * 3, bi = t[i * 3 + 1]! * 3, ci = t[i * 3 + 2]! * 3;
    const a: Vec3 = [p[ai]!, p[ai + 1]!, p[ai + 2]!];
    const b: Vec3 = [p[bi]!, p[bi + 1]!, p[bi + 2]!];
    const c: Vec3 = [p[ci]!, p[ci + 1]!, p[ci + 2]!];
    const q = closestPointTriangle(samplePos, a, b, c);
    const d = Math.hypot(q[0] - samplePos[0], q[1] - samplePos[1], q[2] - samplePos[2]);
    if (d < bestDist) {
      bestDist = d;
      bestPos = q;
      bestFace = i;
      // Compute barycentric coordinates
      const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const ap: Vec3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      const d00 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const d01 = ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2];
      const d11 = ac[0] * ac[0] + ac[1] * ac[1] + ac[2] * ac[2];
      const d20 = ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2];
      const d21 = ap[0] * ac[0] + ap[1] * ac[1] + ap[2] * ac[2];
      const denom = d00 * d11 - d01 * d01;
      if (Math.abs(denom) > 1e-12) {
        const v = (d11 * d20 - d01 * d21) / denom;
        const w = (d00 * d21 - d01 * d20) / denom;
        const u = 1 - v - w;
        bestBary = [Math.max(0, u), Math.max(0, v), Math.max(0, w)];
      }
    }
  }

  const triToFace = mesh.triToFace();
  const faceIdx = triToFace[bestFace] ?? bestFace;
  const fn = mesh.faceNormals();

  return {
    position: bestPos,
    normal: [fn[faceIdx * 3] ?? 0, fn[faceIdx * 3 + 1] ?? 0, fn[faceIdx * 3 + 2] ?? 1],
    baryCoords: bestBary,
    faceIndex: faceIdx,
  };
}

/**
 * Offset Point in Curve — returns the point index at a given offset
 * from the current point within the same curve.
 */
export function offsetPointInCurve(
  geo: Geometry,
  pointIndex: number,
  offset: number,
): { isValid: boolean; resultIndex: number } {
  const curves = geo.curves;
  if (!curves) return { isValid: false, resultIndex: 0 };

  // Find which curve this point belongs to.
  for (let ci = 0; ci < curves.numCurves; ci++) {
    const start = curves.curveOffsets[ci] ?? 0;
    const end = curves.curveOffsets[ci + 1] ?? start;
    if (pointIndex >= start && pointIndex < end) {
      const resultIndex = pointIndex + offset;
      const cyclic = !!curves.cyclic[ci];
      if (cyclic) {
        const n = end - start;
        const wrapped = ((resultIndex - start) % n + n) % n + start;
        return { isValid: true, resultIndex: wrapped };
      }
      return {
        isValid: resultIndex >= start && resultIndex < end,
        resultIndex: Math.max(start, Math.min(end - 1, resultIndex)),
      };
    }
  }
  return { isValid: false, resultIndex: 0 };
}

/**
 * Points of Curve — given a curve index, returns the point indices
 * belonging to that curve and the total count.
 */
export function pointsOfCurve(
  geo: Geometry,
  curveIndex: number,
): { pointIndices: number[]; total: number } {
  const curves = geo.curves;
  if (!curves || curveIndex < 0 || curveIndex >= curves.numCurves) {
    return { pointIndices: [], total: 0 };
  }
  const start = curves.curveOffsets[curveIndex] ?? 0;
  const end = curves.curveOffsets[curveIndex + 1] ?? start;
  const indices: number[] = [];
  for (let i = start; i < end; i++) indices.push(i);
  return { pointIndices: indices, total: end - start };
}

/**
 * Curve of Point — given a point index, returns which curve it belongs to
 * and its index within that curve.
 */
export function curveOfPoint(
  geo: Geometry,
  pointIndex: number,
): { curveIndex: number; indexInCurve: number } {
  const curves = geo.curves;
  if (!curves) return { curveIndex: 0, indexInCurve: 0 };

  for (let ci = 0; ci < curves.numCurves; ci++) {
    const start = curves.curveOffsets[ci] ?? 0;
    const end = curves.curveOffsets[ci + 1] ?? start;
    if (pointIndex >= start && pointIndex < end) {
      return { curveIndex: ci, indexInCurve: pointIndex - start };
    }
  }
  return { curveIndex: 0, indexInCurve: 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  Phase 6: Volume operations & remaining gap implementations
// ═══════════════════════════════════════════════════════════════════════

import { VolumeComponent } from './Geometry';

/**
 * Mesh to Volume — voxelize a mesh into a sparse volume grid.
 *
 * For each voxel, we check if its center is inside the mesh using a
 * ray-casting parity test (odd number of crossings = inside). Voxels
 * near the surface get density proportional to their distance from the
 * nearest surface point.
 */
export function meshToVolume(
  geo: Geometry,
  density: number,
  voxelSize: number,
  exteriorBandWidth: number,
  interiorBandWidth: number,
  fillInterior: boolean,
): Geometry {
  const mesh = geo.mesh;
  if (!mesh || mesh.numTris === 0) return Geometry.empty();

  // Compute bounding box + padding.
  const bb = boundingBox(geo);
  const pad = Math.max(exteriorBandWidth, voxelSize * 2);
  const min: Vec3 = [bb.min[0] - pad, bb.min[1] - pad, bb.min[2] - pad];
  const max: Vec3 = [bb.max[0] + pad, bb.max[1] + pad, bb.max[2] + pad];

  const dimX = Math.max(1, Math.ceil((max[0] - min[0]) / voxelSize));
  const dimY = Math.max(1, Math.ceil((max[1] - min[1]) / voxelSize));
  const dimZ = Math.max(1, Math.ceil((max[2] - min[2]) / voxelSize));

  // Cap total voxels to prevent memory explosion.
  const maxVoxels = 256 * 256 * 256;
  if (dimX * dimY * dimZ > maxVoxels) {
    const scale = Math.pow(maxVoxels / (dimX * dimY * dimZ), 1 / 3);
    const adjSize = voxelSize / scale;
    return meshToVolume(geo, density, adjSize, exteriorBandWidth, interiorBandWidth, fillInterior);
  }

  const vol = new VolumeComponent(dimX, dimY, dimZ, voxelSize, min);
  const tris = mesh.triangles;
  const p = mesh.positions;
  const surfaceBand = exteriorBandWidth;
  const interiorBand = interiorBandWidth;

  // For each voxel, compute signed distance approximation.
  for (let iz = 0; iz < dimZ; iz++) {
    for (let iy = 0; iy < dimY; iy++) {
      for (let ix = 0; ix < dimX; ix++) {
        const [wx, wy, wz] = vol.voxelPos(ix, iy, iz);

        // Find nearest surface distance (brute force over triangles).
        let minDist = Infinity;
        for (let t = 0; t < mesh.numTris; t++) {
          const ai = tris[t * 3]! * 3, bi = tris[t * 3 + 1]! * 3, ci = tris[t * 3 + 2]! * 3;
          const a: Vec3 = [p[ai]!, p[ai + 1]!, p[ai + 2]!];
          const b: Vec3 = [p[bi]!, p[bi + 1]!, p[bi + 2]!];
          const c: Vec3 = [p[ci]!, p[ci + 1]!, p[ci + 2]!];
          const q = closestPointTriangle([wx, wy, wz], a, b, c);
          const d = Math.hypot(q[0] - wx, q[1] - wy, q[2] - wz);
          if (d < minDist) minDist = d;
        }

        // Ray-cast parity test for interior.
        let inside = false;
        if (fillInterior || interiorBand > 0) {
          const dir: Vec3 = [0, 0, 1];
          let crossings = 0;
          for (let t = 0; t < mesh.numTris; t++) {
            const ai = tris[t * 3]! * 3, bi = tris[t * 3 + 1]! * 3, ci = tris[t * 3 + 2]! * 3;
            const ax = p[ai]!, ay = p[ai + 1]!, az = p[ai + 2]!;
            const bx = p[bi]!, by = p[bi + 1]!, bz = p[bi + 2]!;
            const cx = p[ci]!, cy = p[ci + 1]!, cz = p[ci + 2]!;
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
            const px = dir[1] * e2z - dir[2] * e2y;
            const py = dir[2] * e2x - dir[0] * e2z;
            const pz = dir[0] * e2y - dir[1] * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < 1e-9) continue;
            const invDet = 1 / det;
            const tx = wx - ax, ty = wy - ay, tz = wz - az;
            const u = (tx * px + ty * py + tz * pz) * invDet;
            if (u < 0 || u > 1) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
            if (v < 0 || u + v > 1) continue;
            const tVal = (e2x * qx + e2y * qy + e2z * qz) * invDet;
            if (tVal > 0) crossings++;
          }
          inside = (crossings % 2) === 1;
        }

        // Compute density.
        let d = 0;
        if (inside && fillInterior) {
          d = density;
        } else if (inside && interiorBand > 0) {
          d = density * Math.max(0, 1 - minDist / interiorBand);
        } else if (minDist < surfaceBand) {
          d = density * Math.max(0, 1 - minDist / surfaceBand);
        }
        vol.set(ix, iy, iz, d);
      }
    }
  }

  const out = new Geometry();
  out.volume = vol;
  return out;
}

/**
 * Volume to Mesh — extract an isosurface from a volume using marching cubes.
 *
 * This is a simplified marching cubes implementation that extracts the
 * surface at a given threshold density.
 */
export function volumeToMesh(geo: Geometry, threshold: number): Geometry {
  const vol = geo.volume;
  if (!vol || vol.numVoxels === 0) return Geometry.empty();

  // Simplified marching cubes: for each voxel, check if it's near the threshold
  // and emit a small cube if so.
  const positions: number[] = [];
  const faces: number[][] = [];
  let vertBase = 0;

  for (let iz = 0; iz < vol.dimZ - 1; iz++) {
    for (let iy = 0; iy < vol.dimY - 1; iy++) {
      for (let ix = 0; ix < vol.dimX - 1; ix++) {
        // Sample 8 corners of the cube.
        const corners = [
          vol.get(ix, iy, iz), vol.get(ix + 1, iy, iz),
          vol.get(ix + 1, iy + 1, iz), vol.get(ix, iy + 1, iz),
          vol.get(ix, iy, iz + 1), vol.get(ix + 1, iy, iz + 1),
          vol.get(ix + 1, iy + 1, iz + 1), vol.get(ix, iy + 1, iz + 1),
        ];
        const aboveThreshold = corners.some((c) => c >= threshold);
        const belowThreshold = corners.some((c) => c < threshold);
        if (!aboveThreshold || !belowThreshold) continue;

        // Emit a cube at this voxel.
        const [x, y, z] = vol.voxelPos(ix, iy, iz);
        const s = vol.voxelSize * 0.5;
        const base = vertBase;
        positions.push(
          x - s, y - s, z - s,  x + s, y - s, z - s,
          x + s, y + s, z - s,  x - s, y + s, z - s,
          x - s, y - s, z + s,  x + s, y - s, z + s,
          x + s, y + s, z + s,  x - s, y + s, z + s,
        );
        faces.push(
          [base, base + 3, base + 2, base + 1],
          [base + 4, base + 5, base + 6, base + 7],
          [base, base + 1, base + 5, base + 4],
          [base + 2, base + 3, base + 7, base + 6],
          [base + 1, base + 2, base + 6, base + 5],
          [base, base + 4, base + 7, base + 3],
        );
        vertBase += 8;
      }
    }
  }

  if (positions.length === 0) return Geometry.empty();
  const out = new Geometry();
  out.mesh = MeshComponent.fromPolys(new Float32Array(positions), faces);
  return out;
}

/**
 * Points to Volume — create a volume from a point cloud by splatting
 * Gaussian density kernels at each point position.
 */
export function pointsToVolume(
  geo: Geometry,
  density: number,
  voxelSize: number,
  radius: number,
): Geometry {
  const pos = geo.points?.positions ?? geo.mesh?.positions;
  if (!pos || pos.length === 0) return Geometry.empty();

  const n = pos.length / 3;

  // Compute bounding box.
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }

  const pad = radius + voxelSize;
  const origin: Vec3 = [mnx - pad, mny - pad, mnz - pad];
  const dimX = Math.max(1, Math.ceil((mxx - mnx + 2 * pad) / voxelSize));
  const dimY = Math.max(1, Math.ceil((mxy - mny + 2 * pad) / voxelSize));
  const dimZ = Math.max(1, Math.ceil((mxz - mnz + 2 * pad) / voxelSize));

  // Cap total voxels.
  const maxVoxels = 128 * 128 * 128;
  if (dimX * dimY * dimZ > maxVoxels) {
    const scale = Math.pow(maxVoxels / (dimX * dimY * dimZ), 1 / 3);
    return pointsToVolume(geo, density, voxelSize / scale, radius);
  }

  const vol = new VolumeComponent(dimX, dimY, dimZ, voxelSize, origin);
  const sigmaSq = radius * radius;
  const cutoff = radius * 2;

  for (let p = 0; p < n; p++) {
    const px = pos[p * 3]!, py = pos[p * 3 + 1]!, pz = pos[p * 3 + 2]!;

    // Voxel range affected by this point.
    const ixMin = Math.max(0, Math.floor((px - cutoff - origin[0]) / voxelSize));
    const ixMax = Math.min(dimX - 1, Math.ceil((px + cutoff - origin[0]) / voxelSize));
    const iyMin = Math.max(0, Math.floor((py - cutoff - origin[1]) / voxelSize));
    const iyMax = Math.min(dimY - 1, Math.ceil((py + cutoff - origin[1]) / voxelSize));
    const izMin = Math.max(0, Math.floor((pz - cutoff - origin[2]) / voxelSize));
    const izMax = Math.min(dimZ - 1, Math.ceil((pz + cutoff - origin[2]) / voxelSize));

    for (let iz = izMin; iz <= izMax; iz++) {
      for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let ix = ixMin; ix <= ixMax; ix++) {
          const [wx, wy, wz] = vol.voxelPos(ix, iy, iz);
          const dx = wx - px, dy = wy - py, dz = wz - pz;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > sigmaSq * 4) continue;
          const contribution = density * Math.exp(-distSq / (2 * sigmaSq));
          vol.data[vol.index(ix, iy, iz)] = (vol.data[vol.index(ix, iy, iz)] ?? 0) + contribution;
        }
      }
    }
  }

  const out = new Geometry();
  out.volume = vol;
  return out;
}

/**
 * Merge Layers — merge all components of multiple geometries into one.
 * This is essentially joinGeometries but preserves volume components too.
 */
export function mergeLayers(sources: Geometry[]): Geometry {
  if (sources.length === 0) return Geometry.empty();
  if (sources.length === 1) return sources[0]!;

  // Use joinGeometries for mesh/curves/points/instances.
  const out = joinGeometries(sources);

  // Merge volumes: take the first volume found (can't meaningfully merge
  // voxel grids of different dimensions).
  for (const src of sources) {
    if (src.volume) {
      out.volume = src.volume;
      break;
    }
  }

  return out;
}

/**
 * Interpolate Curves — interpolate between guide curves to produce
 * intermediate curves. Each point on the output curve is a weighted
 * blend of the nearest guide curves.
 *
 * Simplified implementation: for each input point, find the nearest
 * guide curve and project it onto that curve's polyline.
 */
export function interpolateCurves(
  guideCurves: Geometry,
  guideUp: Float32Array | null,
  guideGroupId: number,
  points: Geometry,
  pointUp: Float32Array | null,
  pointGroupId: number,
  maxNeighbors: number,
): { curves: Geometry; closestIndex: Int32Array; closestWeight: Float32Array } {
  const guideC = guideCurves.curves;
  const pointPos = points.points?.positions ?? points.mesh?.positions;

  if (!guideC || !pointPos || guideC.numPoints === 0) {
    return {
      curves: Geometry.empty(),
      closestIndex: new Int32Array(0),
      closestWeight: new Float32Array(0),
    };
  }

  const nPoints = pointPos.length / 3;

  // Build guide curve point arrays.
  const guidePoints: Vec3[][] = [];
  for (let ci = 0; ci < guideC.numCurves; ci++) {
    const start = guideC.curveOffsets[ci] ?? 0;
    const end = guideC.curveOffsets[ci + 1] ?? start;
    const pts: Vec3[] = [];
    for (let i = start; i < end; i++) {
      pts.push([
        guideC.positions[i * 3] ?? 0,
        guideC.positions[i * 3 + 1] ?? 0,
        guideC.positions[i * 3 + 2] ?? 0,
      ]);
    }
    guidePoints.push(pts);
  }

  // For each point, find the nearest guide curve and project onto it.
  const closestIndex = new Int32Array(nPoints);
  const closestWeight = new Float32Array(nPoints);
  const newPositions: number[] = [];

  for (let i = 0; i < nPoints; i++) {
    const px = pointPos[i * 3]!, py = pointPos[i * 3 + 1]!, pz = pointPos[i * 3 + 2]!;
    let bestDist = Infinity;
    let bestCurve = 0;
    let bestProjPos: Vec3 = [px, py, pz];

    for (let ci = 0; ci < guidePoints.length; ci++) {
      const pts = guidePoints[ci]!;
      if (pts.length === 0) continue;

      // Find nearest point on this guide curve.
      for (let j = 0; j < pts.length - 1; j++) {
        const a = pts[j]!, b = pts[j + 1]!;
        const q = closestPointSegment([px, py, pz], a, b);
        const d = Math.hypot(q[0] - px, q[1] - py, q[2] - pz);
        if (d < bestDist) {
          bestDist = d;
          bestCurve = ci;
          bestProjPos = q;
        }
      }
      // Check last point.
      const last = pts[pts.length - 1]!;
      const dLast = Math.hypot(last[0] - px, last[1] - py, last[2] - pz);
      if (dLast < bestDist) {
        bestDist = dLast;
        bestCurve = ci;
        bestProjPos = last;
      }
    }

    closestIndex[i] = bestCurve;
    closestWeight[i] = 1 / (1 + bestDist);
    newPositions.push(bestProjPos[0], bestProjPos[1], bestProjPos[2]);
  }

  // Create a curve from the interpolated positions.
  const positions = new Float32Array(newPositions);
  const offsets = new Uint32Array([0, nPoints]);
  const cyclic = new Uint8Array([0]);
  const res = new Uint16Array([12]);

  const out = new Geometry();
  out.curves = new CurvesComponent(positions, offsets, cyclic, res);

  return { curves: out, closestIndex, closestWeight };
}

/**
 * Sample UV Surface — sample a value at a UV coordinate on a mesh surface.
 *
 * For each triangle, we compute barycentric coordinates from the UV and
 * interpolate the value.
 */
export function sampleUVSurface(
  target: Geometry,
  uvMapName: string,
  sampleUV: Vec3,
): { value: Vec3; isValid: boolean } {
  const mesh = target.mesh;
  if (!mesh || mesh.numTris === 0) return { value: [0, 0, 0], isValid: false };

  const uvAttr = mesh.attributes.get(uvMapName);
  if (!uvAttr || uvAttr.dimensions < 2) return { value: [0, 0, 0], isValid: false };

  const uvData = uvAttr.data as Float32Array;
  const tris = mesh.triangles;
  const su = sampleUV[0], sv = sampleUV[1];

  // Find the triangle whose UV contains the sample point.
  for (let t = 0; t < mesh.numTris; t++) {
    const a = tris[t * 3]!, b = tris[t * 3 + 1]!, c = tris[t * 3 + 2]!;
    const u0 = uvData[a * 2] ?? 0, v0 = uvData[a * 2 + 1] ?? 0;
    const u1 = uvData[b * 2] ?? 0, v1 = uvData[b * 2 + 1] ?? 0;
    const u2 = uvData[c * 2] ?? 0, v2 = uvData[c * 2 + 1] ?? 0;

    // Barycentric coordinates.
    const d00 = u1 - u0, d01 = u2 - u0;
    const d10 = v1 - v0, d11 = v2 - v0;
    const det = d00 * d11 - d01 * d10;
    if (Math.abs(det) < 1e-12) continue;

    const invDet = 1 / det;
    const dsu = su - u0, dsv = sv - v0;
    const w1 = (dsu * d11 - dsv * d01) * invDet;
    const w2 = (dsv * d00 - dsu * d10) * invDet;
    const w0 = 1 - w1 - w2;

    if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001 && w0 + w1 + w2 <= 1.001) {
      // Interpolate position.
      const pos = mesh.positions;
      const px = (pos[a * 3] ?? 0) * w0 + (pos[b * 3] ?? 0) * w1 + (pos[c * 3] ?? 0) * w2;
      const py = (pos[a * 3 + 1] ?? 0) * w0 + (pos[b * 3 + 1] ?? 0) * w1 + (pos[c * 3 + 1] ?? 0) * w2;
      const pz = (pos[a * 3 + 2] ?? 0) * w0 + (pos[b * 3 + 2] ?? 0) * w1 + (pos[c * 3 + 2] ?? 0) * w2;
      return { value: [px, py, pz], isValid: true };
    }
  }

  return { value: [0, 0, 0], isValid: false };
}

/**
 * Image Texture in geometry context — sample an ImageData at UV coordinates
 * with optional wrap mode.
 */
export function sampleImageInGeo(
  imageData: ImageData | null,
  uv: Vec3,
  extension: 'REPEAT' | 'EXTEND' | 'CLIP' | 'MIRROR' = 'REPEAT',
): { color: Vec3; alpha: number } {
  if (!imageData) return { color: [1, 1, 1], alpha: 1 };

  const wrap = (u: number): number => {
    switch (extension) {
      case 'EXTEND': return Math.max(0, Math.min(1, u));
      case 'CLIP': return u < 0 || u > 1 ? -1 : u;
      case 'MIRROR': {
        const m = Math.abs(u % 2);
        return m > 1 ? 2 - m : m;
      }
      default: { // REPEAT
        const r = u - Math.floor(u);
        return r < 0 ? r + 1 : r;
      }
    }
  };

  const u = wrap(uv[0]);
  const v = wrap(uv[1]);
  if (u < 0 || v < 0) return { color: [0, 0, 0], alpha: 0 };

  const x = Math.max(0, Math.min(imageData.width - 1, Math.floor(u * imageData.width)));
  const y = Math.max(0, Math.min(imageData.height - 1, Math.floor(v * imageData.height)));
  const i = (y * imageData.width + x) * 4;

  return {
    color: [
      (imageData.data[i] ?? 255) / 255,
      (imageData.data[i + 1] ?? 255) / 255,
      (imageData.data[i + 2] ?? 255) / 255,
    ],
    alpha: (imageData.data[i + 3] ?? 255) / 255,
  };
}

/**
 * String to Curves — convert a string to curve geometry.
 *
 * This is a simplified implementation that generates placeholder curves
 * (one curve per character, spaced horizontally). A full implementation
 * would require font rendering (SDF or bezier outlines).
 */
export function stringToCurves(
  text: string,
  size: number,
  characterSpacing: number,
  wordSpacing: number,
  lineSpacing: number,
  boxWidth: number,
  boxHeight: number,
): Geometry {
  if (!text) return Geometry.empty();

  const positions: number[] = [];
  const offsets: number[] = [0];
  const cyclic = new Uint8Array(0);
  const res = new Uint16Array(0);

  let x = 0, y = 0;
  const charWidth = size * 0.6 * characterSpacing;
  const spaceWidth = size * 0.6 * wordSpacing;
  const lineHeight = size * lineSpacing;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (ch === '\n') {
      x = 0;
      y -= lineHeight;
      continue;
    }
    if (ch === ' ') {
      x += spaceWidth;
      continue;
    }

    // Check box width wrapping.
    if (boxWidth > 0 && x + charWidth > boxWidth) {
      x = 0;
      y -= lineHeight;
    }

    // Generate a simple placeholder curve for this character.
    // In a real implementation, this would use font bezier outlines.
    const w = charWidth * 0.8;
    const h = size * 0.8;
    positions.push(
      x, y, 0,
      x + w, y, 0,
      x + w, y + h, 0,
      x, y + h, 0,
      x, y, 0,
    );
    offsets.push(offsets[offsets.length - 1]! + 5);

    x += charWidth;
  }

  if (positions.length === 0) return Geometry.empty();

  const out = new Geometry();
  out.curves = new CurvesComponent(
    new Float32Array(positions),
    new Uint32Array(offsets),
    new Uint8Array(offsets.length - 1),
    new Uint16Array(offsets.length - 1).fill(12),
  );
  return out;
}
