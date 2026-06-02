/**
 * NodeExecute — registry-based dispatch replacing the massive instanceof chain.
 *
 * Each node class can register an `execute` function via `registerExecutor()`.
 * Evaluators call `dispatchNode(node, cache, ctx)` which looks up the registered
 * function by bl_idname. Falls back to the node's own `executeGeo`/`executeShader`
 * method, or a default pass-through.
 *
 * This is the shared infrastructure that all evaluators should use for common
 * nodes (Math, VectorMath, Mix, MapRange, Clamp, ColorRamp, Curves, etc.).
 */

import type { Node } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';

/** A value cache keyed by socket.id. */
export type ValueCache = Map<string, unknown>;

/** Minimal context shared across all evaluators. */
export interface ExecCtx {
  /** Resolve a socket's current value (from cache or default). */
  socketValue: (socket: NodeSocket, cache: ValueCache) => unknown;
  /** Force-resolve a socket to a single scalar value. */
  socketSingle?: <T>(socket: NodeSocket, cache: ValueCache) => T;
}

/** An executor function. Writes output values into the cache. */
export type NodeExecutor = (node: Node, cache: ValueCache, ctx: ExecCtx) => void;

// Global registry: bl_idname → executor
const executors = new Map<string, NodeExecutor>();

/**
 * Register an executor function for a given bl_idname.
 * Node classes should call this from their registration function.
 */
export function registerExecutor(bl_idname: string, fn: NodeExecutor): void {
  executors.set(bl_idname, fn);
}

/**
 * Look up a registered executor. Returns undefined if none registered.
 */
export function getExecutor(bl_idname: string): NodeExecutor | undefined {
  return executors.get(bl_idname);
}

/**
 * Execute a node using the registry. Returns true if an executor was found
 * and ran, false otherwise.
 */
export function dispatchNode(node: Node, cache: ValueCache, ctx: ExecCtx): boolean {
  const fn = executors.get(node.bl_idname);
  if (fn) {
    fn(node, cache, ctx);
    return true;
  }
  // Check for custom execute method on the node instance.
  const custom = (node as unknown as { executeGeo?: NodeExecutor }).executeGeo;
  if (typeof custom === 'function') {
    // Wrap to match the simpler executeGeo signature
    const geoCtx: ExecCtx & Record<string, unknown> = {
      ...ctx,
      node,
      inputField: (name: string) => {
        const sock = node.inputs.find((x) => x.identifier === name || x.name === name);
        return sock ? ctx.socketValue(sock, cache) : 0;
      },
      inputValue: (name: string) => {
        const sock = node.inputs.find((x) => x.identifier === name || x.name === name);
        return sock ? ctx.socketValue(sock, cache) : undefined;
      },
      setOutputField: (name: string, value: unknown) => {
        const sock = node.outputs.find((x) => x.identifier === name || x.name === name);
        if (sock) cache.set(sock.id, value);
      },
      setOutputValue: (name: string, value: unknown) => {
        const sock = node.outputs.find((x) => x.identifier === name || x.name === name);
        if (sock) cache.set(sock.id, value);
      },
    };
    (custom as (ctx: unknown) => void)(geoCtx);
    return true;
  }
  return false;
}

/**
 * Default fallback: propagate default values to all outputs.
 */
export function defaultExecute(node: Node, cache: ValueCache, _ctx: ExecCtx): void {
  for (const out of node.outputs) {
    if (!cache.has(out.id)) {
      cache.set(out.id, out.default_value);
    }
  }
}
