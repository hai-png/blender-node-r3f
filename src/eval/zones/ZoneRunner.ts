/**
 * ZoneRunner — drives the interior of a Simulation / Repeat / Foreach zone.
 *
 * The outer GeometryEvaluator treats a zone as a black box: when its
 * Output node is reached in topo order, it calls into here with:
 *   - the Output node (so we can locate the paired Input and the state items)
 *   - the cache map for socket id → value (already populated for nodes
 *     *outside* the zone)
 *   - a callback to evaluate a single interior node (the same logic the
 *     outer evaluator uses for any other node)
 *
 * We then:
 *   1. Read the initial state from external inputs of the Input node.
 *   2. Compute the interior topology (nodes between Input and Output).
 *   3. Run the zone-specific loop, calling `runOne(node, scratchCache)` for
 *      each interior node, with the Input's outputs pre-seeded.
 *   4. Write the final state to the Output node's external outputs in the
 *      shared cache so downstream nodes see them.
 */
import type { NodeTree } from '../../core/NodeTree';
import type { Node } from '../../core/Node';
import type { NodeSocket } from '../../core/NodeSocket';
import { Geometry } from '../geometry/Geometry';
import { constField, type Field } from '../geometry/Field';
import { joinGeometries } from '../geometry/MeshOps';
import {
  GeoZoneInputBase, GeoZoneOutputBase,
  GeometryNodeSimulationInput, GeometryNodeSimulationOutput,
  GeometryNodeRepeatInput, GeometryNodeRepeatOutput,
  GeometryNodeForeachGeometryElementInput, GeometryNodeForeachGeometryElementOutput,
} from '../../nodes/geometry/Zones';
import { SimZoneCache, type SceneTime, type ZoneState, type ZoneIterContext } from './types';

export type Cache = Map<string /* socket.id */, unknown>;

export interface ZoneEvalContext {
  tree: NodeTree;
  scene: SceneTime;
  simCache: Map<string, SimZoneCache>;
  /** The outer evaluator's per-node executor — given (node, cache), runs node and fills cache. */
  runOne: (node: Node, cache: Cache, iterCtx?: ZoneIterContext) => void;
  /** The outer evaluator's helper to resolve a socket's current value (Field or literal). */
  socketValue: (socket: NodeSocket, cache: Cache) => unknown;
  /** The outer evaluator's helper to resolve a socket's single (non-field) value. */
  socketSingle: <T>(socket: NodeSocket, cache: Cache, dummy: Geometry) => T;
}

/**
 * Run a zone given its Output node. Writes the final outputs into `cache`.
 */
export function runZone(output: GeoZoneOutputBase, cache: Cache, ctx: ZoneEvalContext): void {
  const input = output.findPair();
  if (!input) {
    // Dangling Output; emit defaults.
    for (const s of output.outputs) cache.set(s.id, defaultValueFor(s));
    return;
  }

  const interior = collectInterior(input, output, ctx.tree);
  const stateItems = input.state_items;

  if (output instanceof GeometryNodeSimulationOutput && input instanceof GeometryNodeSimulationInput) {
    runSimulationZone(input, output, interior, stateItems, cache, ctx);
  } else if (output instanceof GeometryNodeRepeatOutput && input instanceof GeometryNodeRepeatInput) {
    runRepeatZone(input, output, interior, stateItems, cache, ctx);
  } else if (output instanceof GeometryNodeForeachGeometryElementOutput && input instanceof GeometryNodeForeachGeometryElementInput) {
    runForeachZone(input, output, interior, stateItems, cache, ctx);
  } else {
    // Mismatched kinds — fall through to pass-through.
    for (let i = 0; i < stateItems.length; i++) {
      const inSock = output.inputs.find((s) => s.identifier === `in_${stateItems[i]!.identifier}`);
      const outSock = output.outputs.find((s) => s.identifier === stateItems[i]!.identifier);
      if (inSock && outSock) cache.set(outSock.id, ctx.socketValue(inSock, cache));
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Interior topology                                                 */
/* ------------------------------------------------------------------ */

/**
 * Collect interior nodes in topo order: nodes that are forward-reachable
 * from `input` AND backward-reachable from `output`, excluding `input` and
 * `output` themselves.
 */
function collectInterior(input: Node, output: Node, tree: NodeTree): Node[] {
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
  const interior = tree.nodes.filter((n) => n !== input && n !== output && fwd.has(n) && back.has(n));
  // Topo-sort the interior subset (Kahn's, restricted to interior links + links from input).
  return topoInterior(interior, input, tree);
}

function topoInterior(interior: Node[], input: Node, tree: NodeTree): Node[] {
  const inSet = new Set(interior);
  const indeg = new Map<Node, number>();
  for (const n of interior) indeg.set(n, 0);
  for (const l of tree.links) {
    if (!l.is_valid || l.is_muted) continue;
    if (!inSet.has(l.to_node)) continue;
    // Edges from `input` or from outside (constants flowing in) are
    // "external" — they don't contribute to interior indegree because their
    // source is already evaluated by the time we run interior.
    if (l.from_node === input) continue;
    if (!inSet.has(l.from_node)) continue;
    indeg.set(l.to_node, (indeg.get(l.to_node) ?? 0) + 1);
  }
  const q: Node[] = [];
  for (const n of interior) if ((indeg.get(n) ?? 0) === 0) q.push(n);
  const out: Node[] = [];
  while (q.length) {
    const n = q.shift()!;
    out.push(n);
    for (const l of tree.links) {
      if (l.from_node !== n) continue;
      if (!l.is_valid || l.is_muted) continue;
      if (!inSet.has(l.to_node)) continue;
      const d = (indeg.get(l.to_node) ?? 1) - 1;
      indeg.set(l.to_node, d);
      if (d === 0) q.push(l.to_node);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Simulation Zone                                                   */
/* ------------------------------------------------------------------ */

function runSimulationZone(
  input: GeometryNodeSimulationInput,
  output: GeometryNodeSimulationOutput,
  interior: Node[],
  items: import('./types').ZoneStateItem[],
  cache: Cache,
  ctx: ZoneEvalContext,
): void {
  const zoneId = input.zone_id;
  const cacheKey = `${ctx.tree.id}/${zoneId}`;
  let zCache = ctx.simCache.get(cacheKey);
  if (!zCache) {
    zCache = new SimZoneCache();
    ctx.simCache.set(cacheKey, zCache);
  }
  const frame = ctx.scene.frame;

  // Frame already cached? Replay it.
  const cached = zCache.get(frame);
  if (cached) {
    writeFinalState(output, items, cached, cache);
    writeSimMetaOutputs(input, 0, ctx.scene, cache);
    return;
  }

  let state: ZoneState;
  let dt = 0;
  if (zCache.lastFrame === undefined) {
    // First evaluation of this zone — read initial state from the Input's
    // external (lower row) inputs.
    state = readInitialState(input, items, cache, ctx);
  } else {
    state = { ...zCache.get(zCache.lastFrame)! };
    dt = (frame - zCache.lastFrame) / Math.max(1, ctx.scene.fps);
  }

  const iterCtx: ZoneIterContext = {
    zone_id: zoneId, zone_kind: 'SIM',
    iteration: 0, total: 1,
    delta_time: dt,
    scene_time: ctx.scene,
  };
  // Seed the input's interior outputs (top row) with the current state.
  seedInputOutputs(input, items, state, cache);
  // Also seed the meta outputs (Delta Time / Elapsed Time).
  writeSimMetaOutputs(input, dt, ctx.scene, cache);

  // Run the interior.
  for (const n of interior) ctx.runOne(n, cache, iterCtx);

  // Pull the new state from Output's interior inputs.
  const newState = collectOutputState(output, items, cache, ctx);
  zCache.put(frame, newState);
  writeFinalState(output, items, newState, cache);
}

function writeSimMetaOutputs(input: GeometryNodeSimulationInput, dt: number, scene: SceneTime, cache: Cache): void {
  const dtSock = input.outputs.find((s) => s.identifier === '__delta_time');
  const elSock = input.outputs.find((s) => s.identifier === '__elapsed_time');
  if (dtSock) cache.set(dtSock.id, constField(dt, 'FLOAT'));
  if (elSock) cache.set(elSock.id, constField(scene.elapsed, 'FLOAT'));
}

/* ------------------------------------------------------------------ */
/*  Repeat Zone                                                       */
/* ------------------------------------------------------------------ */

function runRepeatZone(
  input: GeometryNodeRepeatInput,
  output: GeometryNodeRepeatOutput,
  interior: Node[],
  items: import('./types').ZoneStateItem[],
  cache: Cache,
  ctx: ZoneEvalContext,
): void {
  const itSock = input.inputs.find((s) => s.identifier === '__iterations');
  const N = Math.max(0, Math.floor(itSock ? (ctx.socketSingle<number>(itSock, cache, Geometry.empty()) || 0) : 0));

  let state = readInitialState(input, items, cache, ctx);

  for (let i = 0; i < N; i++) {
    const iterCtx: ZoneIterContext = {
      zone_id: input.zone_id, zone_kind: 'REPEAT',
      iteration: i, total: N,
    };
    seedInputOutputs(input, items, state, cache);
    // Iteration index output
    const itOut = input.outputs.find((s) => s.identifier === '__iteration');
    if (itOut) cache.set(itOut.id, constField(i, 'INT'));
    for (const n of interior) ctx.runOne(n, cache, iterCtx);
    state = collectOutputState(output, items, cache, ctx);
  }

  writeFinalState(output, items, state, cache);
}

/* ------------------------------------------------------------------ */
/*  Foreach Element Zone                                              */
/* ------------------------------------------------------------------ */

function runForeachZone(
  input: GeometryNodeForeachGeometryElementInput,
  output: GeometryNodeForeachGeometryElementOutput,
  interior: Node[],
  items: import('./types').ZoneStateItem[],
  cache: Cache,
  ctx: ZoneEvalContext,
): void {
  // The "main" geometry is the first state item if it's a geometry.
  const mainItem = items[0];
  const mainSock = mainItem ? input.inputs.find((s) => s.identifier === `in_${mainItem.identifier}`) : undefined;
  const geo: Geometry = (mainSock ? (ctx.socketValue(mainSock, cache) as Geometry) : Geometry.empty()) ?? Geometry.empty();
  const domain = input.domain;
  const N = geo.domainSize(domain);

  // Per-iteration we collect new state values, then aggregate. For now we
  // join all geometry outputs and accumulate scalars / vectors via concat.
  const collected: ZoneState[] = [];
  for (let i = 0; i < N; i++) {
    const iterCtx: ZoneIterContext = {
      zone_id: input.zone_id, zone_kind: 'FOREACH',
      iteration: i, total: N,
      element_index: i, domain,
    };
    // Seed input top row with the per-element slice of state. For geometry,
    // the per-element slice is "the full geometry" (downstream selection
    // does the filtering); for scalars, the element value.
    const perElement: ZoneState = {};
    for (const it of items) perElement[it.identifier] = sliceForElement(geo, domain, i, it, cache, input);
    seedInputOutputs(input, items, perElement, cache);
    const idxOut = input.outputs.find((s) => s.identifier === '__element_index');
    if (idxOut) cache.set(idxOut.id, constField(i, 'INT'));
    for (const n of interior) ctx.runOne(n, cache, iterCtx);
    collected.push(collectOutputState(output, items, cache, ctx));
  }

  // Aggregate: join geometry items via `joinGeometries`; for scalar/vector
  // items, output the *last* iteration's value (Blender's Foreach Output also
  // collects "Generation Items" but defaults to per-iteration geometry join).
  const aggregated: ZoneState = {};
  for (const it of items) {
    const slices = collected.map((s) => s[it.identifier]);
    if (it.socket_type === 'NodeSocketGeometry') {
      const geos = slices.filter((g): g is Geometry => g instanceof Geometry);
      aggregated[it.identifier] = geos.length === 0 ? Geometry.empty() : joinGeometries(geos);
    } else {
      aggregated[it.identifier] = slices[slices.length - 1];
    }
  }
  writeFinalState(output, items, aggregated, cache);
}

/**
 * For a single element of the input geometry, produce the "current value" of
 * a state item. For geometry, this is the full geometry (selection happens
 * inside the zone); for scalar/vector items, look up the corresponding input
 * socket on the Input node.
 */
function sliceForElement(
  geo: Geometry,
  _domain: import('./types').AttributeDomain,
  _i: number,
  item: import('./types').ZoneStateItem,
  cache: Cache,
  input: GeoZoneInputBase,
): unknown {
  if (item.socket_type === 'NodeSocketGeometry') return geo;
  const sock = input.inputs.find((s) => s.identifier === `in_${item.identifier}`);
  if (!sock) return defaultValueFor({ default_value: 0 } as NodeSocket);
  return cacheReadOrDefault(sock, cache);
}

/* ------------------------------------------------------------------ */
/*  State plumbing helpers                                            */
/* ------------------------------------------------------------------ */

function readInitialState(
  input: GeoZoneInputBase,
  items: import('./types').ZoneStateItem[],
  cache: Cache,
  ctx: ZoneEvalContext,
): ZoneState {
  const state: ZoneState = {};
  for (const it of items) {
    const sock = input.inputs.find((s) => s.identifier === `in_${it.identifier}`);
    if (!sock) { state[it.identifier] = defaultValueFor({ default_value: undefined } as NodeSocket); continue; }
    if (it.socket_type === 'NodeSocketGeometry') {
      state[it.identifier] = (ctx.socketValue(sock, cache) as Geometry) ?? Geometry.empty();
    } else {
      state[it.identifier] = ctx.socketValue(sock, cache);
    }
  }
  return state;
}

/** Seed the Input node's *interior* outputs (top row) with current state. */
function seedInputOutputs(
  input: GeoZoneInputBase,
  items: import('./types').ZoneStateItem[],
  state: ZoneState,
  cache: Cache,
): void {
  for (const it of items) {
    const outSock = input.outputs.find((s) => s.identifier === it.identifier);
    if (!outSock) continue;
    const v = state[it.identifier];
    // For non-geometry items, wrap literals in a Field so downstream field
    // consumers behave naturally.
    if (it.socket_type === 'NodeSocketGeometry') {
      cache.set(outSock.id, v ?? Geometry.empty());
    } else {
      cache.set(outSock.id, isFieldLike(v) ? v : liftLiteralAsField(v, it.socket_type));
    }
  }
}

function isFieldLike(v: unknown): v is Field {
  return !!v && typeof v === 'object' && 'kind' in (v as object) && typeof (v as Field).eval === 'function';
}

function liftLiteralAsField(v: unknown, socket_type: string): Field {
  const kind = socket_type === 'NodeSocketVector' ? 'VECTOR'
    : socket_type === 'NodeSocketColor' ? 'COLOR'
    : socket_type === 'NodeSocketInt' ? 'INT'
    : socket_type === 'NodeSocketBool' ? 'BOOL'
    : 'FLOAT';
  if (typeof v === 'number') return constField(v, kind);
  if (typeof v === 'boolean') return constField(v, 'BOOL');
  if (Array.isArray(v)) return constField(v as number[], kind);
  return constField(0, kind);
}

function collectOutputState(
  output: GeoZoneOutputBase,
  items: import('./types').ZoneStateItem[],
  cache: Cache,
  ctx: ZoneEvalContext,
): ZoneState {
  const state: ZoneState = {};
  for (const it of items) {
    const sock = output.inputs.find((s) => s.identifier === `in_${it.identifier}`);
    if (!sock) { state[it.identifier] = undefined; continue; }
    if (it.socket_type === 'NodeSocketGeometry') {
      state[it.identifier] = (ctx.socketValue(sock, cache) as Geometry) ?? Geometry.empty();
    } else {
      state[it.identifier] = ctx.socketValue(sock, cache);
    }
  }
  return state;
}

function writeFinalState(
  output: GeoZoneOutputBase,
  items: import('./types').ZoneStateItem[],
  state: ZoneState,
  cache: Cache,
): void {
  for (const it of items) {
    const sock = output.outputs.find((s) => s.identifier === it.identifier);
    if (!sock) continue;
    const v = state[it.identifier];
    if (it.socket_type === 'NodeSocketGeometry') {
      cache.set(sock.id, v ?? Geometry.empty());
    } else {
      cache.set(sock.id, isFieldLike(v) ? v : liftLiteralAsField(v, it.socket_type));
    }
  }
}

function cacheReadOrDefault(sock: NodeSocket, cache: Cache): unknown {
  if (sock.is_linked) {
    const link = sock.links[0];
    if (link && !link.is_muted && !link.escapes_zone) {
      const v = cache.get(link.from_socket.id);
      if (v !== undefined) return v;
    }
  }
  return sock.default_value;
}

function defaultValueFor(sock: NodeSocket): unknown {
  return sock.default_value;
}
