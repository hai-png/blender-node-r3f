/**
 * GeometryEvaluator — Blender Geometry Nodes runtime.
 *
 * Dispatches by node `node_kind`:
 *   - 'FIELD' nodes produce Field<T> values (lazy, context-bound)
 *   - 'DATA' nodes consume Geometry + Fields and produce a new Geometry
 *
 * When a downstream node reads a field-typed input socket, the evaluator
 * returns either a stored Field<T> (if the upstream produced one) or
 * `liftToField(value)` to wrap a concrete value as a constant field.
 *
 * Materialisation happens inside each data-flow node's handler: it asks
 * the field for `field.eval({ geometry, domain, size })`.
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';
import type { SystemEvaluator, EvaluationResult } from './Depsgraph';
import type { AttributeDomain, Vec3 } from '../core/types';

import {
  Geometry, MeshComponent,
  buildCube, buildUVSphere, buildIcosphere, buildCylinder, buildCone,
  buildGrid, buildMeshLine, buildMeshCircle,
  buildCurveLine, buildCurveCircle, buildCurveSpiral, buildBezierSegment,
} from './geometry/Geometry';
import {
  Field, FieldContext, FieldKind,
  attributeField, constField, indexField, idField, normalField, positionField,
  radiusField, anonField, nextAnonymousId, liftToField, isField, mapField, zipField,
} from './geometry/Field';
import {
  transformGeometry, joinGeometries, setPosition, storeAttributeOn, boundingBox,
  mergeByDistance, subdivisionSurface, meshToPoints, pointsToVertices,
  distributePointsOnFaces, instanceOnPoints, realizeInstances,
  curveToMesh, curveToPoints, resampleCurve, reverseCurve,
  sampleNearestIndex, geometryProximity,
  composeMat4, mat4Mul, flipFaces,
} from './geometry/MeshOps';

import { ValueNode, VectorNode, RGBNode } from '../nodes/common/Value';
import { MathNode } from '../nodes/common/Math';
import { VectorMathNode } from '../nodes/common/VectorMath';
import { MixNode } from '../nodes/common/MixColor';
import { MapRangeNode } from '../nodes/common/MapRange';
import { ClampNode } from '../nodes/common/Clamp';
import { ColorRampNode } from '../nodes/common/ColorRamp';
import {
  CombineXYZNode, SeparateXYZNode, CombineColorNode, SeparateColorNode,
} from '../nodes/common/CombineSeparate';
import { BooleanMathNode, CompareNode, RandomValueNode, SwitchNode } from '../nodes/common/Logic';
import { NodeGroupInput, NodeGroupOutput, RerouteNode } from '../nodes/common';
import { NodeGroupBase } from '../nodes/common/Group';

import {
  GeometryNodeInputPosition, GeometryNodeInputNormal, GeometryNodeInputIndex,
  GeometryNodeInputID, GeometryNodeInputRadius, GeometryNodeInputNamedAttribute,
} from '../nodes/geometry/FieldInputs';
import {
  GeometryNodeMeshCube, GeometryNodeMeshUVSphere, GeometryNodeMeshIcoSphere,
  GeometryNodeMeshCylinder, GeometryNodeMeshCone, GeometryNodeMeshGrid,
  GeometryNodeMeshLine, GeometryNodeMeshCircle,
  GeometryNodeTransform, GeometryNodeJoinGeometry,
} from '../nodes/geometry/Primitives';
import {
  GeometryNodeSetPosition, GeometryNodeCaptureAttribute, GeometryNodeStoreNamedAttribute,
  GeometryNodeRemoveAttribute, GeometryNodeBoundBox, GeometryNodeMergeByDistance,
  GeometryNodeSubdivisionSurface, GeometryNodeTriangulate, GeometryNodeDistributePointsOnFaces,
  GeometryNodeMeshToPoints, GeometryNodePointsToVertices,
  GeometryNodeInstanceOnPoints, GeometryNodeRealizeInstances,
  GeometryNodeTranslateInstances, GeometryNodeRotateInstances, GeometryNodeScaleInstances,
  GeometryNodeCurveToMesh, GeometryNodeCurveToPoints, GeometryNodeResampleCurve, GeometryNodeReverseCurve,
  GeometryNodeCurveLine, GeometryNodeCurveCircle, GeometryNodeCurveBezierSegment, GeometryNodeCurveSpiral,
  GeometryNodeSampleIndex, GeometryNodeSampleNearest, GeometryNodeProximity,
  GeometryNodeFlipFaces,
} from '../nodes/geometry/Ops';
import { GeoZoneInputBase, GeoZoneOutputBase } from '../nodes/geometry/Zones';
import {
  GeometryNodeAccumulateField, GeometryNodeFieldOnDomain, GeometryNodeFieldAtIndex,
  GeometryNodeAttributeDomainSize,
} from '../nodes/geometry/FieldUtils';
import { runZone, type ZoneEvalContext } from './zones/ZoneRunner';
import type { ZoneIterContext } from './zones/types';

type Cache = Map<string /* socket.id */, unknown>;

const fieldKindForSocket = (s: NodeSocket): FieldKind => {
  switch (s.kind) {
    case 'INT': return 'INT';
    case 'BOOLEAN': return 'BOOL';
    case 'VECTOR': return 'VECTOR';
    case 'RGBA': return 'COLOR';
    default: return 'FLOAT';
  }
};

export class GeometryEvaluator implements SystemEvaluator {
  evaluate(tree: NodeTree, _dirty: ReadonlySet<Node>): EvaluationResult {
    const start = performance.now();
    const timings = new Map<string, number>();
    const errors = new Map<string, string>();
    const cache: Cache = new Map();

    // ---- M4: pre-compute interior membership so the outer pass skips
    // ---- nodes that belong to a zone. They'll be re-run by the ZoneRunner
    // ---- when their Output node is reached.
    const interiorOf = new Map<Node /* interior node */, Node /* output node */>();
    const zoneOutputs: GeoZoneOutputBase[] = [];
    for (const n of tree.nodes) {
      if (!(n instanceof GeoZoneOutputBase)) continue;
      zoneOutputs.push(n);
      const input = n.findPair();
      if (!input) continue;
      const interior = this.collectInteriorForOuter(input, n, tree);
      for (const x of interior) interiorOf.set(x, n);
    }

    // Build the zone runner's context once.
    const zoneCtx: ZoneEvalContext = {
      tree,
      scene: tree.depsgraph.scene,
      simCache: tree.depsgraph.simCache,
      runOne: (node, c, iterCtx) => {
        try { this.executeNode(node, c, iterCtx); }
        catch (e) { errors.set(node.id, (e as Error).message); }
      },
      socketValue: (s, c) => this.socketValue(s, c),
      socketSingle: <T>(s: NodeSocket, c: Cache, dummy: Geometry) => this.socketSingle<T>(s, c, dummy),
    };

    const order = tree.topoOrder();
    const root =
      order.find((n) => n instanceof NodeGroupOutput) ??
      order[order.length - 1];

    for (const node of order) {
      // Skip interior nodes — the ZoneRunner runs them at the right time.
      if (interiorOf.has(node)) continue;
      // Skip ZONE_INPUT nodes from the outer pass — their outputs are set
      // by the ZoneRunner when the partner Output is reached. We still
      // pre-populate the Input meta sockets (Delta Time / Iteration / Index)
      // with defaults so any non-zone consumer sees something sensible.
      if (node instanceof GeoZoneInputBase) {
        // Seed metadata outputs only; state-item outputs are set by runZone.
        for (const out of node.outputs) {
          if (!cache.has(out.id)) cache.set(out.id, liftToField(out.default_value, fieldKindForSocket(out)));
        }
        continue;
      }
      if (node.mute) {
        this.passthroughMuted(node, cache);
        continue;
      }
      const t0 = performance.now();
      try {
        if (node instanceof GeoZoneOutputBase) {
          runZone(node, cache, zoneCtx);
        } else {
          this.executeNode(node, cache);
        }
      } catch (e) {
        errors.set(node.id, (e as Error).message);
      }
      timings.set(node.id, performance.now() - t0);
    }

    let output: Geometry = Geometry.empty();
    if (root instanceof NodeGroupOutput) {
      const geoIn = root.inputs.find((s) => s.bl_idname === 'NodeSocketGeometry');
      if (geoIn) output = (this.socketValue(geoIn, cache) as Geometry) ?? Geometry.empty();
    } else if (root) {
      const geoOut = root.outputs.find((s) => s.bl_idname === 'NodeSocketGeometry');
      if (geoOut) output = (cache.get(geoOut.id) as Geometry) ?? Geometry.empty();
    }

    return {
      output,
      duration_ms: performance.now() - start,
      node_timings: timings,
      errors,
    };
  }

  /**
   * Used by `evaluate()` to flag interior nodes so the outer pass skips them.
   * (Same algorithm as in ZoneRunner.collectInterior but exposed here to
   * avoid running it twice on the same zone.)
   */
  private collectInteriorForOuter(input: Node, output: Node, tree: NodeTree): Node[] {
    const fwd = new Set<Node>();
    const stack: Node[] = [input];
    while (stack.length) {
      const n = stack.pop()!;
      for (const l of tree.links) {
        if (l.from_node !== n || !l.is_valid || l.is_muted) continue;
        if (!fwd.has(l.to_node)) { fwd.add(l.to_node); stack.push(l.to_node); }
      }
    }
    const back = new Set<Node>();
    const stack2: Node[] = [output];
    while (stack2.length) {
      const n = stack2.pop()!;
      for (const l of tree.links) {
        if (l.to_node !== n || !l.is_valid || l.is_muted) continue;
        if (!back.has(l.from_node)) { back.add(l.from_node); stack2.push(l.from_node); }
      }
    }
    return tree.nodes.filter((n) => n !== input && n !== output && fwd.has(n) && back.has(n));
  }

  // ------------------------------------------------------------------
  //  Socket resolution
  // ------------------------------------------------------------------

  /** Resolve an input socket to its raw cached value (possibly a Field). */
  private socketValue(socket: NodeSocket, cache: Cache): unknown {
    if (socket.is_output) return cache.get(socket.id);
    if (socket.is_linked) {
      const link = socket.links[0];
      if (link && link.is_valid && !link.is_muted) {
        const src = cache.get(link.from_socket.id);
        if (src !== undefined) return src;
      }
    }
    return socket.default_value;
  }

  /** Force-resolve a socket to a Field of the right kind. */
  private socketField(socket: NodeSocket, cache: Cache): Field {
    const v = this.socketValue(socket, cache);
    if (isField(v)) return v;
    return liftToField(v, fieldKindForSocket(socket));
  }

  /** Force-resolve a socket to a single value (materialise field of size 1 if needed). */
  private socketSingle<T>(socket: NodeSocket, cache: Cache, dummyGeo: Geometry): T {
    const v = this.socketValue(socket, cache);
    if (isField(v)) {
      const ctx: FieldContext = { geometry: dummyGeo, domain: 'POINT', size: 1 };
      const arr = v.eval(ctx);
      const dims = v.kind === 'VECTOR' ? 3 : v.kind === 'COLOR' ? 4 : 1;
      if (dims === 1) return (arr[0] as number) as unknown as T;
      const out: number[] = [];
      for (let i = 0; i < dims; i++) out.push(arr[i] as number);
      return out as unknown as T;
    }
    return v as T;
  }

  // ------------------------------------------------------------------
  //  Mute pass-through
  // ------------------------------------------------------------------
  private passthroughMuted(node: Node, cache: Cache): void {
    // Blender-accurate mute routing: each output maps to the first compatible
    // unused input (see Node.computeInternalLinks). Outputs with no routable
    // input fall back to their default lifted as a field.
    const links = node.computeInternalLinks();
    for (const out of node.outputs) {
      const inSock = links.get(out.id);
      if (inSock) cache.set(out.id, this.socketValue(inSock, cache));
      else cache.set(out.id, liftToField(out.default_value, fieldKindForSocket(out)));
    }
  }

  // ==================================================================
  //  Per-node dispatch
  // ==================================================================
  /**
   * Recursively evaluate a Group container node's referenced child tree into
   * the shared cache. Container inputs seed the child's NodeGroupInput
   * outputs (by identifier); the child's NodeGroupOutput inputs are read back
   * into the container's outputs (by identifier).
   *
   * Nested groups, reroutes, mutes, and zones inside the child tree are all
   * handled because we reuse the same per-node dispatch + the child's own
   * topoOrder. Recursion depth is capped to guard against accidental cycles.
   */
  private executeGroup(node: NodeGroupBase, cache: Cache, depth: number): void {
    const child = node.resolvedTree;
    if (!child || depth > 64) {
      // Unresolved group → pass geometry through if shapes line up, else empty.
      for (const out of node.outputs) cache.set(out.id, liftToField(out.default_value, fieldKindForSocket(out)));
      return;
    }
    const giInput = child.nodes.find((n) => n instanceof NodeGroupInput) as NodeGroupInput | undefined;
    const giOutput = child.nodes.find((n) => n instanceof NodeGroupOutput) as NodeGroupOutput | undefined;

    // Seed child Group Input outputs from the container's input sockets.
    if (giInput) {
      for (const o of giInput.outputs) {
        const containerIn = node.inputs.find((s) => s.identifier === o.identifier);
        const v = containerIn ? this.socketValue(containerIn, cache) : liftToField(o.default_value, fieldKindForSocket(o));
        cache.set(o.id, v);
      }
    }

    // Run interior nodes (skip the GroupInput we just seeded).
    for (const inner of child.topoOrder()) {
      if (inner === giInput) continue;
      if (inner.mute) { this.passthroughMuted(inner, cache); continue; }
      if (inner instanceof NodeGroupBase) { this.executeGroup(inner, cache, depth + 1); continue; }
      try { this.executeNode(inner, cache); }
      catch { /* per-node error swallowed; group keeps flowing */ }
    }

    // Read child Group Output inputs into the container's output sockets.
    for (const out of node.outputs) {
      let v: unknown;
      if (giOutput) {
        const innerIn = giOutput.inputs.find((s) => s.identifier === out.identifier);
        v = innerIn ? this.socketValue(innerIn, cache) : undefined;
      }
      cache.set(out.id, v !== undefined ? v : liftToField(out.default_value, fieldKindForSocket(out)));
    }
  }

  private executeNode(node: Node, cache: Cache, _iterCtx?: ZoneIterContext): void {
    /* ---------------- Common (value / math / mix) ---------------- */
    if (node instanceof ValueNode)       { cache.set(node.outputs[0]!.id, constField(node.value, 'FLOAT')); return; }
    if (node instanceof VectorNode)      { cache.set(node.outputs[0]!.id, constField([...node.vector], 'VECTOR')); return; }
    if (node instanceof RGBNode)         { cache.set(node.outputs[0]!.id, constField([...node.rgb], 'COLOR')); return; }
    if (node instanceof RerouteNode)     { cache.set(node.outputs[0]!.id, this.socketValue(node.inputs[0]!, cache)); return; }

    /* ---------------- Group container (recursive) ---------------- */
    if (node instanceof NodeGroupBase) { this.executeGroup(node, cache, 0); return; }

    /* ---------------- Field utilities ---------------- */
    if (node instanceof GeometryNodeFlipFaces) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      cache.set(node.outputs[0]!.id, flipFaces(geo));
      return;
    }
    if (node instanceof GeometryNodeAttributeDomainSize) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const cnt = (d: AttributeDomain): Field => constField(geo.domainSize(d), 'INT');
      cache.set(node.outputs[0]!.id, cnt('POINT'));
      cache.set(node.outputs[1]!.id, cnt('EDGE'));
      cache.set(node.outputs[2]!.id, cnt('FACE'));
      cache.set(node.outputs[3]!.id, cnt('CORNER'));
      cache.set(node.outputs[4]!.id, cnt('CURVE'));
      cache.set(node.outputs[5]!.id, cnt('INSTANCE'));
      return;
    }
    if (node instanceof GeometryNodeAccumulateField) {
      const valF = this.socketField(node.inputs[0]!, cache);
      const dom = (node.domain as AttributeDomain) ?? 'POINT';
      const leading: Field = { kind: 'FLOAT', eval(ctx) {
        const arr = valF.eval({ geometry: ctx.geometry, domain: dom, size: ctx.geometry.domainSize(dom) }) as ArrayLike<number>;
        const out = new Float32Array(ctx.size); let acc = 0;
        for (let i = 0; i < ctx.size; i++) { acc += Number(arr[i] ?? 0); out[i] = acc; }
        return out;
      } };
      const trailing: Field = { kind: 'FLOAT', eval(ctx) {
        const arr = valF.eval({ geometry: ctx.geometry, domain: dom, size: ctx.geometry.domainSize(dom) }) as ArrayLike<number>;
        const out = new Float32Array(ctx.size); let acc = 0;
        for (let i = 0; i < ctx.size; i++) { out[i] = acc; acc += Number(arr[i] ?? 0); }
        return out;
      } };
      const total: Field = { kind: 'FLOAT', eval(ctx) {
        const arr = valF.eval({ geometry: ctx.geometry, domain: dom, size: ctx.geometry.domainSize(dom) }) as ArrayLike<number>;
        let acc = 0; for (let i = 0; i < arr.length; i++) acc += Number(arr[i] ?? 0);
        const out = new Float32Array(ctx.size); out.fill(acc); return out;
      } };
      cache.set(node.outputs[0]!.id, leading);
      cache.set(node.outputs[1]!.id, trailing);
      cache.set(node.outputs[2]!.id, total);
      return;
    }
    if (node instanceof GeometryNodeFieldOnDomain) {
      const valF = this.socketField(node.inputs[0]!, cache);
      const dom = (node.domain as AttributeDomain) ?? 'POINT';
      // Materialise on the configured domain, then map back to the consumer
      // domain by clamped index (a simplified interpolation).
      const out: Field = { kind: valF.kind, eval(ctx) {
        const srcSize = ctx.geometry.domainSize(dom);
        const src = valF.eval({ geometry: ctx.geometry, domain: dom, size: srcSize }) as ArrayLike<number>;
        const dims = valF.kind === 'VECTOR' ? 3 : valF.kind === 'COLOR' ? 4 : 1;
        const res = new Float32Array(ctx.size * dims);
        for (let i = 0; i < ctx.size; i++) {
          const si = srcSize > 0 ? Math.min(i, srcSize - 1) : 0;
          for (let d = 0; d < dims; d++) res[i * dims + d] = Number(src[si * dims + d] ?? 0);
        }
        return res;
      } };
      cache.set(node.outputs[0]!.id, out);
      return;
    }
    if (node instanceof GeometryNodeFieldAtIndex) {
      const idxF = this.socketField(node.inputs[0]!, cache);
      const valF = this.socketField(node.inputs[1]!, cache);
      const dom = (node.domain as AttributeDomain) ?? 'POINT';
      const out: Field = { kind: valF.kind, eval(ctx) {
        const srcSize = ctx.geometry.domainSize(dom);
        const src = valF.eval({ geometry: ctx.geometry, domain: dom, size: srcSize }) as ArrayLike<number>;
        const idx = idxF.eval(ctx) as ArrayLike<number>;
        const dims = valF.kind === 'VECTOR' ? 3 : valF.kind === 'COLOR' ? 4 : 1;
        const res = new Float32Array(ctx.size * dims);
        for (let i = 0; i < ctx.size; i++) {
          let gi = Math.round(Number(idx[i] ?? 0));
          if (srcSize > 0) { gi = Math.max(0, Math.min(srcSize - 1, gi)); } else gi = 0;
          for (let d = 0; d < dims; d++) res[i * dims + d] = Number(src[gi * dims + d] ?? 0);
        }
        return res;
      } };
      cache.set(node.outputs[0]!.id, out);
      return;
    }

    if (node instanceof MathNode) {
      const a = this.socketField(node.inputs[0]!, cache);
      const b = this.socketField(node.inputs[1]!, cache);
      const c = this.socketField(node.inputs[2]!, cache);
      const op = node.operation, clamp = node.use_clamp;
      cache.set(node.outputs[0]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const av = a.eval(ctx) as Float32Array | Int32Array | Uint8Array;
          const bv = b.eval(ctx) as Float32Array | Int32Array | Uint8Array;
          const cv = c.eval(ctx) as Float32Array | Int32Array | Uint8Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            out[i] = MathNode.compute(op, av[i] as number, bv[i] as number, cv[i] as number, clamp);
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof VectorMathNode) {
      const a = this.socketField(node.inputs[0]!, cache);
      const b = this.socketField(node.inputs[1]!, cache);
      const c = this.socketField(node.inputs[2]!, cache);
      const s = this.socketField(node.inputs[3]!, cache);
      const op = node.operation;
      cache.set(node.outputs[0]!.id, {
        kind: 'VECTOR',
        eval(ctx) {
          const av = a.eval(ctx) as Float32Array;
          const bv = b.eval(ctx) as Float32Array;
          const cv = c.eval(ctx) as Float32Array;
          const sv = s.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size * 3);
          for (let i = 0; i < ctx.size; i++) {
            const ai: Vec3 = [av[i * 3]!, av[i * 3 + 1]!, av[i * 3 + 2]!];
            const bi: Vec3 = [bv[i * 3]!, bv[i * 3 + 1]!, bv[i * 3 + 2]!];
            const ci: Vec3 = [cv[i * 3]!, cv[i * 3 + 1]!, cv[i * 3 + 2]!];
            const r = VectorMathNode.compute(op, ai, bi, ci, sv[i] as number);
            out[i * 3] = r.vec[0]; out[i * 3 + 1] = r.vec[1]; out[i * 3 + 2] = r.vec[2];
          }
          return out;
        },
      } satisfies Field);
      cache.set(node.outputs[1]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const av = a.eval(ctx) as Float32Array;
          const bv = b.eval(ctx) as Float32Array;
          const cv = c.eval(ctx) as Float32Array;
          const sv = s.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            const ai: Vec3 = [av[i * 3]!, av[i * 3 + 1]!, av[i * 3 + 2]!];
            const bi: Vec3 = [bv[i * 3]!, bv[i * 3 + 1]!, bv[i * 3 + 2]!];
            const ci: Vec3 = [cv[i * 3]!, cv[i * 3 + 1]!, cv[i * 3 + 2]!];
            out[i] = VectorMathNode.compute(op, ai, bi, ci, sv[i] as number).val;
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof MixNode) {
      const f = this.socketField(node.inputs[0]!, cache);
      const dt = node.data_type;
      if (dt === 'FLOAT') {
        const a = this.socketField(node.inputs[1]!, cache);
        const b = this.socketField(node.inputs[2]!, cache);
        cache.set(node.outputs[0]!.id, {
          kind: 'FLOAT',
          eval(ctx) {
            const fv = f.eval(ctx) as Float32Array;
            const av = a.eval(ctx) as Float32Array;
            const bv = b.eval(ctx) as Float32Array;
            const out = new Float32Array(ctx.size);
            for (let i = 0; i < ctx.size; i++) out[i] = MixNode.mixFloat(av[i]!, bv[i]!, fv[i]!);
            return out;
          },
        } satisfies Field);
      } else if (dt === 'VECTOR') {
        const a = this.socketField(node.inputs[3]!, cache);
        const b = this.socketField(node.inputs[4]!, cache);
        cache.set(node.outputs[1]!.id, {
          kind: 'VECTOR',
          eval(ctx) {
            const fv = f.eval(ctx) as Float32Array;
            const av = a.eval(ctx) as Float32Array;
            const bv = b.eval(ctx) as Float32Array;
            const out = new Float32Array(ctx.size * 3);
            for (let i = 0; i < ctx.size; i++) {
              const ti = fv[i]!;
              for (let k = 0; k < 3; k++) out[i * 3 + k] = av[i * 3 + k]! * (1 - ti) + bv[i * 3 + k]! * ti;
            }
            return out;
          },
        } satisfies Field);
      } else {
        const a = this.socketField(node.inputs[5]!, cache);
        const b = this.socketField(node.inputs[6]!, cache);
        const blend = node.blend_type;
        cache.set(node.outputs[2]!.id, {
          kind: 'COLOR',
          eval(ctx) {
            const fv = f.eval(ctx) as Float32Array;
            const av = a.eval(ctx) as Float32Array;
            const bv = b.eval(ctx) as Float32Array;
            const out = new Float32Array(ctx.size * 4);
            for (let i = 0; i < ctx.size; i++) {
              const ac: [number, number, number, number] = [av[i * 4]!, av[i * 4 + 1]!, av[i * 4 + 2]!, av[i * 4 + 3]!];
              const bc: [number, number, number, number] = [bv[i * 4]!, bv[i * 4 + 1]!, bv[i * 4 + 2]!, bv[i * 4 + 3]!];
              const r = MixNode.mixColor(ac, bc, fv[i]!, blend);
              out[i * 4] = r[0]; out[i * 4 + 1] = r[1]; out[i * 4 + 2] = r[2]; out[i * 4 + 3] = r[3];
            }
            return out;
          },
        } satisfies Field);
      }
      return;
    }
    if (node instanceof MapRangeNode) {
      const v = this.socketField(node.inputs[0]!, cache);
      const fmn = this.socketField(node.inputs[1]!, cache);
      const fmx = this.socketField(node.inputs[2]!, cache);
      const tmn = this.socketField(node.inputs[3]!, cache);
      const tmx = this.socketField(node.inputs[4]!, cache);
      const stps = this.socketField(node.inputs[5]!, cache);
      const interp = node.interpolation_type, clamp = node.clamp;
      cache.set(node.outputs[0]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const vV = v.eval(ctx) as Float32Array;
          const fA = fmn.eval(ctx) as Float32Array, fB = fmx.eval(ctx) as Float32Array;
          const tA = tmn.eval(ctx) as Float32Array, tB = tmx.eval(ctx) as Float32Array;
          const stp = stps.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            out[i] = MapRangeNode.computeFloat(vV[i]!, fA[i]!, fB[i]!, tA[i]!, tB[i]!, stp[i]!, interp, clamp);
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof ClampNode) {
      const v = this.socketField(node.inputs[0]!, cache);
      const mn = this.socketField(node.inputs[1]!, cache);
      const mx = this.socketField(node.inputs[2]!, cache);
      const mode = node.clamp_type;
      cache.set(node.outputs[0]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const vv = v.eval(ctx) as Float32Array;
          const mnv = mn.eval(ctx) as Float32Array;
          const mxv = mx.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) out[i] = ClampNode.compute(vv[i]!, mnv[i]!, mxv[i]!, mode);
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof ColorRampNode) {
      const v = this.socketField(node.inputs[0]!, cache);
      const stops = node.stops, interp = node.interpolation;
      cache.set(node.outputs[0]!.id, {
        kind: 'COLOR',
        eval(ctx) {
          const vv = v.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size * 4);
          for (let i = 0; i < ctx.size; i++) {
            const c = ColorRampNode.sample(stops, interp, vv[i]!);
            out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3];
          }
          return out;
        },
      } satisfies Field);
      cache.set(node.outputs[1]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const vv = v.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) out[i] = ColorRampNode.sample(stops, interp, vv[i]!)[3]!;
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof CombineXYZNode) {
      const x = this.socketField(node.inputs[0]!, cache);
      const y = this.socketField(node.inputs[1]!, cache);
      const z = this.socketField(node.inputs[2]!, cache);
      cache.set(node.outputs[0]!.id, {
        kind: 'VECTOR',
        eval(ctx) {
          const xv = x.eval(ctx) as Float32Array, yv = y.eval(ctx) as Float32Array, zv = z.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size * 3);
          for (let i = 0; i < ctx.size; i++) { out[i * 3] = xv[i]!; out[i * 3 + 1] = yv[i]!; out[i * 3 + 2] = zv[i]!; }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof SeparateXYZNode) {
      const v = this.socketField(node.inputs[0]!, cache);
      for (let k = 0; k < 3; k++) {
        const idx = k;
        cache.set(node.outputs[k]!.id, {
          kind: 'FLOAT',
          eval(ctx) {
            const vv = v.eval(ctx) as Float32Array;
            const out = new Float32Array(ctx.size);
            for (let i = 0; i < ctx.size; i++) out[i] = vv[i * 3 + idx]!;
            return out;
          },
        } satisfies Field);
      }
      return;
    }
    if (node instanceof CombineColorNode) {
      const r = this.socketField(node.inputs[0]!, cache);
      const g = this.socketField(node.inputs[1]!, cache);
      const b = this.socketField(node.inputs[2]!, cache);
      cache.set(node.outputs[0]!.id, {
        kind: 'COLOR',
        eval(ctx) {
          const rv = r.eval(ctx) as Float32Array, gv = g.eval(ctx) as Float32Array, bv = b.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size * 4);
          for (let i = 0; i < ctx.size; i++) {
            out[i * 4] = rv[i]!; out[i * 4 + 1] = gv[i]!; out[i * 4 + 2] = bv[i]!; out[i * 4 + 3] = 1;
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof SeparateColorNode) {
      const v = this.socketField(node.inputs[0]!, cache);
      for (let k = 0; k < 3; k++) {
        const idx = k;
        cache.set(node.outputs[k]!.id, {
          kind: 'FLOAT',
          eval(ctx) {
            const vv = v.eval(ctx) as Float32Array;
            const out = new Float32Array(ctx.size);
            for (let i = 0; i < ctx.size; i++) out[i] = vv[i * 4 + idx]!;
            return out;
          },
        } satisfies Field);
      }
      return;
    }
    if (node instanceof BooleanMathNode) {
      const a = this.socketField(node.inputs[0]!, cache);
      const b = this.socketField(node.inputs[1]!, cache);
      const op = node.operation;
      cache.set(node.outputs[0]!.id, {
        kind: 'BOOL',
        eval(ctx) {
          const av = a.eval(ctx) as Uint8Array;
          const bv = b.eval(ctx) as Uint8Array;
          const out = new Uint8Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            out[i] = BooleanMathNode.compute(op, !!av[i], !!bv[i]) ? 1 : 0;
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof CompareNode) {
      const a = this.socketField(node.inputs[0]!, cache);
      const b = this.socketField(node.inputs[1]!, cache);
      const eps = this.socketField(node.inputs[2]!, cache);
      const op = node.operation;
      cache.set(node.outputs[0]!.id, {
        kind: 'BOOL',
        eval(ctx) {
          const av = a.eval(ctx) as Float32Array;
          const bv = b.eval(ctx) as Float32Array;
          const ev = eps.eval(ctx) as Float32Array;
          const out = new Uint8Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            out[i] = CompareNode.compute(op, av[i]!, bv[i]!, ev[i]!) ? 1 : 0;
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof RandomValueNode) {
      const id = this.socketField(node.inputs[7]!, cache);
      const sd = this.socketField(node.inputs[8]!, cache);
      cache.set(node.outputs[1]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const iv = id.eval(ctx) as Int32Array;
          const sv = sd.eval(ctx) as Int32Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) out[i] = RandomValueNode.hash((iv[i] as number) || i, sv[i] as number);
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof SwitchNode) {
      // Static fallback: forward False or True based on the Switch socket's
      // current default value. Full dynamic switching across systems is M8.
      const useTrue = !!(this.socketValue(node.inputs[0]!, cache) as boolean);
      cache.set(node.outputs[0]!.id, this.socketValue(node.inputs[useTrue ? 2 : 1]!, cache));
      return;
    }
    if (node instanceof NodeGroupInput) {
      for (const out of node.outputs) cache.set(out.id, liftToField(out.default_value, fieldKindForSocket(out)));
      return;
    }
    if (node instanceof NodeGroupOutput) {
      return;
    }

    /* ---------------- Geometry field inputs ---------------- */
    if (node instanceof GeometryNodeInputPosition) { cache.set(node.outputs[0]!.id, positionField()); return; }
    if (node instanceof GeometryNodeInputNormal)   { cache.set(node.outputs[0]!.id, normalField()); return; }
    if (node instanceof GeometryNodeInputIndex)    { cache.set(node.outputs[0]!.id, indexField()); return; }
    if (node instanceof GeometryNodeInputID)       { cache.set(node.outputs[0]!.id, idField()); return; }
    if (node instanceof GeometryNodeInputRadius)   { cache.set(node.outputs[0]!.id, radiusField()); return; }
    if (node instanceof GeometryNodeInputNamedAttribute) {
      const dummy = Geometry.empty();
      const name = this.socketSingle<string>(node.inputs[0]!, cache, dummy);
      cache.set(node.outputs[0]!.id, attributeField(name, 'FLOAT'));
      cache.set(node.outputs[1]!.id, attributeField(name, 'INT'));
      cache.set(node.outputs[2]!.id, attributeField(name, 'BOOL'));
      cache.set(node.outputs[3]!.id, attributeField(name, 'VECTOR'));
      cache.set(node.outputs[4]!.id, attributeField(name, 'COLOR'));
      cache.set(node.outputs[5]!.id, {
        kind: 'BOOL',
        eval(ctx) {
          const exists = !!ctx.geometry.findAttribute(name);
          const out = new Uint8Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) out[i] = exists ? 1 : 0;
          return out;
        },
      } satisfies Field);
      return;
    }

    /* ---------------- Mesh primitives ---------------- */
    if (node instanceof GeometryNodeMeshCube) {
      const sz = this.socketSingle<Vec3>(node.inputs[0]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildCube(sz));
      cache.set(node.outputs[1]!.id, constField([0, 0, 0], 'VECTOR'));
      return;
    }
    if (node instanceof GeometryNodeMeshUVSphere) {
      const segments = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const rings = this.socketSingle<number>(node.inputs[1]!, cache, Geometry.empty());
      const radius = this.socketSingle<number>(node.inputs[2]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildUVSphere(radius, rings, segments));
      return;
    }
    if (node instanceof GeometryNodeMeshIcoSphere) {
      const radius = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildIcosphere(radius, node.subdivisions));
      return;
    }
    if (node instanceof GeometryNodeMeshCylinder) {
      const verts = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const radius = this.socketSingle<number>(node.inputs[3]!, cache, Geometry.empty());
      const depth = this.socketSingle<number>(node.inputs[4]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildCylinder(radius, depth, verts, node.fill_type !== 'NONE'));
      return;
    }
    if (node instanceof GeometryNodeMeshCone) {
      const verts = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const rt = this.socketSingle<number>(node.inputs[3]!, cache, Geometry.empty());
      const rb = this.socketSingle<number>(node.inputs[4]!, cache, Geometry.empty());
      const depth = this.socketSingle<number>(node.inputs[5]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildCone(rb, rt, depth, verts, node.fill_type !== 'NONE'));
      return;
    }
    if (node instanceof GeometryNodeMeshGrid) {
      const sx = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const sy = this.socketSingle<number>(node.inputs[1]!, cache, Geometry.empty());
      const vx = this.socketSingle<number>(node.inputs[2]!, cache, Geometry.empty());
      const vy = this.socketSingle<number>(node.inputs[3]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildGrid(sx, sy, vx, vy));
      return;
    }
    if (node instanceof GeometryNodeMeshLine) {
      const count = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const start = this.socketSingle<Vec3>(node.inputs[2]!, cache, Geometry.empty());
      const offset = this.socketSingle<Vec3>(node.inputs[3]!, cache, Geometry.empty());
      const end: Vec3 = [
        start[0] + offset[0] * (count - 1),
        start[1] + offset[1] * (count - 1),
        start[2] + offset[2] * (count - 1),
      ];
      cache.set(node.outputs[0]!.id, buildMeshLine(count, start, end));
      return;
    }
    if (node instanceof GeometryNodeMeshCircle) {
      const verts = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const radius = this.socketSingle<number>(node.inputs[1]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildMeshCircle(verts, radius, node.fill_type));
      return;
    }

    /* ---------------- Curve primitives ---------------- */
    if (node instanceof GeometryNodeCurveLine) {
      const s = this.socketSingle<Vec3>(node.inputs[0]!, cache, Geometry.empty());
      const e = this.socketSingle<Vec3>(node.inputs[1]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildCurveLine(s, e));
      return;
    }
    if (node instanceof GeometryNodeCurveCircle) {
      const res = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const rad = this.socketSingle<number>(node.inputs[1]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildCurveCircle(rad, res));
      return;
    }
    if (node instanceof GeometryNodeCurveBezierSegment) {
      const res = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const s = this.socketSingle<Vec3>(node.inputs[1]!, cache, Geometry.empty());
      const sh = this.socketSingle<Vec3>(node.inputs[2]!, cache, Geometry.empty());
      const eh = this.socketSingle<Vec3>(node.inputs[3]!, cache, Geometry.empty());
      const e = this.socketSingle<Vec3>(node.inputs[4]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildBezierSegment(s, sh, eh, e, res));
      return;
    }
    if (node instanceof GeometryNodeCurveSpiral) {
      const res = this.socketSingle<number>(node.inputs[0]!, cache, Geometry.empty());
      const rot = this.socketSingle<number>(node.inputs[1]!, cache, Geometry.empty());
      const sr = this.socketSingle<number>(node.inputs[2]!, cache, Geometry.empty());
      const er = this.socketSingle<number>(node.inputs[3]!, cache, Geometry.empty());
      const h = this.socketSingle<number>(node.inputs[4]!, cache, Geometry.empty());
      cache.set(node.outputs[0]!.id, buildCurveSpiral(rot, sr, er, h, res));
      return;
    }

    /* ---------------- Geometry ops ---------------- */
    if (node instanceof GeometryNodeTransform) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const t = this.socketSingle<Vec3>(node.inputs[1]!, cache, geo);
      const r = this.socketSingle<Vec3>(node.inputs[2]!, cache, geo);
      const s = this.socketSingle<Vec3>(node.inputs[3]!, cache, geo);
      cache.set(node.outputs[0]!.id, transformGeometry(geo, t, r, s));
      return;
    }
    if (node instanceof GeometryNodeJoinGeometry) {
      const inSock = node.inputs[0]!;
      const sources: Geometry[] = [];
      const sorted = [...inSock.links].sort((a, b) => a.multi_input_sort_id - b.multi_input_sort_id);
      for (const link of sorted) {
        if (!link.is_valid || link.is_muted) continue;
        const g = cache.get(link.from_socket.id) as Geometry | undefined;
        if (g) sources.push(g);
      }
      cache.set(node.outputs[0]!.id, joinGeometries(sources));
      return;
    }
    if (node instanceof GeometryNodeSetPosition) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sel = this.socketField(node.inputs[1]!, cache);
      const posField = this.socketField(node.inputs[2]!, cache);
      const offField = this.socketField(node.inputs[3]!, cache);
      const ctx: FieldContext = { geometry: geo, domain: 'POINT', size: geo.domainSize('POINT') };
      const selV = sel.eval(ctx);
      // "Position" is only used when actually linked; otherwise the node keeps the existing position.
      const positionOverride = node.inputs[2]!.is_linked
        ? (posField.eval(ctx) as Float32Array)
        : null;
      const offset = offField.eval(ctx) as Float32Array;
      cache.set(node.outputs[0]!.id, setPosition(geo, selV, positionOverride, offset));
      return;
    }
    if (node instanceof GeometryNodeCaptureAttribute) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const valueField = this.socketField(node.inputs[1]!, cache);
      const domain = node.domain;
      const ctx: FieldContext = { geometry: geo, domain, size: geo.domainSize(domain) };
      const captured = valueField.eval(ctx);
      const anonId = nextAnonymousId();
      const dt = node.data_type;
      // Map our FieldKind back to Blender's storage type
      const storageType =
        dt === 'INT' ? 'INT' :
        dt === 'BOOL' ? 'BOOL' :
        dt === 'FLOAT_VECTOR' ? 'FLOAT_VECTOR' :
        dt === 'FLOAT_COLOR' ? 'FLOAT_COLOR' :
        'FLOAT';
      const stored = storeAttributeOn(geo, anonId, domain, storageType, captured);
      cache.set(node.outputs[0]!.id, stored);
      cache.set(
        node.outputs[1]!.id,
        anonField(anonId, valueField.kind, valueField),
      );
      return;
    }
    if (node instanceof GeometryNodeStoreNamedAttribute) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const _sel = this.socketField(node.inputs[1]!, cache); void _sel;
      const name = this.socketSingle<string>(node.inputs[2]!, cache, geo);
      const valueField = this.socketField(node.inputs[3]!, cache);
      const domain = node.domain;
      const ctx: FieldContext = { geometry: geo, domain, size: geo.domainSize(domain) };
      const arr = valueField.eval(ctx);
      const dt = node.data_type;
      const storageType =
        dt === 'INT' ? 'INT' :
        dt === 'BOOL' ? 'BOOL' :
        dt === 'FLOAT_VECTOR' ? 'FLOAT_VECTOR' :
        dt === 'FLOAT_COLOR' ? 'FLOAT_COLOR' :
        'FLOAT';
      cache.set(node.outputs[0]!.id, storeAttributeOn(geo, name, domain, storageType, arr));
      return;
    }
    if (node instanceof GeometryNodeRemoveAttribute) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const name = this.socketSingle<string>(node.inputs[1]!, cache, geo);
      const out = geo.cloneOwning();
      for (const a of out.allAttributes()) {
        if (a.name === name) {
          out.attributesForDomain(a.domain)?.delete(name);
        }
      }
      cache.set(node.outputs[0]!.id, out);
      return;
    }
    if (node instanceof GeometryNodeBoundBox) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const bb = boundingBox(geo);
      cache.set(node.outputs[0]!.id, bb.geometry);
      cache.set(node.outputs[1]!.id, constField(bb.min, 'VECTOR'));
      cache.set(node.outputs[2]!.id, constField(bb.max, 'VECTOR'));
      return;
    }
    if (node instanceof GeometryNodeMergeByDistance) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sel = this.socketField(node.inputs[1]!, cache);
      const dist = this.socketSingle<number>(node.inputs[2]!, cache, geo);
      const ctx: FieldContext = { geometry: geo, domain: 'POINT', size: geo.domainSize('POINT') };
      const selV = sel.eval(ctx);
      cache.set(node.outputs[0]!.id, mergeByDistance(geo, selV, dist));
      return;
    }
    if (node instanceof GeometryNodeSubdivisionSurface) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const level = this.socketSingle<number>(node.inputs[1]!, cache, geo);
      cache.set(node.outputs[0]!.id, subdivisionSurface(geo, Math.max(0, Math.min(level, 6))));
      return;
    }
    if (node instanceof GeometryNodeTriangulate) {
      // already triangulated internally; pass-through.
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      cache.set(node.outputs[0]!.id, geo);
      return;
    }
    if (node instanceof GeometryNodeDistributePointsOnFaces) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const _sel = this.socketField(node.inputs[1]!, cache); void _sel;
      const distMin = this.socketSingle<number>(node.inputs[2]!, cache, geo);
      const density =
        node.distribute_method === 'POISSON'
          ? this.socketSingle<number>(node.inputs[3]!, cache, geo)
          : this.socketSingle<number>(node.inputs[4]!, cache, geo);
      const seed = this.socketSingle<number>(node.inputs[6]!, cache, geo);
      const r = distributePointsOnFaces(geo, density, seed, node.distribute_method, distMin);
      cache.set(node.outputs[0]!.id, r.points);
      cache.set(node.outputs[1]!.id, constField([0, 0, 1], 'VECTOR')); // simplified
      cache.set(node.outputs[2]!.id, constField([0, 0, 0], 'VECTOR'));
      return;
    }
    if (node instanceof GeometryNodeMeshToPoints) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sel = this.socketField(node.inputs[1]!, cache);
      const rad = this.socketField(node.inputs[3]!, cache);
      const ctx: FieldContext = { geometry: geo, domain: 'POINT', size: geo.domainSize('POINT') };
      const selV = sel.eval(ctx);
      const radV = rad.eval(ctx);
      cache.set(node.outputs[0]!.id, meshToPoints(geo, selV, radV, node.mode));
      return;
    }
    if (node instanceof GeometryNodePointsToVertices) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sel = this.socketField(node.inputs[1]!, cache);
      const ctx: FieldContext = { geometry: geo, domain: 'POINT', size: geo.domainSize('POINT') };
      cache.set(node.outputs[0]!.id, pointsToVertices(geo, sel.eval(ctx)));
      return;
    }
    if (node instanceof GeometryNodeInstanceOnPoints) {
      const pointsGeo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sel = this.socketField(node.inputs[1]!, cache);
      const inst = (this.socketValue(node.inputs[2]!, cache) as Geometry) ?? Geometry.empty();
      const rot = this.socketField(node.inputs[5]!, cache);
      const scl = this.socketField(node.inputs[6]!, cache);
      const ctx: FieldContext = { geometry: pointsGeo, domain: 'POINT', size: pointsGeo.domainSize('POINT') };
      cache.set(node.outputs[0]!.id, instanceOnPoints(
        pointsGeo, inst,
        sel.eval(ctx),
        rot.eval(ctx) as Float32Array,
        scl.eval(ctx) as Float32Array,
      ));
      return;
    }
    if (node instanceof GeometryNodeRealizeInstances) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      cache.set(node.outputs[0]!.id, realizeInstances(geo));
      return;
    }
    if (node instanceof GeometryNodeTranslateInstances || node instanceof GeometryNodeRotateInstances || node instanceof GeometryNodeScaleInstances) {
      // Light implementation: bake a transform into each instance matrix.
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const _sel = this.socketField(node.inputs[1]!, cache); void _sel;
      const out = geo.cloneOwning();
      if (out.instances) {
        for (const it of out.instances.items) {
          let t: Vec3 = [0, 0, 0], r: Vec3 = [0, 0, 0], s: Vec3 = [1, 1, 1];
          if (node instanceof GeometryNodeTranslateInstances) {
            t = this.socketSingle<Vec3>(node.inputs[2]!, cache, geo);
          } else if (node instanceof GeometryNodeRotateInstances) {
            const rr = this.socketSingle<unknown>(node.inputs[2]!, cache, geo);
            r = Array.isArray(rr) ? (rr as Vec3) : [0, 0, 0];
          } else {
            s = this.socketSingle<Vec3>(node.inputs[2]!, cache, geo);
          }
          // Pre-multiply by the new transform.
          it.transform = mat4Mul(composeMat4(t, r, s), it.transform);
        }
      }
      cache.set(node.outputs[0]!.id, out);
      return;
    }
    if (node instanceof GeometryNodeCurveToMesh) {
      const curve = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const profile = (this.socketValue(node.inputs[1]!, cache) as Geometry | undefined) ?? null;
      cache.set(node.outputs[0]!.id, curveToMesh(curve, profile));
      return;
    }
    if (node instanceof GeometryNodeCurveToPoints) {
      const curve = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const count = this.socketSingle<number>(node.inputs[1]!, cache, curve);
      const length = this.socketSingle<number>(node.inputs[2]!, cache, curve);
      cache.set(node.outputs[0]!.id, curveToPoints(curve, node.mode, count, length));
      return;
    }
    if (node instanceof GeometryNodeResampleCurve) {
      const curve = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const count = this.socketSingle<number>(node.inputs[2]!, cache, curve);
      const length = this.socketSingle<number>(node.inputs[3]!, cache, curve);
      cache.set(node.outputs[0]!.id, resampleCurve(curve, node.mode, count, length));
      return;
    }
    if (node instanceof GeometryNodeReverseCurve) {
      const curve = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      cache.set(node.outputs[0]!.id, reverseCurve(curve));
      return;
    }
    if (node instanceof GeometryNodeSampleIndex) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const valueF = this.socketField(node.inputs[1]!, cache);
      const idxF = this.socketField(node.inputs[2]!, cache);
      const domain = node.domain;
      const sampledCtx: FieldContext = { geometry: geo, domain, size: geo.domainSize(domain) };
      const values = valueF.eval(sampledCtx) as Float32Array;
      // The Index input is evaluated in the consumer's context; we wrap the
      // result so each downstream eval reads index from the consumer.
      cache.set(node.outputs[0]!.id, {
        kind: valueF.kind,
        eval(ctx) {
          const idxs = idxF.eval(ctx) as Int32Array | Float32Array;
          const dims = valueF.kind === 'VECTOR' ? 3 : valueF.kind === 'COLOR' ? 4 : 1;
          const out = new Float32Array(ctx.size * dims);
          for (let i = 0; i < ctx.size; i++) {
            const idx = Math.max(0, Math.min((idxs[i] as number) | 0, (values.length / dims) - 1));
            for (let k = 0; k < dims; k++) out[i * dims + k] = (values[idx * dims + k] as number) ?? 0;
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof GeometryNodeSampleNearest) {
      const geo = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sampleF = this.socketField(node.inputs[1]!, cache);
      cache.set(node.outputs[0]!.id, {
        kind: 'INT',
        eval(ctx) {
          const sv = sampleF.eval(ctx) as Float32Array;
          const out = new Int32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            out[i] = sampleNearestIndex(geo, [sv[i * 3]!, sv[i * 3 + 1]!, sv[i * 3 + 2]!]);
          }
          return out;
        },
      } satisfies Field);
      return;
    }
    if (node instanceof GeometryNodeProximity) {
      const target = (this.socketValue(node.inputs[0]!, cache) as Geometry) ?? Geometry.empty();
      const sampleF = this.socketField(node.inputs[1]!, cache);
      cache.set(node.outputs[0]!.id, {
        kind: 'VECTOR',
        eval(ctx) {
          const sv = sampleF.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size * 3);
          for (let i = 0; i < ctx.size; i++) {
            const r = geometryProximity(target, [sv[i * 3]!, sv[i * 3 + 1]!, sv[i * 3 + 2]!]);
            out[i * 3] = r.position[0]; out[i * 3 + 1] = r.position[1]; out[i * 3 + 2] = r.position[2];
          }
          return out;
        },
      } satisfies Field);
      cache.set(node.outputs[1]!.id, {
        kind: 'FLOAT',
        eval(ctx) {
          const sv = sampleF.eval(ctx) as Float32Array;
          const out = new Float32Array(ctx.size);
          for (let i = 0; i < ctx.size; i++) {
            out[i] = geometryProximity(target, [sv[i * 3]!, sv[i * 3 + 1]!, sv[i * 3 + 2]!]).distance;
          }
          return out;
        },
      } satisfies Field);
      return;
    }

    /* ---------------- Custom node extension point ----------------
     * Mirrors Blender's per-node functions: a node class (e.g. a ported
     * addon node via the bpy shim) may implement `executeGeo(ctx)` to
     * compute its own outputs. This is the documented per-node hook that
     * keeps custom nodes out of this switch. */
    const custom = node as unknown as { executeGeo?: (ctx: GeoNodeExecCtx) => void };
    if (typeof custom.executeGeo === 'function') {
      const self = this;
      const ctx: GeoNodeExecCtx = {
        node,
        inputField: (name: string) => {
          const sock = node.inputs.find((x) => x.identifier === name || x.name === name);
          return sock ? self.socketField(sock, cache) : constField(0, 'FLOAT');
        },
        inputValue: (name: string) => {
          const sock = node.inputs.find((x) => x.identifier === name || x.name === name);
          return sock ? self.socketValue(sock, cache) : undefined;
        },
        setOutputField: (name: string, field: Field) => {
          const sock = node.outputs.find((x) => x.identifier === name || x.name === name);
          if (sock) cache.set(sock.id, field);
        },
        setOutputValue: (name: string, value: unknown) => {
          const sock = node.outputs.find((x) => x.identifier === name || x.name === name);
          if (sock) cache.set(sock.id, value);
        },
        constField, mapField, zipField,
      };
      custom.executeGeo(ctx);
      return;
    }

    /* ---------------- Unknown ---------------- */
    for (const out of node.outputs) cache.set(out.id, liftToField(out.default_value, fieldKindForSocket(out)));
  }
}

/** Context handed to a custom node's `executeGeo()` (bpy-shim extension point). */
export interface GeoNodeExecCtx {
  node: Node;
  inputField(name: string): Field;
  inputValue(name: string): unknown;
  setOutputField(name: string, field: Field): void;
  setOutputValue(name: string, value: unknown): void;
  constField: typeof constField;
  mapField: typeof mapField;
  zipField: typeof zipField;
}

// Suppress unused warnings for symbols only referenced via require()/type-only paths.
void MeshComponent;
