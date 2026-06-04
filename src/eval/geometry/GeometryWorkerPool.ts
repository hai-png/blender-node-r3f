/**
 * GeometryWorkerPool — offloads heavy geometry operations to Web Workers.
 *
 * Workers run `geometry.worker.js` (subdivision, merge-by-distance, blur).
 * Falls back to synchronous MeshOps when Workers are unavailable (SSR, Node).
 *
 * Usage:
 *   const pool = new GeometryWorkerPool();
 *   try {
 *     const result = await pool.subdivide(positions, triangles, 2);
 *   } catch {
 *     // fall back to MeshOps sync path
 *   }
 *   pool.dispose();
 */

/* ── Message types ---------------------------------------------── */

interface WorkerResultPayload {
  positions: ArrayBuffer;
  triangles: ArrayBuffer;
  values?: ArrayBuffer;
}

interface PendingTask {
  resolve: (r: WorkerResultPayload) => void;
  reject: (err: Error) => void;
}

/* ── Pool ------------------------------------------------------── */

export class GeometryWorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, PendingTask>();
  private nextId = 1;
  private nextWorker = 0;
  readonly fallback: boolean;

  constructor(numWorkers?: number) {
    const count = numWorkers ?? Math.min(
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2, 4,
    );
    this.fallback = typeof Worker === 'undefined';

    if (!this.fallback) {
      try {
        // Resolve the worker script path relative to this module.
        // In a bundled build this needs to be a separate chunk.
        const workerUrl = new URL('./workers/geometry.worker.js', import.meta.url);
        for (let i = 0; i < count; i++) {
          const w = new Worker(workerUrl, { type: 'module' });
          w.onmessage = (e: MessageEvent) => {
            const d = e.data as { type: string; id: number } & WorkerResultPayload & { message?: string };
            const task = this.pending.get(d.id);
            if (!task) return;
            this.pending.delete(d.id);
            if (d.type === 'error') task.reject(new Error(d.message));
            else task.resolve({ positions: d.positions, triangles: d.triangles, values: d.values });
          };
          w.onerror = () => { /* worker died — subsequent ops fall back */ };
          this.workers.push(w);
        }
      } catch {
        this.fallback = true;
      }
    }
  }

  private _send(op: Record<string, unknown>, transfer: ArrayBuffer[]): Promise<WorkerResultPayload> {
    if (this.workers.length === 0) throw new Error('no workers available');
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const w = this.workers[this.nextWorker % this.workers.length]!;
      this.nextWorker++;
      w.postMessage({ ...op, id }, transfer);
    });
  }

  private static bufOf(arr: Float32Array | Uint32Array): ArrayBuffer {
    return (arr.buffer as ArrayBuffer).slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
  }

  async subdivide(
    positions: Float32Array, triangles: Uint32Array, levels: number,
  ): Promise<{ positions: Float32Array; triangles: Uint32Array }> {
    if (this.fallback || this.workers.length === 0) throw new Error('sync fallback');
    const pb = GeometryWorkerPool.bufOf(positions);
    const tb = GeometryWorkerPool.bufOf(triangles);
    const r = await this._send({ type: 'subdivide', positions: pb, triangles: tb, levels }, [pb, tb]);
    return { positions: new Float32Array(r.positions), triangles: new Uint32Array(r.triangles) };
  }

  async mergeByDistance(
    positions: Float32Array, triangles: Uint32Array, distance: number,
  ): Promise<{ positions: Float32Array; triangles: Uint32Array }> {
    if (this.fallback || this.workers.length === 0) throw new Error('sync fallback');
    const pb = GeometryWorkerPool.bufOf(positions);
    const tb = GeometryWorkerPool.bufOf(triangles);
    const r = await this._send({ type: 'mergeByDistance', positions: pb, triangles: tb, distance }, [pb, tb]);
    return { positions: new Float32Array(r.positions), triangles: new Uint32Array(r.triangles) };
  }

  async blurAttribute(
    positions: Float32Array, triangles: Uint32Array, values: Float32Array, iterations: number,
  ): Promise<{ values: Float32Array }> {
    if (this.fallback || this.workers.length === 0) throw new Error('sync fallback');
    const pb = GeometryWorkerPool.bufOf(positions);
    const tb = GeometryWorkerPool.bufOf(triangles);
    const vb = GeometryWorkerPool.bufOf(values);
    const r = await this._send({ type: 'blurAttribute', positions: pb, triangles: tb, values: vb, iterations }, [pb, tb, vb]);
    return { values: new Float32Array(r.values!) };
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
  }
}