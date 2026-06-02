/**
 * Compositor runtime types. Mirrors Blender's `Result` + `Operation` design
 * (see docs/M5_COMPOSITOR.md).
 *
 * A `Result` is the output of one operation, either an image (a
 * WebGLRenderTarget) or a single scalar/vector/colour value. Operations
 * consume Results from their inputs and produce Results on their outputs.
 *
 * The Result is intentionally opaque about *which* renderer owns the
 * target — the texture-pool layer is responsible for allocating + recycling
 * targets and the evaluator passes them along.
 */
import type {
  WebGLRenderTarget, WebGLRenderer, Texture,
  // We only need types here — actual class refs come from the texture-pool / runner.
} from 'three';

export type Vec3 = [number, number, number];
export type RGBA = [number, number, number, number];

/** A single compositor value. Either an image or a constant. */
export type Result =
  | { kind: 'IMAGE'; target: WebGLRenderTarget; width: number; height: number; channel?: 0 | 1 | 2 | 3 }
  | { kind: 'VALUE'; value: number }
  | { kind: 'COLOR'; value: RGBA }
  | { kind: 'VECTOR'; value: Vec3 };

export function valueResult(v: number): Result { return { kind: 'VALUE', value: v }; }
export function colorResult(c: RGBA): Result { return { kind: 'COLOR', value: c }; }
export function vectorResult(v: Vec3): Result { return { kind: 'VECTOR', value: v }; }

/**
 * Returns the image dimensions implied by a Result. For non-image kinds,
 * returns the context's default size.
 */
export function dimsOf(r: Result | undefined, fallback: [number, number]): [number, number] {
  if (r && r.kind === 'IMAGE') return [r.width, r.height];
  return fallback;
}

/** Execution context — passed to every Operation. */
export interface ExecContext {
  renderer: WebGLRenderer;
  width: number;
  height: number;
  /** Per-evaluation map keeping a Result alive until the end of the eval. */
  resultsByOpId: Map<string, Map<string /*output identifier*/, Result>>;
  /** Acquire a transient image target. Released by the pool when its
   *  reference count drops to zero. */
  acquireImage(w: number, h: number): WebGLRenderTarget;
  /** Release a previously-acquired transient target. */
  releaseImage(target: WebGLRenderTarget): void;
  /** Shared fullscreen quad (geometry + camera) for rendering passes. */
  fsQuad: { render(renderer: WebGLRenderer): void; material: unknown };
  /** Switch the fullscreen quad's material before rendering. */
  setQuadMaterial(material: unknown): void;
}

/**
 * Outputs are addressed by a stable identifier (matches the Blender socket
 * identifier). Most operations have a single 'Image' output.
 */
export type OutputMap = Map<string, Result>;

/** A single compiled operation. */
export interface Operation {
  /** Diagnostic id, usually the source node's id (or `cluster:n` for fused units). */
  id: string;
  /** Human-readable label for inspection. */
  label: string;
  /**
   * Inputs the operation reads. Resolved by the runner before `execute()`:
   * the runner walks back through `bindings` to fetch the upstream Result.
   */
  bindings: OpInputBinding[];
  /** Run one frame of this operation. Returns one Result per output identifier. */
  execute(ctx: ExecContext, inputs: Map<string, Result>): OutputMap;
  /** Optional: drop GPU resources owned by this operation (compiled shaders…). */
  dispose?(): void;
}

/** Where each input socket's value comes from. */
export interface OpInputBinding {
  /** Identifier of *this* operation's input slot (matches its consumer socket). */
  toIdentifier: string;
  /** Which prior Operation produces the upstream value (undefined → default). */
  fromOpId?: string;
  /** Which of the upstream's outputs we read. */
  fromIdentifier?: string;
  /** Default value if the binding is unresolved (e.g. unlinked socket). */
  default: Result;
}

/** The final payload bundled into `EvaluationResult.output`. */
export interface EvaluatedComposite {
  /** Final image (from Composite), displayable as a THREE.Texture. */
  texture: Texture | null;
  width: number;
  height: number;
  /** Optional Viewer preview, if a Viewer node was present. */
  viewer: Texture | null;
  /** Operations executed, in order. Useful for inspection. */
  operations: { id: string; label: string; ms: number }[];
  /** True when the evaluator fell back to its headless CPU emulator. */
  headless: boolean;
  /** Constant final RGBA from the CPU evaluator (headless path only). */
  cpuColor?: [number, number, number, number] | null;
}
