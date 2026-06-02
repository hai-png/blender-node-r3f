/**
 * Depsgraph — incremental re-evaluation driver.
 *
 * For each NodeTree, exactly one Depsgraph is created. When a node or any
 * of its upstream dependencies changes, the depsgraph marks the node and
 * everything downstream as dirty. The next call to `evaluate()` runs the
 * system-specific evaluator over the dirty subset (or the whole tree on
 * first run).
 *
 * The actual per-system evaluator is plugged in via `setEvaluator()` so
 * this module stays free of dependencies on three.js or any specific
 * system code.
 *
 * Since M4: also owns scene-time + simulation caches so Simulation Zones
 * persist state across evaluate() calls.
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import { DEFAULT_SCENE_TIME, SimZoneCache, type SceneTime } from './zones/types';

export interface SystemEvaluator {
  /** Called whenever the tree must be re-evaluated. Returns an arbitrary result. */
  evaluate(tree: NodeTree, dirty: ReadonlySet<Node>): EvaluationResult;
}

export interface EvaluationResult {
  /** System-specific payload. Shader: NodeMaterial; Geometry: Geometry; etc. */
  output: unknown;
  /** Total wall-clock evaluation time (ms). */
  duration_ms: number;
  /** Per-node evaluation times for inspection. */
  node_timings: Map<string /* node.id */, number /* ms */>;
  /** Errors raised during evaluation, keyed by node id. */
  errors: Map<string, string>;
}

export type DepsgraphListener = (result: EvaluationResult) => void;

export class Depsgraph {
  private _dirty: Set<Node> = new Set();
  private _evaluator?: SystemEvaluator;
  private _listeners = new Set<DepsgraphListener>();
  private _scheduled = false;
  private _lastResult?: EvaluationResult;

  /** Scene clock; updated by the animation driver via `setScene()`. */
  scene: SceneTime = { ...DEFAULT_SCENE_TIME };
  /** Per-zone simulation caches, keyed by `zone_id`. Survives evaluate() calls. */
  simCache: Map<string, SimZoneCache> = new Map();

  constructor(public tree: NodeTree) {}

  /** Unsubscribe function for the tree event listener installed by setEvaluator. */
  private _treeUnsub?: () => void;

  setEvaluator(ev: SystemEvaluator): void {
    // Unsubscribe from the previous evaluator's tree listener.
    this._treeUnsub?.();
    this._evaluator = ev;
    // When topology changes (add/remove node or link), clear the evaluator's
    // persistent output cache so stale socket IDs don't haunt future evals.
    const topologicalEvents = new Set([
      'node_added', 'node_removed', 'link_added', 'link_removed',
    ]);
    this._treeUnsub = this.tree.subscribe((_tree, ev) => {
      if (!topologicalEvents.has(ev.type)) return;
      const e = this._evaluator as { clearPersistentCache?(): void } | undefined;
      e?.clearPersistentCache?.();
    });
    this.invalidateAll();
  }

  /** Mark `node` and all downstream dependents dirty. */
  invalidate(node: Node): void {
    if (this._dirty.has(node)) return;
    this._dirty.add(node);
    for (const link of this.tree.links) {
      if (link.from_node === node) this.invalidate(link.to_node);
    }
    this.schedule();
  }

  invalidateAll(): void {
    for (const n of this.tree.nodes) this._dirty.add(n);
    this.schedule();
  }

  /**
   * Update the scene clock (frame, fps, elapsed). Triggers re-evaluation;
   * existing simulation caches are *preserved* so playback works. To rewind,
   * call `resetSimulation()` first.
   */
  setScene(partial: Partial<SceneTime>): void {
    const before = this.scene;
    this.scene = { ...before, ...partial };
    // If the user rewinds before a cached frame, invalidate the trailing tail
    // of every sim cache so the simulation restarts cleanly from that point.
    if (partial.frame !== undefined && partial.frame < before.frame) {
      for (const c of this.simCache.values()) c.invalidateFrom(partial.frame);
    }
    this.invalidateAll();
  }

  /** Wipe all simulation caches. Call when the user explicitly resets. */
  resetSimulation(): void {
    for (const c of this.simCache.values()) c.clear();
    this.simCache.clear();
    this.scene = { ...DEFAULT_SCENE_TIME };
    this.invalidateAll();
  }

  private schedule(): void {
    if (this._scheduled) return;
    this._scheduled = true;
    queueMicrotask(() => {
      this._scheduled = false;
      this.evaluate();
    });
  }

  evaluate(): EvaluationResult | undefined {
    if (!this._evaluator) return undefined;
    const dirty = this._dirty;
    this._dirty = new Set();
    const result = this._evaluator.evaluate(this.tree, dirty);
    // Detect and report cycles: NodeTree.topoOrder() annotates cycleNodes.
    const order = this.tree.topoOrder() as ReturnType<typeof this.tree.topoOrder> & { cycleNodes?: import('../core/Node').Node[] };
    if (order.cycleNodes && order.cycleNodes.length > 0) {
      const names = order.cycleNodes.map((n) => n.name || n.bl_idname).join(', ');
      result.errors.set('__cycle__', `Cycle detected involving nodes: ${names}. Blender forbids cycles — evaluation is partial.`);
    }
    this._lastResult = result;
    for (const fn of this._listeners) fn(result);
    return result;
  }

  on(_event: 'evaluated', cb: DepsgraphListener): () => void {
    this._listeners.add(cb);
    if (this._lastResult) cb(this._lastResult);
    return () => this._listeners.delete(cb);
  }

  /**
   * Release all listeners, evaluator, and caches.
   * Called automatically by `NodeTree.dispose()`.
   */
  dispose(): void {
    this._treeUnsub?.();
    this._treeUnsub = undefined;
    this._listeners.clear();
    this._evaluator = undefined;
    this._dirty.clear();
    this.simCache.clear();
    this._scheduled = false;
  }
}
