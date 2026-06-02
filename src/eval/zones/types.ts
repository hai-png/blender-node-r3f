/**
 * Cross-cutting types for the zone subsystem.
 * See docs/ARCHITECTURE.md §10 and docs/RESEARCH.md §6 for the zone design.
 */
import type { AttributeDomain } from '../../core/types';

export type ZoneKind = 'SIM' | 'REPEAT' | 'FOREACH';

/** A single typed slot in a zone's loop state. */
export interface ZoneStateItem {
  /** Stable identifier (rename-safe). Used by Capture-style attribute reads too. */
  identifier: string;
  /** User-visible label. */
  name: string;
  /** Blender socket bl_idname, e.g. 'NodeSocketGeometry'. */
  socket_type: string;
}

/** A snapshot of zone state — one value per state item, keyed by identifier. */
export type ZoneState = Record<string, unknown>;

/** Scene-level clock state, owned by the Depsgraph. */
export interface SceneTime {
  /** Integer frame number, starting at 1 like Blender. */
  frame: number;
  /** Frames per second (used to compute Delta Time). */
  fps: number;
  /** Wall-clock elapsed seconds since the simulation start. */
  elapsed: number;
}

export const DEFAULT_SCENE_TIME: SceneTime = { frame: 1, fps: 24, elapsed: 0 };

/** Per-frame snapshot used by a Simulation Zone's cache. */
export interface SimFrameSnapshot {
  frame: number;
  state: ZoneState;
}

/** One Simulation Zone's per-tree cache. */
export class SimZoneCache {
  /** Sparse by frame number → state. */
  frames = new Map<number, ZoneState>();
  /** Highest frame we've evaluated; used to detect rewind / first-frame. */
  lastFrame: number | undefined;

  put(frame: number, state: ZoneState): void {
    this.frames.set(frame, state);
    if (this.lastFrame === undefined || frame > this.lastFrame) this.lastFrame = frame;
  }
  get(frame: number): ZoneState | undefined { return this.frames.get(frame); }
  has(frame: number): boolean { return this.frames.has(frame); }
  /** Invalidate everything ≥ `frame` — used when the user edits a node upstream. */
  invalidateFrom(frame: number): void {
    for (const f of [...this.frames.keys()]) if (f >= frame) this.frames.delete(f);
    if (this.lastFrame !== undefined && this.lastFrame >= frame) {
      // recompute lastFrame
      let max = -Infinity;
      for (const f of this.frames.keys()) if (f > max) max = f;
      this.lastFrame = isFinite(max) ? max : undefined;
    }
  }
  clear(): void { this.frames.clear(); this.lastFrame = undefined; }
}

/** Per-iteration context information available to nodes inside a zone. */
export interface ZoneIterContext {
  zone_id: string;
  zone_kind: ZoneKind;
  /** 0-based iteration index. */
  iteration: number;
  /** Total iterations (Repeat) or domain size (Foreach), or 1 (Sim). */
  total: number;
  /** SIM only: seconds since the previous evaluation (0 on the first frame). */
  delta_time?: number;
  /** SIM only: scene time at this iteration. */
  scene_time?: SceneTime;
  /** FOREACH only: which element of the input geometry we're on. */
  element_index?: number;
  /** FOREACH only: which domain we're iterating. */
  domain?: AttributeDomain;
}

export { type AttributeDomain };
