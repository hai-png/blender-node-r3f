/**
 * Geometry data structure used by the Geometry Nodes evaluator.
 *
 * Mirrors Blender's `Geometry` aggregate: a container of independent
 * components (Mesh, Curves, PointCloud, Volume, Instances), each with
 * typed per-domain attribute arrays.
 *
 * M0 shipped Mesh + Instances. M2 adds Curves + PointCloud, attribute
 * helpers, and domain-aware interpolation.
 */
import type { AttributeDomain, Vec3 } from '../../core/types';

/* ------------------------------------------------------------------ */
/*  Attribute types                                                   */
/* ------------------------------------------------------------------ */

export type ScalarTypedArray = Float32Array | Int32Array | Uint8Array | Uint32Array;
export type AttributeArray = ScalarTypedArray;

export type AttributeDataType = 'FLOAT' | 'INT' | 'BOOL' | 'VECTOR' | 'COLOR' | 'BYTE_COLOR';

export interface Attribute {
  name: string;
  domain: AttributeDomain;
  /** 1 = scalar, 3 = vec3, 4 = vec4. */
  dimensions: 1 | 2 | 3 | 4;
  data_type: AttributeDataType;
  data: AttributeArray;
}

export function newAttribute(
  name: string,
  domain: AttributeDomain,
  data_type: AttributeDataType,
  size: number,
): Attribute {
  const dims: 1 | 2 | 3 | 4 =
    data_type === 'VECTOR' ? 3 :
    data_type === 'COLOR' ? 4 :
    data_type === 'BYTE_COLOR' ? 4 :
    1;
  const len = size * dims;
  let data: AttributeArray;
  switch (data_type) {
    case 'INT': data = new Int32Array(len); break;
    case 'BOOL': data = new Uint8Array(len); break;
    case 'BYTE_COLOR': data = new Uint8Array(len); break;
    default: data = new Float32Array(len);
  }
  return { name, domain, dimensions: dims, data_type, data };
}

/* ------------------------------------------------------------------ */
/*  Mesh                                                              */
/* ------------------------------------------------------------------ */

export class MeshComponent {
  positions: Float32Array;
  triangles: Uint32Array;
  attributes = new Map<string, Attribute>();

  /** Lazy caches. */
  private _normalsPoint?: Float32Array;
  private _normalsFace?: Float32Array;
  private _faceAreas?: Float32Array;

  constructor(positions: Float32Array, triangles: Uint32Array) {
    this.positions = positions;
    this.triangles = triangles;
    this.attributes.set('position', {
      name: 'position', domain: 'POINT', dimensions: 3,
      data_type: 'VECTOR', data: positions,
    });
  }

  get numVerts() { return this.positions.length / 3; }
  get numTris() { return this.triangles.length / 3; }
  /** Mesh treats triangles as faces; an n-gon would expand into multiple. */
  get numFaces() { return this.numTris; }
  get numEdges() { return this.numTris * 3; }      // upper bound (with duplicates)
  get numCorners() { return this.numTris * 3; }

  invalidateCaches(): void {
    this._normalsPoint = undefined;
    this._normalsFace = undefined;
    this._faceAreas = undefined;
  }

  faceNormals(): Float32Array {
    if (this._normalsFace) return this._normalsFace;
    const t = this.triangles, p = this.positions;
    const out = new Float32Array(this.numTris * 3);
    for (let i = 0; i < this.numTris; i++) {
      const a = t[i * 3]! * 3, b = t[i * 3 + 1]! * 3, c = t[i * 3 + 2]! * 3;
      const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
      const bx = p[b]!, by = p[b + 1]!, bz = p[b + 2]!;
      const cx = p[c]!, cy = p[c + 1]!, cz = p[c + 2]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      out[i * 3] = nx; out[i * 3 + 1] = ny; out[i * 3 + 2] = nz;
    }
    this._normalsFace = out;
    return out;
  }

  pointNormals(): Float32Array {
    if (this._normalsPoint) return this._normalsPoint;
    const fn = this.faceNormals();
    const t = this.triangles;
    const out = new Float32Array(this.numVerts * 3);
    for (let i = 0; i < this.numTris; i++) {
      const nx = fn[i * 3]!, ny = fn[i * 3 + 1]!, nz = fn[i * 3 + 2]!;
      for (let k = 0; k < 3; k++) {
        const v = t[i * 3 + k]! * 3;
        out[v] = (out[v] ?? 0) + nx;
        out[v + 1] = (out[v + 1] ?? 0) + ny;
        out[v + 2] = (out[v + 2] ?? 0) + nz;
      }
    }
    for (let i = 0; i < this.numVerts; i++) {
      const x = out[i * 3]!, y = out[i * 3 + 1]!, z = out[i * 3 + 2]!;
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
    this._normalsPoint = out;
    return out;
  }

  faceAreas(): Float32Array {
    if (this._faceAreas) return this._faceAreas;
    const t = this.triangles, p = this.positions;
    const out = new Float32Array(this.numTris);
    for (let i = 0; i < this.numTris; i++) {
      const a = t[i * 3]! * 3, b = t[i * 3 + 1]! * 3, c = t[i * 3 + 2]! * 3;
      const ux = p[b]! - p[a]!,     uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!,     vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      out[i] = 0.5 * Math.hypot(cx, cy, cz);
    }
    this._faceAreas = out;
    return out;
  }

  clone(): MeshComponent {
    const m = new MeshComponent(new Float32Array(this.positions), new Uint32Array(this.triangles));
    for (const [k, attr] of this.attributes) {
      if (k === 'position') continue;
      const dataCopy =
        attr.data instanceof Float32Array ? new Float32Array(attr.data)
        : attr.data instanceof Int32Array ? new Int32Array(attr.data)
        : attr.data instanceof Uint32Array ? new Uint32Array(attr.data)
        : new Uint8Array(attr.data);
      m.attributes.set(k, { ...attr, data: dataCopy });
    }
    return m;
  }
}

/* ------------------------------------------------------------------ */
/*  Curves                                                            */
/* ------------------------------------------------------------------ */

export type SplineType = 'CATMULL_ROM' | 'POLY' | 'BEZIER' | 'NURBS';

export class CurvesComponent {
  positions: Float32Array;            // size = numPoints * 3
  /** CSR offsets: curve i covers [offsets[i], offsets[i+1]). */
  curveOffsets: Uint32Array;          // size = numCurves + 1
  cyclic: Uint8Array;                 // size = numCurves
  resolution: Uint16Array;            // size = numCurves
  splineType: Uint8Array;             // SplineType enum, size = numCurves
  attributes = new Map<string, Attribute>();

  constructor(
    positions: Float32Array,
    curveOffsets: Uint32Array,
    cyclic?: Uint8Array,
    resolution?: Uint16Array,
    splineType?: Uint8Array,
  ) {
    this.positions = positions;
    this.curveOffsets = curveOffsets;
    this.cyclic = cyclic ?? new Uint8Array(curveOffsets.length - 1);
    this.resolution = resolution ?? new Uint16Array(curveOffsets.length - 1).fill(12);
    this.splineType = splineType ?? new Uint8Array(curveOffsets.length - 1); // CATMULL_ROM
    this.attributes.set('position', {
      name: 'position', domain: 'POINT', dimensions: 3,
      data_type: 'VECTOR', data: positions,
    });
  }

  get numPoints(): number { return this.positions.length / 3; }
  get numCurves(): number { return this.curveOffsets.length - 1; }

  curveLength(i: number): number {
    return (this.curveOffsets[i + 1] ?? 0) - (this.curveOffsets[i] ?? 0);
  }

  clone(): CurvesComponent {
    const c = new CurvesComponent(
      new Float32Array(this.positions),
      new Uint32Array(this.curveOffsets),
      new Uint8Array(this.cyclic),
      new Uint16Array(this.resolution),
      new Uint8Array(this.splineType),
    );
    for (const [k, attr] of this.attributes) {
      if (k === 'position') continue;
      const dataCopy =
        attr.data instanceof Float32Array ? new Float32Array(attr.data)
        : attr.data instanceof Int32Array ? new Int32Array(attr.data)
        : attr.data instanceof Uint32Array ? new Uint32Array(attr.data)
        : new Uint8Array(attr.data);
      c.attributes.set(k, { ...attr, data: dataCopy });
    }
    return c;
  }
}

/* ------------------------------------------------------------------ */
/*  PointCloud                                                        */
/* ------------------------------------------------------------------ */

export class PointCloudComponent {
  positions: Float32Array;
  radii: Float32Array;
  attributes = new Map<string, Attribute>();

  constructor(positions: Float32Array, radii?: Float32Array) {
    this.positions = positions;
    this.radii = radii ?? new Float32Array(positions.length / 3).fill(0.05);
    this.attributes.set('position', {
      name: 'position', domain: 'POINT', dimensions: 3,
      data_type: 'VECTOR', data: positions,
    });
    this.attributes.set('radius', {
      name: 'radius', domain: 'POINT', dimensions: 1,
      data_type: 'FLOAT', data: this.radii,
    });
  }

  get numPoints(): number { return this.positions.length / 3; }

  clone(): PointCloudComponent {
    const p = new PointCloudComponent(new Float32Array(this.positions), new Float32Array(this.radii));
    for (const [k, attr] of this.attributes) {
      if (k === 'position' || k === 'radius') continue;
      const dataCopy =
        attr.data instanceof Float32Array ? new Float32Array(attr.data)
        : attr.data instanceof Int32Array ? new Int32Array(attr.data)
        : attr.data instanceof Uint32Array ? new Uint32Array(attr.data)
        : new Uint8Array(attr.data);
      p.attributes.set(k, { ...attr, data: dataCopy });
    }
    return p;
  }
}

/* ------------------------------------------------------------------ */
/*  Instances                                                         */
/* ------------------------------------------------------------------ */

export interface InstanceItem {
  source: number;             // index into Geometry.instances.sources
  transform: Float32Array;    // column-major mat4
}

export class InstancesComponent {
  sources: Geometry[] = [];
  items: InstanceItem[] = [];
  attributes = new Map<string, Attribute>();

  addInstance(source: number, transform: Float32Array): void {
    this.items.push({ source, transform });
  }

  get numInstances(): number { return this.items.length; }
}

/* ------------------------------------------------------------------ */
/*  Top-level Geometry                                                */
/* ------------------------------------------------------------------ */

export class Geometry {
  mesh?: MeshComponent;
  curves?: CurvesComponent;
  points?: PointCloudComponent;
  instances?: InstancesComponent;

  static empty(): Geometry { return new Geometry(); }

  /** Shallow copy — components are reused. */
  copy(): Geometry {
    const g = new Geometry();
    g.mesh = this.mesh;
    g.curves = this.curves;
    g.points = this.points;
    g.instances = this.instances;
    return g;
  }

  /** Deep clone. */
  cloneOwning(): Geometry {
    const g = new Geometry();
    if (this.mesh) g.mesh = this.mesh.clone();
    if (this.curves) g.curves = this.curves.clone();
    if (this.points) g.points = this.points.clone();
    if (this.instances) {
      const ic = new InstancesComponent();
      ic.sources = this.instances.sources.map((s) => s.cloneOwning());
      ic.items = this.instances.items.map((it) => ({
        source: it.source, transform: new Float32Array(it.transform),
      }));
      g.instances = ic;
    }
    return g;
  }

  /** Domain size for whichever component owns the domain. */
  domainSize(domain: AttributeDomain): number {
    switch (domain) {
      case 'POINT':
        return this.mesh?.numVerts ?? this.curves?.numPoints ?? this.points?.numPoints ?? 0;
      case 'EDGE': return this.mesh?.numEdges ?? 0;
      case 'FACE': return this.mesh?.numFaces ?? 0;
      case 'CORNER': return this.mesh?.numCorners ?? 0;
      case 'CURVE': return this.curves?.numCurves ?? 0;
      case 'INSTANCE': return this.instances?.numInstances ?? 0;
      case 'LAYER': return 0;
    }
  }

  /** All attribute maps the geometry contains, keyed by component. */
  *allAttributes(): Generator<Attribute> {
    if (this.mesh) for (const a of this.mesh.attributes.values()) yield a;
    if (this.curves) for (const a of this.curves.attributes.values()) yield a;
    if (this.points) for (const a of this.points.attributes.values()) yield a;
    if (this.instances) for (const a of this.instances.attributes.values()) yield a;
  }

  /** Find an attribute by name in any component. */
  findAttribute(name: string): Attribute | undefined {
    return (
      this.mesh?.attributes.get(name) ??
      this.curves?.attributes.get(name) ??
      this.points?.attributes.get(name) ??
      this.instances?.attributes.get(name)
    );
  }

  /** Returns the attributes map for the given domain, or undefined. */
  attributesForDomain(domain: AttributeDomain): Map<string, Attribute> | undefined {
    if (domain === 'POINT' && this.mesh) return this.mesh.attributes;
    if (domain === 'POINT' && this.curves) return this.curves.attributes;
    if (domain === 'POINT' && this.points) return this.points.attributes;
    if (domain === 'EDGE' || domain === 'FACE' || domain === 'CORNER') return this.mesh?.attributes;
    if (domain === 'CURVE') return this.curves?.attributes;
    if (domain === 'INSTANCE') return this.instances?.attributes;
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  Primitive builders                                                */
/* ------------------------------------------------------------------ */

export function buildCube(size: Vec3, position: Vec3 = [0, 0, 0]): Geometry {
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const [x, y, z] = position;
  const v = new Float32Array([
    x - sx, y - sy, z - sz,   x + sx, y - sy, z - sz,
    x + sx, y + sy, z - sz,   x - sx, y + sy, z - sz,
    x - sx, y - sy, z + sz,   x + sx, y - sy, z + sz,
    x + sx, y + sy, z + sz,   x - sx, y + sy, z + sz,
  ]);
  const t = new Uint32Array([
    0, 2, 1,  0, 3, 2,
    4, 5, 6,  4, 6, 7,
    0, 1, 5,  0, 5, 4,
    2, 3, 7,  2, 7, 6,
    1, 2, 6,  1, 6, 5,
    0, 4, 7,  0, 7, 3,
  ]);
  const g = new Geometry();
  g.mesh = new MeshComponent(v, t);
  return g;
}

export function buildUVSphere(radius: number, rings = 16, segments = 24): Geometry {
  const verts: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * 2 * Math.PI;
      verts.push(radius * sinT * Math.cos(phi), radius * cosT, radius * sinT * Math.sin(phi));
    }
  }
  const tris: number[] = [];
  const cols = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * cols + s;
      const b = a + cols;
      tris.push(a, b, a + 1);
      tris.push(b, b + 1, a + 1);
    }
  }
  const g = new Geometry();
  g.mesh = new MeshComponent(new Float32Array(verts), new Uint32Array(tris));
  return g;
}

export function buildIcosphere(radius: number, subdivisions = 1): Geometry {
  const t = (1 + Math.sqrt(5)) / 2;
  let positions: number[] = [
    -1,  t,  0,   1,  t,  0,  -1, -t,  0,   1, -t,  0,
     0, -1,  t,   0,  1,  t,   0, -1, -t,   0,  1, -t,
     t,  0, -1,   t,  0,  1,  -t,  0, -1,  -t,  0,  1,
  ];
  let tris: number[] = [
    0, 11, 5,  0, 5, 1,  0, 1, 7,  0, 7, 10,  0, 10, 11,
    1, 5, 9,  5, 11, 4,  11, 10, 2,  10, 7, 6,  7, 1, 8,
    3, 9, 4,  3, 4, 2,  3, 2, 6,  3, 6, 8,  3, 8, 9,
    4, 9, 5,  2, 4, 11,  6, 2, 10,  8, 6, 7,  9, 8, 1,
  ];
  for (let s = 0; s < subdivisions; s++) {
    const next: number[] = [];
    const midCache = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
      const bx = positions[b * 3]!, by = positions[b * 3 + 1]!, bz = positions[b * 3 + 2]!;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const idx = positions.length / 3;
      positions.push(mx, my, mz);
      midCache.set(key, idx);
      return idx;
    };
    for (let i = 0; i < tris.length; i += 3) {
      const v1 = tris[i]!, v2 = tris[i + 1]!, v3 = tris[i + 2]!;
      const a = mid(v1, v2), b = mid(v2, v3), c = mid(v3, v1);
      next.push(v1, a, c,  v2, b, a,  v3, c, b,  a, b, c);
    }
    tris = next;
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    const inv = radius / Math.hypot(x, y, z);
    out[i] = x * inv; out[i + 1] = y * inv; out[i + 2] = z * inv;
  }
  const g = new Geometry();
  g.mesh = new MeshComponent(out, new Uint32Array(tris));
  return g;
}

export function buildCylinder(radius: number, depth: number, segments = 32, cap = true): Geometry {
  const verts: number[] = [];
  const tris: number[] = [];
  const h = depth / 2;
  // Side rings
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * 2 * Math.PI;
    const cx = Math.cos(a) * radius, cz = Math.sin(a) * radius;
    verts.push(cx, -h, cz);
    verts.push(cx,  h, cz);
  }
  const stride = 2;
  for (let s = 0; s < segments; s++) {
    const i = s * stride;
    tris.push(i, i + 1, i + stride);
    tris.push(i + 1, i + stride + 1, i + stride);
  }
  if (cap) {
    const baseBot = verts.length / 3;
    verts.push(0, -h, 0);
    const topBot = baseBot + 1;
    verts.push(0,  h, 0);
    for (let s = 0; s < segments; s++) {
      tris.push(baseBot, s * stride + stride, s * stride);
      tris.push(topBot,  s * stride + 1, s * stride + stride + 1);
    }
  }
  const g = new Geometry();
  g.mesh = new MeshComponent(new Float32Array(verts), new Uint32Array(tris));
  return g;
}

export function buildCone(radiusBottom: number, radiusTop: number, depth: number, segments = 32, cap = true): Geometry {
  const verts: number[] = [];
  const tris: number[] = [];
  const h = depth / 2;
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * 2 * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    verts.push(ca * radiusBottom, -h, sa * radiusBottom);
    verts.push(ca * radiusTop,    h, sa * radiusTop);
  }
  const stride = 2;
  for (let s = 0; s < segments; s++) {
    const i = s * stride;
    if (radiusTop > 1e-6) {
      tris.push(i, i + 1, i + stride);
      tris.push(i + 1, i + stride + 1, i + stride);
    } else {
      tris.push(i, i + 1, i + stride);
    }
  }
  if (cap) {
    const baseBot = verts.length / 3;
    verts.push(0, -h, 0);
    for (let s = 0; s < segments; s++) {
      tris.push(baseBot, s * stride + stride, s * stride);
    }
    if (radiusTop > 1e-6) {
      const topBot = verts.length / 3;
      verts.push(0, h, 0);
      for (let s = 0; s < segments; s++) {
        tris.push(topBot, s * stride + 1, s * stride + stride + 1);
      }
    }
  }
  const g = new Geometry();
  g.mesh = new MeshComponent(new Float32Array(verts), new Uint32Array(tris));
  return g;
}

export function buildGrid(sizeX: number, sizeY: number, vx: number, vy: number): Geometry {
  vx = Math.max(2, vx); vy = Math.max(2, vy);
  const verts: number[] = [];
  for (let j = 0; j < vy; j++) {
    const y = (j / (vy - 1) - 0.5) * sizeY;
    for (let i = 0; i < vx; i++) {
      const x = (i / (vx - 1) - 0.5) * sizeX;
      verts.push(x, 0, y);
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < vy - 1; j++) {
    for (let i = 0; i < vx - 1; i++) {
      const a = j * vx + i;
      const b = a + 1;
      const c = a + vx;
      const d = c + 1;
      tris.push(a, c, b);
      tris.push(b, c, d);
    }
  }
  const g = new Geometry();
  g.mesh = new MeshComponent(new Float32Array(verts), new Uint32Array(tris));
  return g;
}

export function buildMeshLine(count: number, start: Vec3, end: Vec3): Geometry {
  count = Math.max(2, count);
  const verts = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    verts[i * 3]     = start[0] + (end[0] - start[0]) * t;
    verts[i * 3 + 1] = start[1] + (end[1] - start[1]) * t;
    verts[i * 3 + 2] = start[2] + (end[2] - start[2]) * t;
  }
  // No faces — a polyline of disconnected vertices.
  // Blender's Mesh Line outputs vertices only; downstream nodes (e.g. Mesh to Curve)
  // turn them into curves. We keep an empty triangle list.
  const g = new Geometry();
  g.mesh = new MeshComponent(verts, new Uint32Array());
  return g;
}

export function buildMeshCircle(vertices: number, radius: number, fillType: 'NONE' | 'NGON' | 'TRIANGLE_FAN' = 'NONE'): Geometry {
  vertices = Math.max(3, vertices);
  const verts: number[] = [];
  for (let i = 0; i < vertices; i++) {
    const a = (i / vertices) * 2 * Math.PI;
    verts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const tris: number[] = [];
  if (fillType === 'TRIANGLE_FAN' || fillType === 'NGON') {
    const center = verts.length / 3;
    verts.push(0, 0, 0);
    for (let i = 0; i < vertices; i++) {
      tris.push(center, i, (i + 1) % vertices);
    }
  }
  const g = new Geometry();
  g.mesh = new MeshComponent(new Float32Array(verts), new Uint32Array(tris));
  return g;
}

/* ------------------------------------------------------------------ */
/*  Curve primitives                                                  */
/* ------------------------------------------------------------------ */

export function buildCurveLine(start: Vec3, end: Vec3, resolution = 12): Geometry {
  const positions = new Float32Array([
    start[0], start[1], start[2],
    end[0], end[1], end[2],
  ]);
  const offsets = new Uint32Array([0, 2]);
  const cyclic = new Uint8Array([0]);
  const res = new Uint16Array([resolution]);
  const g = new Geometry();
  g.curves = new CurvesComponent(positions, offsets, cyclic, res);
  return g;
}

export function buildCurveCircle(radius: number, resolution = 32): Geometry {
  const positions = new Float32Array(resolution * 3);
  for (let i = 0; i < resolution; i++) {
    const a = (i / resolution) * 2 * Math.PI;
    positions[i * 3]     = Math.cos(a) * radius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(a) * radius;
  }
  const offsets = new Uint32Array([0, resolution]);
  const cyclic = new Uint8Array([1]);
  const res = new Uint16Array([resolution]);
  const g = new Geometry();
  g.curves = new CurvesComponent(positions, offsets, cyclic, res);
  return g;
}

export function buildCurveSpiral(rotations = 2, startRadius = 1, endRadius = 2, height = 2, resolution = 32): Geometry {
  const n = Math.max(2, Math.floor(rotations * resolution));
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = t * rotations * 2 * Math.PI;
    const r = startRadius + (endRadius - startRadius) * t;
    positions[i * 3]     = Math.cos(a) * r;
    positions[i * 3 + 1] = t * height - height / 2;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const offsets = new Uint32Array([0, n]);
  const cyclic = new Uint8Array([0]);
  const res = new Uint16Array([resolution]);
  const g = new Geometry();
  g.curves = new CurvesComponent(positions, offsets, cyclic, res);
  return g;
}

export function buildBezierSegment(
  start: Vec3, startHandle: Vec3, endHandle: Vec3, end: Vec3, resolution = 16,
): Geometry {
  const n = resolution + 1;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = 1 - t;
    const c0 = u * u * u;
    const c1 = 3 * u * u * t;
    const c2 = 3 * u * t * t;
    const c3 = t * t * t;
    positions[i * 3]     = c0 * start[0] + c1 * startHandle[0] + c2 * endHandle[0] + c3 * end[0];
    positions[i * 3 + 1] = c0 * start[1] + c1 * startHandle[1] + c2 * endHandle[1] + c3 * end[1];
    positions[i * 3 + 2] = c0 * start[2] + c1 * startHandle[2] + c2 * endHandle[2] + c3 * end[2];
  }
  const offsets = new Uint32Array([0, n]);
  const g = new Geometry();
  g.curves = new CurvesComponent(positions, offsets, new Uint8Array([0]), new Uint16Array([resolution]));
  return g;
}
