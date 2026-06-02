# M4 — Zones (Simulation / Repeat / Foreach Element)

> Implementation notes for Blender's three special "zone" node patterns.

## 1. What a zone is

A **zone** is a paired Input/Output node pair forming a closed sub-graph. The zone interior:

- Receives an **initial state** from the Input node's external inputs
- Iterates / re-evaluates the Output's incoming values back into the Input on the next step
- Exposes a **typed list of state items** that defines the shape of the loop

Each zone type has different semantics for *when* and *how often* the interior runs:

| Zone | Trigger | Iteration | Persistent state |
|---|---|---|---|
| **Simulation** | Scene/clock tick | Once per frame | Yes — cached across frames |
| **Repeat** | Tree evaluation | N times (Iterations) | No — purely functional |
| **Foreach Element** | Tree evaluation | Per element on a domain of an input geometry | No |

## 2. The pairing rule

Blender uses `bNode.identifier` (a stable int per node) as the **zone_id**. We use a string id and store it as a property on both nodes. Creating a zone via the UI always creates both nodes with matching zone_ids; nodes that lose their pair render as "dangling" but don't crash.

```ts
// shared marker on both Input and Output of a zone
interface ZoneNode {
  zone_id: string;     // matches the partner
  // Input nodes are also the place where state items are authored.
  state_items?: ZoneStateItem[];
}
```

## 3. State items

A **state item** is one typed slot in the loop carrier. Every state item generates a pair of sockets:

- On Input: one **external input** (initial value) + one **interior output** (current value)
- On Output: one **interior input** (next-step value) + one **external output** (final value, after all iterations / on the current frame)

```ts
type SocketType =
  | 'NodeSocketGeometry' | 'NodeSocketFloat' | 'NodeSocketInt'
  | 'NodeSocketVector'   | 'NodeSocketColor' | 'NodeSocketBool'
  | 'NodeSocketRotation' | 'NodeSocketMatrix';

interface ZoneStateItem {
  identifier: string;
  name: string;
  socket_type: SocketType;
}
```

The UI lets the user add/remove/reorder items via a sidebar panel. Adding the first item happens automatically when you drag a link onto the empty "+" socket.

## 4. The link-escape rule

> Links may go *into* a zone freely, but the only way out is through the Output node.

We enforce this at `NodeTree.addLink()`:

```ts
// pseudo
const fromZone = zoneOf(from.node);
const toZone   = zoneOf(to.node);
if (fromZone && fromZone !== toZone && !(from.node instanceof ZoneOutputNode)) {
  // invalid - mark link red, evaluator will skip it
  link.escapes_zone = true;
}
```

The evaluator skips escape links so the user can still see the malformed link but won't get garbage outputs.

## 5. Evaluation algorithm

We extend the existing `GeometryEvaluator.topoOrder()` walk: zones are **black boxes** at the outer level. When the evaluator reaches a zone Output node, it triggers the appropriate **ZoneRunner** which:

1. Snapshots the external inputs of the Input node
2. Constructs an **interior sub-evaluator** over the zone's interior nodes (everything topologically *between* Input and Output, plus any pure-from-outside nodes the Output transitively depends on)
3. Runs the zone-specific loop body
4. Writes results to the Output node's external outputs

### 5.1 Repeat Zone

```ts
function runRepeatZone(zone) {
  const N    = max(0, evalSocket(zone.input.iterations));
  let state  = readInitialState(zone.input);            // map<identifier, value>
  for (let i = 0; i < N; i++) {
    setIterationContext(i, N);
    state = runInterior(zone, state);                   // returns map<identifier, value>
  }
  writeFinalState(zone.output, state);
}
```

### 5.2 Foreach Element Zone

```ts
function runForeachZone(zone) {
  const inputGeo = evalSocket(zone.input.geometry);
  const domain   = zone.domain;                          // POINT / EDGE / FACE / …
  const N        = inputGeo.domainSize(domain);
  const collected: Value[] = [];
  for (let i = 0; i < N; i++) {
    setIterationContext(i, N, /*element=*/i, /*geometry=*/inputGeo);
    const state = runInterior(zone, readPerElementState(zone.input, inputGeo, i));
    collected.push(state);
  }
  writeAggregatedState(zone.output, collected);
}
```

### 5.3 Simulation Zone

```ts
function runSimulationZone(zone, ctx /* SimContext */) {
  const cacheKey = `${ctx.tree.id}/${zone.zone_id}`;
  const cache    = ctx.simCache.get(cacheKey) ?? new SimZoneCache();
  const frame    = ctx.scene.frame;

  // Cached frame? Return immediately.
  if (cache.has(frame)) {
    writeFinalState(zone.output, cache.get(frame));
    return;
  }
  // Initial frame: read initial state from Input's external inputs.
  let state: ZoneState;
  let dt = 0;
  if (cache.lastFrame === undefined) {
    state = readInitialState(zone.input);
  } else {
    state = cache.get(cache.lastFrame)!;
    dt = (frame - cache.lastFrame) / ctx.scene.fps;
  }
  setSimulationContext(dt, ctx.elapsed);
  state = runInterior(zone, state);
  cache.put(frame, state);
  cache.lastFrame = frame;
  writeFinalState(zone.output, state);
}
```

The `SimContext` carries scene frame/fps and a per-evaluator cache. The cache is keyed by `tree.id + zone_id` so multiple instances of the same tree (e.g. linked across scenes) get independent caches.

## 6. Public API additions

```ts
// src/eval/zones/types.ts
export interface ZoneState { [identifier: string]: unknown; }
export interface SceneTime { frame: number; fps: number; elapsed: number; }
export interface SimCache  { get(k: string): SimZoneCache | undefined; … }

// src/eval/Depsgraph.ts (extended)
class Depsgraph {
  /** Per-tree simulation cache; survives across evaluate() calls. */
  simCache = new Map<string, SimZoneCache>();
  /** Current frame + fps + elapsed-since-start; the demo's animation
   *  driver updates this then calls invalidateAll(). */
  setScene(time: Partial<SceneTime>): void;
}
```

## 7. Node specs

```
GeometryNodeSimulationInput   {static node_kind='ZONE_INPUT'; static zone_kind='SIM'   }
GeometryNodeSimulationOutput  {static node_kind='ZONE_OUTPUT'; static zone_kind='SIM'  }
GeometryNodeRepeatInput       {static node_kind='ZONE_INPUT'; static zone_kind='REPEAT'}
GeometryNodeRepeatOutput      {static node_kind='ZONE_OUTPUT'; static zone_kind='REPEAT'}
GeometryNodeForeachGeometryElementInput   {... 'FOREACH'}
GeometryNodeForeachGeometryElementOutput  {... 'FOREACH'}
```

Each zone Input class exposes `state_items: ZoneStateItem[]` (default `[{identifier:'Geometry', name:'Geometry', socket_type:'NodeSocketGeometry'}]`) and a static helper to rebuild its sockets from the items.

## 8. Convenience: `NodeTree.addZone()`

```ts
const { input, output } = tree.addZone('REPEAT');   // also: 'SIM' | 'FOREACH'
```

Creates both nodes already paired, default state items wired, positions offset so they don't overlap, and the default `Geometry → Geometry` link in place.

## 9. Demo: a simple particle simulation

A 30-line test fixture exercises all the moving pieces:

```
[ Mesh Cube (1)] → Sim Input.Geometry  →  Set Position (offset = Velocity × Delta)  → Sim Output.Geometry
                                                                                   →  Sim Output (cache)
```

Frame stepping is driven by the demo's UI; each tick advances `Depsgraph.setScene({frame})` and re-evaluates. The cube's verts drift outward over time; resetting clears the cache.
