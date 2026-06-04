/**
 * EvalError — structured evaluation errors replacing the old
 * `Map<string, string>` pattern.
 *
 * Each error carries:
 *  - severity: WARN (non-fatal, default fallback used) or ERROR (node failed)
 *  - nodeId / nodeName: which node produced the error
 *  - code: a stable machine-readable key for programmatic handling
 *  - message: human-readable description
 */

import type { Node } from '../core/Node';

export type ErrorSeverity = 'WARN' | 'ERROR';

export interface EvalError {
  severity: ErrorSeverity;
  nodeId: string;
  nodeName: string;
  code: string;
  message: string;
  /** Optional detail payload (stack, intermediate values, etc.). */
  detail?: unknown;
}

/**
 * Collection of evaluation errors with deduplication by (nodeId, code).
 */
export class EvalErrorSet {
  private _errors = new Map<string, EvalError>();

  get size(): number { return this._errors.size; }

  [Symbol.iterator](): IterableIterator<EvalError> {
    return this._errors.values();
  }

  add(err: EvalError): void {
    const key = `${err.nodeId}/${err.code}`;
    if (!this._errors.has(key)) this._errors.set(key, err);
  }

  warn(node: Node, code: string, message: string, detail?: unknown): void {
    this.add({
      severity: 'WARN', nodeId: node.id,
      nodeName: node.name || node.bl_idname,
      code, message, detail,
    });
  }

  error(node: Node, code: string, message: string, detail?: unknown): void {
    this.add({
      severity: 'ERROR', nodeId: node.id,
      nodeName: node.name || node.bl_idname,
      code, message, detail,
    });
  }

  hasErrors(): boolean {
    for (const e of this._errors.values()) if (e.severity === 'ERROR') return true;
    return false;
  }

  hasOnlyWarnings(): boolean {
    for (const e of this._errors.values()) if (e.severity === 'ERROR') return false;
    return this._errors.size > 0;
  }

  toLegacyMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const e of this._errors.values()) {
      m.set(e.nodeId, `[${e.severity}] ${e.code}: ${e.message}`);
    }
    return m;
  }

  toArray(): readonly EvalError[] {
    return [...this._errors.values()];
  }

  clear(): void {
    this._errors.clear();
  }
}

export const ErrorCode = {
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  MISSING_INPUT: 'MISSING_INPUT',
  TYPE_MISMATCH: 'TYPE_MISMATCH',
  INVALID_PROPERTY: 'INVALID_PROPERTY',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  ZONE_FAILURE: 'ZONE_FAILURE',
  INVALID_GEOMETRY: 'INVALID_GEOMETRY',
  MISSING_RESOURCE: 'MISSING_RESOURCE',
  INTERNAL: 'INTERNAL',
  MUTED_PASSTHROUGH: 'MUTED_PASSTHROUGH',
} as const;