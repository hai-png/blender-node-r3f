/**
 * Public re-export for the compositor evaluator.
 *
 * The actual implementation lives in `./compositor/` so that the M0 plan-only
 * stub can sit alongside the M5 full WebGL pipeline without one shadowing
 * the other. Callers should keep using:
 *
 *   import { CompositorEvaluator } from 'blender-nodes-r3f';
 */
export {
  CompositorEvaluator,
  type CompositorEvaluatorOptions,
} from './compositor/CompositorEvaluator';
export type { EvaluatedComposite, Result } from './compositor/types';

/**
 * Legacy plan-only output (M0). Kept for compatibility with any consumers
 * that wrote against the original CompositorPlan / CompositorPlanStep
 * shape; the new evaluator produces `EvaluatedComposite` instead.
 */
export interface CompositorPlan {
  steps: CompositorPlanStep[];
  width: number;
  height: number;
}
export interface CompositorPlanStep {
  node: import('../core/Node').Node;
  op: string;
  params: Record<string, unknown>;
}
