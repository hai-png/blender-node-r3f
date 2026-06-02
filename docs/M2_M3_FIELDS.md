# M2 / M3 — Geometry field system

> Implementation notes for the Geometry Nodes evaluator.

## 1. Why fields?

Blender Geometry Nodes split nodes into two categories:

- **Data-flow nodes** (round sockets) — carry geometry through the graph and *materialise* field values when needed. Examples: `Set Position`, `Transform Geometry`, `Capture Attribute`, `Distribute Points on Faces`, `Instance on Points`, `Mesh Boolean`.
- **Field nodes** (diamond sockets) — describe a **computation per element**, not a value. They are evaluated in the context of a data-flow consumer with that consumer's geometry + domain. Examples: `Position`, `Normal`, `Index`, `Math`, `Random Value`, `Compare`, `Combine XYZ`.

A "field" is conceptually:

```ts
Field<T> = (ctx: { geometry, domain, indices }) => T[]   // one value per element
```

Subtleties drawn directly from the Blender manual & community Q&A:

1. **Re-evaluation across siblings.** The same field subgraph wired into two Set Position nodes is evaluated **twice**, once per consumer, using *that consumer's current geometry* — so `Position` returns different values after a previous Set Position changed positions.
2. **Capture Attribute freezes** a field into an **anonymous attribute** on the *captured* geometry, so downstream reads see the captured value even after later modifications.
3. **Field nodes do nothing on their own.** A `Position` node connected to a Group Output that exposes a Vector socket produces a zero (Blender prints "Unknown socket value" because there was no consumer providing context).
4. **Domain interpolation.** Reading a face attribute on the point domain auto-averages across the connected faces, etc. We mirror this with explicit `interpolate(attr, fromDomain, toDomain)`.
5. **Selection** is itself a field of booleans, evaluated on the consumer's domain. When False, the data-flow node leaves the element unchanged.

## 2. Runtime model

```ts
// src/eval/geometry/Field.ts

export type FieldKind = 'FLOAT' | 'INT' | 'BOOL' | 'VECTOR' | 'COLOR';

export interface FieldContext {
  geometry: Geometry;
  domain: AttributeDomain;     // POINT / EDGE / FACE / CORNER / CURVE / INSTANCE
  /** Length of the slice we're materialising — usually domainSize(geometry, domain). */
  size: number;
}

export interface Field<T = unknown> {
  kind: FieldKind;
  /** Materialise the field over the consumer's domain. */
  eval(ctx: FieldContext): TypedArrayOf<T>;
  /** True if the field will always return one value regardless of context. */
  isSingle?: boolean;
  /** Symbolic anonymous-attribute id (used by Capture Attribute). */
  anonymousId?: string;
}
```

### Constructors

| Helper | Returns | Notes |
|---|---|---|
| `constField(v, kind)` | `Field<T>` | `isSingle = true`; ignores ctx. |
| `attributeField(name, kind)` | `Field<T>` | Reads named attribute; auto-interpolates between domains. |
| `positionField()` | `Field<Vector>` | Reads `position` attribute. |
| `indexField()` | `Field<number>` | Materialises `[0, 1, ..., n-1]`. |
| `normalField()` | `Field<Vector>` | Reads/computes normals at the consumer's domain. |
| `mapField(f, fn)` | `Field<U>` | Maps a field element-wise. |
| `zipField([fa, fb, …], fn)` | `Field<U>` | Combines N fields element-wise. |
| `anonField(id, kind, fallback)` | `Field<T>` | Reads an anonymous attribute by id; falls back if missing. |

Anonymous attributes are the mechanism behind Capture Attribute. They're stored on the **Geometry's mesh component** in the `attributes` map under a key like `__anon_xxxxxxxx`.

## 3. Geometry container (expanded for M2/M3)

Adds curves, points, and attribute helpers to the M0 container:

```ts
class MeshComponent {
  positions: Float32Array;
  triangles: Uint32Array;
  attributes: Map<string, Attribute>;   // any domain
  // Cached lazily:
  _normalsPoint?: Float32Array;
  _normalsFace?: Float32Array;
  _faceAreas?: Float32Array;
}

class CurvesComponent {
  positions: Float32Array;        // size = numPoints * 3
  curveOffsets: Uint32Array;      // size = numCurves + 1   (CSR-style)
  cyclic: Uint8Array;
  resolution: Uint16Array;
  attributes: Map<string, Attribute>;
}

class PointCloudComponent {
  positions: Float32Array;
  radii: Float32Array;
  attributes: Map<string, Attribute>;
}

class InstancesComponent {
  sources: Geometry[];
  items: { source: number; transform: Float32Array }[];
  attributes: Map<string, Attribute>;   // per-instance attrs (e.g. id, random)
}
```

`Geometry.domainSize(domain)` returns the right length for each kind.

## 4. Node split

Every geometry node either:

- **Materializes** (data-flow): receives Geometry + maybe Fields as inputs, mutates/returns a new Geometry. Implemented via `execute(inputs)`.
- **Produces a field** (field node): receives Field inputs, returns Field outputs. Implemented via `field(inputs)`.

We tag node classes with `static node_kind: 'DATA' | 'FIELD'` so the evaluator dispatches correctly. The evaluator resolves field-typed sockets to `Field<T>` values (never concrete arrays) until a data-flow consumer materialises them.

## 5. M2 deliverables

- **Field system**: `Field.ts` with constructors + interpolation
- **Geometry container**: Mesh + Curves + PointCloud + Instances + attribute spans
- **Primitives**: Cube, UV Sphere, Ico Sphere (M0), Cylinder, Cone, Grid, Mesh Line, Mesh Circle
- **Field input nodes**: Position, Normal, Index, ID, Named Attribute, Radius
- **Data-flow ops**: Set Position, Transform Geometry, Join Geometry, Realize Instances, Bounding Box, Convex Hull (M3), Merge by Distance (M3)
- **Selection**: every set/sample node accepts a boolean `Selection` field
- **GeometryEvaluator**: dispatches per `node_kind`

## 6. M3 deliverables

- **Curve primitives**: Curve Line, Curve Circle, Bezier Segment, Quadratic Bezier, Star, Arc, Spiral, Quadrilateral
- **Curve ops**: Curve to Mesh, Curve to Points, Resample Curve, Reverse Curve, Trim Curve, Fill Curve
- **Mesh ops**: Subdivision Surface (Loop), Extrude Mesh, Mesh Boolean (CSG via three-bvh-csg or naive), Mesh to Points, Mesh to Curve
- **Points / Instances**: Distribute Points on Faces (Random + Poisson disk), Instance on Points, Translate/Rotate/Scale Instances, Realize Instances, Points to Vertices
- **Capture pattern**: Capture Attribute, Store Named Attribute, Remove Named Attribute, Named Attribute (read)
- **Sampling**: Sample Index, Sample Nearest, Sample Nearest Surface, Geometry Proximity, Raycast

For M2/M3 we ship a meaningful subset of every category; complete coverage continues into later milestones.
