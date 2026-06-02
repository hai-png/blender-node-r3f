/**
 * TexturePool — recycles WebGLRenderTargets across a single evaluation.
 *
 * The compositor often allocates many transient images (one per Operation
 * output). Re-creating WebGLRenderTargets each time is expensive; this pool
 * keeps a small LRU keyed by `${width}x${height}x${format}`.
 *
 * Usage:
 *   const t = pool.acquire(1024, 1024);
 *   ...render to t...
 *   pool.release(t);
 *
 * Released targets can be recycled by the next `acquire()` with matching
 * dimensions. The pool grows lazily and shrinks via `prune()` (called by
 * `CompositorEvaluator.dispose()`).
 */
import * as THREE from 'three';

interface PoolEntry {
  key: string;
  target: THREE.WebGLRenderTarget;
  inUse: boolean;
}

export class TexturePool {
  private entries: PoolEntry[] = [];
  /** Targets created via `acquireOwned` aren't returned to the pool. */
  private owned: Set<THREE.WebGLRenderTarget> = new Set();

  constructor(
    private defaults: {
      format?: THREE.PixelFormat;
      type?: THREE.TextureDataType;
      minFilter?: THREE.MinificationTextureFilter;
      magFilter?: THREE.MagnificationTextureFilter;
      wrap?: THREE.Wrapping;
    } = {},
  ) {}

  /** Acquire a recycled or freshly-allocated target. */
  acquire(width: number, height: number, customKey?: string): THREE.WebGLRenderTarget {
    const key = customKey ?? `${width}x${height}`;
    for (const e of this.entries) {
      if (!e.inUse && e.key === key) {
        e.inUse = true;
        return e.target;
      }
    }
    const t = this.create(width, height);
    this.entries.push({ key, target: t, inUse: true });
    return t;
  }

  /** Acquire a target that will never be recycled (e.g. the final output). */
  acquireOwned(width: number, height: number): THREE.WebGLRenderTarget {
    const t = this.create(width, height);
    this.owned.add(t);
    return t;
  }

  /** Mark a previously-acquired target as free. No-op for owned targets. */
  release(t: THREE.WebGLRenderTarget): void {
    if (this.owned.has(t)) return;
    for (const e of this.entries) {
      if (e.target === t) { e.inUse = false; return; }
    }
  }

  /** Drop all GPU resources. */
  dispose(): void {
    for (const e of this.entries) e.target.dispose();
    for (const t of this.owned) t.dispose();
    this.entries = [];
    this.owned.clear();
  }

  private create(width: number, height: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(width, height, {
      format: this.defaults.format ?? THREE.RGBAFormat,
      type: this.defaults.type ?? THREE.UnsignedByteType,
      minFilter: this.defaults.minFilter ?? THREE.LinearFilter,
      magFilter: this.defaults.magFilter ?? THREE.LinearFilter,
      wrapS: this.defaults.wrap ?? THREE.ClampToEdgeWrapping,
      wrapT: this.defaults.wrap ?? THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }
}
