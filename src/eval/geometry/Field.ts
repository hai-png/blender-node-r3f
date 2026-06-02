/**
 * Field system — the heart of Blender's Geometry Nodes evaluator.
 *
 * A `Field<T>` is a lazy, context-bound function that produces N values
 * (one per element) when materialised against a `FieldContext`. Fields are
 * cheap to create and compose: they only do work when a data-flow node
 * decides to materialise them.
 *
 * Field algebra
 * -------------
 *   const idx       = indexField();
 *   const pos       = positionField();
 *   const offsetX   = mapField(pos, (v) => v[0]);                  // Field<number>
 *   const stripe    = mapField(idx, (i) => (i % 2 === 0 ? 1 : 0)); // Field<number>
 *
 *   // Set Position consumer:
 *   const ctx = { geometry, domain: 'POINT', size: geometry.domainSize('POINT') };
 *   const xs = offsetX.eval(ctx);    // Float32Array(numVerts)
 *
 * Capture Attribute writes the materialised array as a named anonymous
 * attribute on the carried geometry, so downstream `anonField(id)` reads
 * the *captured* values even if a later Set Position changes position.
 */
import type { AttributeDomain } from '../../core/types';
import type { Geometry, Attribute, ScalarTypedArray } from './Geometry';

export type FieldKind = 'FLOAT' | 'INT' | 'BOOL' | 'VECTOR' | 'COLOR';

export interface FieldContext {
  geometry: Geometry;
  domain: AttributeDomain;
  /** Cached size for the domain (== geometry.domainSize(domain)). */
  size: number;
}

/**
 * Output buffer convention:
 *   FLOAT/INT/BOOL → length = size
 *   VECTOR         → length = size * 3
 *   COLOR          → length = size * 4
 */
export interface Field<_T = unknown> {
  kind: FieldKind;
  eval(ctx: FieldContext): ScalarTypedArray;
  /** Hint: always returns one logical value regardless of context. */
  isSingle?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function dimsOf(kind: FieldKind): 1 | 3 | 4 {
  return kind === 'VECTOR' ? 3 : kind === 'COLOR' ? 4 : 1;
}

function allocFor(kind: FieldKind, size: number): ScalarTypedArray {
  if (kind === 'INT') return new Int32Array(size);
  if (kind === 'BOOL') return new Uint8Array(size);
  return new Float32Array(size * dimsOf(kind));
}

/* ------------------------------------------------------------------ */
/*  Constant field                                                     */
/* ------------------------------------------------------------------ */

export function constField(value: number | boolean | readonly number[], kind: FieldKind): Field {
  const dims = dimsOf(kind);
  const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  return {
    kind,
    isSingle: true,
    eval(ctx) {
      const out = allocFor(kind, ctx.size);
      if (typeof v === 'number') {
        if (kind === 'BOOL') {
          (out as Uint8Array).fill(v ? 1 : 0);
        } else if (kind === 'INT') {
          (out as Int32Array).fill(v | 0);
        } else {
          (out as Float32Array).fill(v);
        }
      } else {
        const arr = v as readonly number[];
        const f = out as Float32Array;
        for (let i = 0; i < ctx.size; i++) {
          for (let k = 0; k < dims; k++) f[i * dims + k] = arr[k] ?? 0;
        }
      }
      return out;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Attribute fields                                                   */
/* ------------------------------------------------------------------ */

/**
 * Read a named attribute from the consumer's geometry, interpolating
 * between domains when needed. If absent, returns zeros.
 */
export function attributeField(name: string, kind: FieldKind): Field {
  return {
    kind,
    eval(ctx) {
      const attr = ctx.geometry.findAttribute(name);
      if (!attr) return allocFor(kind, ctx.size);
      return interpolateAttribute(attr, ctx.geometry, ctx.domain, ctx.size, kind);
    },
  };
}

export function positionField(): Field {
  return attributeField('position', 'VECTOR');
}

export function radiusField(): Field {
  return attributeField('radius', 'FLOAT');
}

export function idField(): Field {
  return {
    kind: 'INT',
    eval(ctx) {
      const attr = ctx.geometry.findAttribute('id');
      if (attr) return interpolateAttribute(attr, ctx.geometry, ctx.domain, ctx.size, 'INT');
      // default to index when no `id` attribute exists
      return indexField().eval(ctx);
    },
  };
}

export function indexField(): Field {
  return {
    kind: 'INT',
    eval(ctx) {
      const out = new Int32Array(ctx.size);
      for (let i = 0; i < ctx.size; i++) out[i] = i;
      return out;
    },
  };
}

/** Mesh normals (point or face). */
export function normalField(): Field {
  return {
    kind: 'VECTOR',
    eval(ctx) {
      const mesh = ctx.geometry.mesh;
      if (!mesh) return new Float32Array(ctx.size * 3);
      if (ctx.domain === 'FACE') {
        const fn = mesh.faceNormals();
        if (fn.length === ctx.size * 3) return fn;
        // crop/extend to size
        const out = new Float32Array(ctx.size * 3);
        out.set(fn.subarray(0, Math.min(fn.length, out.length)));
        return out;
      }
      // POINT and other domains — average from face normals into point normals
      const pn = mesh.pointNormals();
      if (ctx.domain === 'POINT') {
        return pn.length === ctx.size * 3 ? pn : new Float32Array(ctx.size * 3);
      }
      // CORNER, EDGE → expand point normals (rough approximation)
      const out = new Float32Array(ctx.size * 3);
      for (let i = 0; i < ctx.size; i++) {
        const j = (i * 3) % pn.length;
        out[i * 3]     = pn[j]     ?? 0;
        out[i * 3 + 1] = pn[j + 1] ?? 0;
        out[i * 3 + 2] = pn[j + 2] ?? 0;
      }
      return out;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Domain interpolation                                              */
/* ------------------------------------------------------------------ */

export function interpolateAttribute(
  attr: Attribute,
  geometry: Geometry,
  targetDomain: AttributeDomain,
  size: number,
  outKind: FieldKind,
): ScalarTypedArray {
  const dims = attr.dimensions;
  // No interpolation needed
  if (attr.domain === targetDomain) {
    return convertKind(attr.data, dims, outKind, size);
  }
  const mesh = geometry.mesh;
  const curves = geometry.curves;

  if (mesh) {
    if (attr.domain === 'FACE' && targetDomain === 'POINT') {
      // Average all face values incident to each vertex.
      const out = new Float32Array(size * dims);
      const counts = new Uint32Array(size);
      const t = mesh.triangles;
      for (let i = 0; i < mesh.numTris; i++) {
        for (let k = 0; k < 3; k++) {
          const v = t[i * 3 + k]!;
          if (v >= size) continue;
          for (let d = 0; d < dims; d++) {
            const idx = v * dims + d;
            out[idx] = (out[idx] ?? 0) + readScalar(attr.data, i * dims + d);
          }
          counts[v] = (counts[v] ?? 0) + 1;
        }
      }
      for (let v = 0; v < size; v++) {
        const c = (counts[v] ?? 0) || 1;
        for (let d = 0; d < dims; d++) {
          const idx = v * dims + d;
          out[idx] = (out[idx] ?? 0) / c;
        }
      }
      return convertKind(out, dims, outKind, size);
    }
    if (attr.domain === 'POINT' && targetDomain === 'FACE') {
      // Average the three vertex values of each triangle.
      const out = new Float32Array(size * dims);
      const t = mesh.triangles;
      for (let i = 0; i < size; i++) {
        for (let d = 0; d < dims; d++) {
          const sum =
            readScalar(attr.data, t[i * 3]! * dims + d) +
            readScalar(attr.data, t[i * 3 + 1]! * dims + d) +
            readScalar(attr.data, t[i * 3 + 2]! * dims + d);
          out[i * dims + d] = sum / 3;
        }
      }
      return convertKind(out, dims, outKind, size);
    }
    if (attr.domain === 'POINT' && targetDomain === 'CORNER') {
      const out = new Float32Array(size * dims);
      const t = mesh.triangles;
      for (let i = 0; i < size; i++) {
        const v = t[i] ?? 0;
        for (let d = 0; d < dims; d++) out[i * dims + d] = readScalar(attr.data, v * dims + d);
      }
      return convertKind(out, dims, outKind, size);
    }
    if (attr.domain === 'FACE' && targetDomain === 'CORNER') {
      const out = new Float32Array(size * dims);
      for (let i = 0; i < mesh.numTris; i++) {
        for (let corner = 0; corner < 3; corner++) {
          const base = (i * 3 + corner) * dims;
          for (let d = 0; d < dims; d++) out[base + d] = readScalar(attr.data, i * dims + d);
        }
      }
      return convertKind(out, dims, outKind, size);
    }
    if (attr.domain === 'CORNER' && targetDomain === 'POINT') {
      const out = new Float32Array(size * dims);
      const counts = new Uint32Array(size);
      const t = mesh.triangles;
      for (let i = 0; i < mesh.numCorners; i++) {
        const v = t[i] ?? 0;
        if (v >= size) continue;
        for (let d = 0; d < dims; d++) out[(v * dims + d)]! += readScalar(attr.data, i * dims + d);
        counts[v] = (counts[v] ?? 0) + 1;
      }
      for (let v = 0; v < size; v++) {
        const c = counts[v] || 1;
        for (let d = 0; d < dims; d++) out[(v * dims + d)]! /= c;
      }
      return convertKind(out, dims, outKind, size);
    }
    if (attr.domain === 'CORNER' && targetDomain === 'FACE') {
      const out = new Float32Array(size * dims);
      for (let i = 0; i < size; i++) {
        for (let d = 0; d < dims; d++) {
          const base = i * 3 * dims + d;
          out[i * dims + d] = (
            readScalar(attr.data, base) +
            readScalar(attr.data, base + dims) +
            readScalar(attr.data, base + dims * 2)
          ) / 3;
        }
      }
      return convertKind(out, dims, outKind, size);
    }
  }

  if (curves) {
    if (attr.domain === 'CURVE' && targetDomain === 'POINT') {
      const out = new Float32Array(size * dims);
      for (let ci = 0; ci < curves.numCurves; ci++) {
        const start = curves.curveOffsets[ci] ?? 0;
        const end = curves.curveOffsets[ci + 1] ?? start;
        for (let i = start; i < end; i++) {
          for (let d = 0; d < dims; d++) out[i * dims + d] = readScalar(attr.data, ci * dims + d);
        }
      }
      return convertKind(out, dims, outKind, size);
    }
    if (attr.domain === 'POINT' && targetDomain === 'CURVE') {
      const out = new Float32Array(size * dims);
      for (let ci = 0; ci < curves.numCurves; ci++) {
        const start = curves.curveOffsets[ci] ?? 0;
        const end = curves.curveOffsets[ci + 1] ?? start;
        const count = Math.max(1, end - start);
        for (let d = 0; d < dims; d++) {
          let sum = 0;
          for (let i = start; i < end; i++) sum += readScalar(attr.data, i * dims + d);
          out[ci * dims + d] = sum / count;
        }
      }
      return convertKind(out, dims, outKind, size);
    }
  }

  // Fallback: re-broadcast first N values.
  const out = allocFor(outKind, size);
  const minLen = Math.min(out.length, attr.data.length);
  out.set(attr.data.subarray(0, minLen) as ScalarTypedArray);
  return out;
}

function readScalar(arr: ScalarTypedArray, i: number): number {
  if (i < 0 || i >= arr.length) return 0;
  return arr[i] as number;
}

function convertKind(
  src: ScalarTypedArray,
  srcDims: 1 | 2 | 3 | 4,
  outKind: FieldKind,
  size: number,
): ScalarTypedArray {
  const outDims = dimsOf(outKind);
  if (outKind === 'INT' && !(src instanceof Int32Array)) {
    const out = new Int32Array(size);
    for (let i = 0; i < size; i++) out[i] = (src[i * srcDims] as number) | 0;
    return out;
  }
  if (outKind === 'BOOL' && !(src instanceof Uint8Array)) {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) out[i] = (src[i * srcDims] as number) ? 1 : 0;
    return out;
  }
  if (srcDims === outDims && src instanceof Float32Array && src.length >= size * outDims) {
    return src;
  }
  const out = new Float32Array(size * outDims);
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < outDims; k++) {
      const j = i * srcDims + Math.min(k, srcDims - 1);
      out[i * outDims + k] = (src[j] as number) ?? 0;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Anonymous attributes (Capture Attribute)                          */
/* ------------------------------------------------------------------ */

let _anonCounter = 0;
export function nextAnonymousId(): string {
  return `__anon_${(++_anonCounter).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Field that reads a previously-captured anonymous attribute by id. If the
 * attribute isn't present on the consumer's geometry (e.g. it was created
 * downstream of where the field is now being used), `fallback` is returned.
 */
export function anonField(id: string, kind: FieldKind, fallback?: Field): Field {
  return {
    kind,
    eval(ctx) {
      const attr = ctx.geometry.findAttribute(id);
      if (attr) return interpolateAttribute(attr, ctx.geometry, ctx.domain, ctx.size, kind);
      return fallback ? fallback.eval(ctx) : allocFor(kind, ctx.size);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Combinators                                                       */
/* ------------------------------------------------------------------ */

export function mapField<T = number>(input: Field, outKind: FieldKind, fn: (a: T, i: number) => number | number[] | boolean): Field {
  return {
    kind: outKind,
    eval(ctx) {
      const a = input.eval(ctx);
      const dimsIn = input.kind === 'VECTOR' ? 3 : input.kind === 'COLOR' ? 4 : 1;
      const dimsOut = dimsOf(outKind);
      const out = allocFor(outKind, ctx.size);
      for (let i = 0; i < ctx.size; i++) {
        const inVal: unknown =
          dimsIn === 1 ? (a[i] as number) :
          dimsIn === 3 ? [a[i * 3] as number, a[i * 3 + 1] as number, a[i * 3 + 2] as number] :
          [a[i * 4] as number, a[i * 4 + 1] as number, a[i * 4 + 2] as number, a[i * 4 + 3] as number];
        const r = fn(inVal as T, i);
        writeOut(out, i, dimsOut, r, outKind);
      }
      return out;
    },
  };
}

export function zipField(inputs: Field[], outKind: FieldKind, fn: (vals: unknown[], i: number) => number | number[] | boolean): Field {
  return {
    kind: outKind,
    eval(ctx) {
      const arrs = inputs.map((f) => f.eval(ctx));
      const dimsIns = inputs.map((f) => f.kind === 'VECTOR' ? 3 : f.kind === 'COLOR' ? 4 : 1);
      const dimsOut = dimsOf(outKind);
      const out = allocFor(outKind, ctx.size);
      const vals: unknown[] = new Array(inputs.length);
      for (let i = 0; i < ctx.size; i++) {
        for (let k = 0; k < inputs.length; k++) {
          const d = dimsIns[k]!;
          const a = arrs[k]!;
          vals[k] = d === 1 ? (a[i] as number)
            : d === 3 ? [a[i * 3] as number, a[i * 3 + 1] as number, a[i * 3 + 2] as number]
            : [a[i * 4] as number, a[i * 4 + 1] as number, a[i * 4 + 2] as number, a[i * 4 + 3] as number];
        }
        writeOut(out, i, dimsOut, fn(vals, i), outKind);
      }
      return out;
    },
  };
}

function writeOut(
  out: ScalarTypedArray, i: number, dimsOut: number,
  r: number | number[] | boolean, kind: FieldKind,
): void {
  if (typeof r === 'boolean') {
    (out as Uint8Array)[i] = r ? 1 : 0;
    return;
  }
  if (typeof r === 'number') {
    if (kind === 'INT') (out as Int32Array)[i] = r | 0;
    else if (kind === 'BOOL') (out as Uint8Array)[i] = r ? 1 : 0;
    else {
      const f = out as Float32Array;
      for (let k = 0; k < dimsOut; k++) f[i * dimsOut + k] = r;
    }
    return;
  }
  const f = out as Float32Array;
  for (let k = 0; k < dimsOut; k++) f[i * dimsOut + k] = r[k] ?? 0;
}

/* ------------------------------------------------------------------ */
/*  Materialisation helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * Convert a "field or single value" socket payload into a Field. Used by
 * the evaluator when a non-field value (number, vec3, color) flows into a
 * field-typed socket (Blender's implicit lift).
 */
export function liftToField(value: unknown, hintKind: FieldKind = 'FLOAT'): Field {
  if (value && typeof value === 'object' && 'kind' in value && typeof (value as Field).eval === 'function') {
    return value as Field;
  }
  if (typeof value === 'number') return constField(value, hintKind);
  if (typeof value === 'boolean') return constField(value, 'BOOL');
  if (Array.isArray(value)) {
    if (value.length === 4) return constField(value as number[], 'COLOR');
    return constField(value as number[], 'VECTOR');
  }
  if (value && typeof value === 'object' && 'euler' in (value as object) && Array.isArray((value as { euler?: unknown }).euler)) {
    return constField([...(value as { euler: number[] }).euler], 'VECTOR');
  }
  return constField(0, hintKind);
}

/** Returns true if `value` is a Field instance. */
export function isField(value: unknown): value is Field {
  return !!value
    && typeof value === 'object'
    && 'kind' in (value as object)
    && typeof (value as Field).eval === 'function';
}
