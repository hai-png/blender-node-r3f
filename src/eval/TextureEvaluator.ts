/**
 * TextureEvaluator (M6) — compiles a TextureNodeTree into a per-sample
 * callback `(u, v) => RGBA` and can bake the result to a THREE.DataTexture.
 *
 * Each node contributes one or more typed sampler closures keyed by output
 * socket id. Field/value sockets resolve to scalar samplers, color sockets to
 * RGBA samplers. Group + reroute are handled via the shared flatten utility.
 */
import type { NodeTree } from '../core/NodeTree';
import type { Node } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';
import type { SystemEvaluator, EvaluationResult } from './Depsgraph';
import type { RGBA, Vec3 } from '../core/types';
import { flattenTree, flatTopoOrder, type FlatLink } from './flatten';

export type SampleFn = (u: number, v: number) => RGBA;
type ScalarFn = (u: number, v: number) => number;
type VectorFn = (u: number, v: number) => Vec3;

/* ---- noise helpers ---- */
function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * sm(t);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}
function voronoi(x: number, y: number, manhattan: boolean): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = Infinity;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const cx = xi + di, cy = yi + dj;
    const px = cx + hash2(cx, cy), py = cy + hash2(cy, cx);
    const dx = px - x, dy = py - y;
    const d = manhattan ? Math.abs(dx) + Math.abs(dy) : Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return Math.min(best, 1);
}

interface Ctx {
  src: Map<NodeSocket, FlatLink>;
  color: Map<string, SampleFn>;
  scalar: Map<string, ScalarFn>;
  vector: Map<string, VectorFn>;
}

function inColor(node: Node, name: string, ctx: Ctx): SampleFn {
  const sock = node.inputs.find((s) => s.identifier === name) ?? node.inputs.find((s) => s.name === name);
  if (sock) {
    const link = ctx.src.get(sock);
    if (link) {
      const f = ctx.color.get(link.from_socket.id)
        ?? toColorFn(ctx.scalar.get(link.from_socket.id))
        ?? vectorToColorFn(ctx.vector.get(link.from_socket.id));
      if (f) return f;
    }
    const dv = sock.default_value;
    if (Array.isArray(dv)) { const c: RGBA = [Number(dv[0] ?? 0), Number(dv[1] ?? 0), Number(dv[2] ?? 0), Number(dv[3] ?? 1)]; return () => c; }
  }
  return () => [0, 0, 0, 1];
}
function inScalar(node: Node, name: string, ctx: Ctx): ScalarFn {
  const sock = node.inputs.find((s) => s.identifier === name) ?? node.inputs.find((s) => s.name === name);
  if (sock) {
    const link = ctx.src.get(sock);
    if (link) {
      const f = ctx.scalar.get(link.from_socket.id)
        ?? toScalarFn(ctx.color.get(link.from_socket.id))
        ?? vectorToScalarFn(ctx.vector.get(link.from_socket.id));
      if (f) return f;
    }
    const dv = sock.default_value;
    if (typeof dv === 'number') return () => dv;
    if (Array.isArray(dv)) return () => Number(dv[0] ?? 0);
  }
  return () => 0;
}
function inVector(node: Node, name: string, ctx: Ctx): VectorFn {
  const sock = node.inputs.find((s) => s.identifier === name) ?? node.inputs.find((s) => s.name === name);
  if (sock) {
    const link = ctx.src.get(sock);
    if (link) {
      const f = ctx.vector.get(link.from_socket.id)
        ?? colorToVectorFn(ctx.color.get(link.from_socket.id))
        ?? scalarToVectorFn(ctx.scalar.get(link.from_socket.id));
      if (f) return f;
    }
    const dv = sock.default_value;
    // Preserve the original convenient behavior for unconnected procedural
    // coordinate sockets: Blender texture nodes implicitly sample over the
    // current coordinates. A non-zero explicit default is treated as a
    // constant vector so users/tests can intentionally pin coordinates.
    if (Array.isArray(dv) && dv.some((x) => Number(x) !== 0)) {
      const vec: Vec3 = [Number(dv[0] ?? 0), Number(dv[1] ?? 0), Number(dv[2] ?? 0)];
      return () => vec;
    }
  }
  return (u, v) => [u, v, 0];
}
function toColorFn(f?: ScalarFn): SampleFn | undefined { return f ? (u, v) => { const x = f(u, v); return [x, x, x, 1]; } : undefined; }
function toScalarFn(f?: SampleFn): ScalarFn | undefined { return f ? (u, v) => f(u, v)[0] : undefined; }
function vectorToColorFn(f?: VectorFn): SampleFn | undefined { return f ? (u, v) => { const x = f(u, v); return [x[0], x[1], x[2], 1]; } : undefined; }
function vectorToScalarFn(f?: VectorFn): ScalarFn | undefined { return f ? (u, v) => f(u, v)[0] : undefined; }
function colorToVectorFn(f?: SampleFn): VectorFn | undefined { return f ? (u, v) => { const c = f(u, v); return [c[0], c[1], c[2]]; } : undefined; }
function scalarToVectorFn(f?: ScalarFn): VectorFn | undefined { return f ? (u, v) => { const x = f(u, v); return [x, x, x]; } : undefined; }

export class TextureEvaluator implements SystemEvaluator {
  evaluate(tree: NodeTree, _dirty: ReadonlySet<Node>): EvaluationResult {
    const start = performance.now();
    const flat = flattenTree(tree);
    const src = new Map<NodeSocket, FlatLink>();
    for (const l of flat.links) src.set(l.to_socket, l);
    const ctx: Ctx = { src, color: new Map(), scalar: new Map(), vector: new Map() };

    const setColor = (n: Node, name: string, f: SampleFn) => {
      const o = n.outputs.find((s) => s.identifier === name) ?? n.outputs.find((s) => s.name === name);
      if (o) ctx.color.set(o.id, f);
    };
    const setScalar = (n: Node, name: string, f: ScalarFn) => {
      const o = n.outputs.find((s) => s.identifier === name) ?? n.outputs.find((s) => s.name === name);
      if (o) ctx.scalar.set(o.id, f);
    };
    const setVector = (n: Node, name: string, f: VectorFn) => {
      const o = n.outputs.find((s) => s.identifier === name) ?? n.outputs.find((s) => s.name === name);
      if (o) ctx.vector.set(o.id, f);
    };

    for (const node of flatTopoOrder(flat)) {
      const id = node.bl_idname;
      const p = node as unknown as Record<string, number | string>;
      switch (id) {
        case 'TextureNodeCoordinates':
          setVector(node, 'Coordinates', (u, v) => [u, v, 0]);
          setColor(node, 'Coordinates', (u, v) => [u, v, 0, 1]);
          break;
        case 'TextureNodeNoise': {
          const scale = Number(p.scale ?? 5);
          const coords = inVector(node, 'Coords', ctx);
          const f: ScalarFn = (u, v) => { const [x, y] = coords(u, v); return valueNoise(x * scale, y * scale); };
          setColor(node, 'Color', (u, v) => { const x = f(u, v); return [x, x, x, 1]; });
          setScalar(node, 'Fac', f);
          break;
        }
        case 'TextureNodeChecker': {
          const coords = inVector(node, 'Coords', ctx);
          const c1 = inColor(node, 'Color 1', ctx), c2 = inColor(node, 'Color 2', ctx), sc = inScalar(node, 'Scale', ctx);
          setColor(node, 'Color', (u, v) => {
            const [x, y] = coords(u, v);
            const s = sc(u, v) || 5; const cx = Math.floor(x * s), cy = Math.floor(y * s);
            return ((cx + cy) % 2 === 0) ? c1(u, v) : c2(u, v);
          });
          break;
        }
        case 'TextureNodeVoronoi': {
          const coords = inVector(node, 'Coords', ctx);
          const scale = Number(p.scale ?? 5); const man = p.metric === 'MANHATTAN';
          const f: ScalarFn = (u, v) => { const [x, y] = coords(u, v); return voronoi(x * scale, y * scale, man); };
          setColor(node, 'Color', (u, v) => { const x = f(u, v); return [x, x, x, 1]; });
          setScalar(node, 'Distance', f);
          break;
        }
        case 'TextureNodeWave': {
          const coords = inVector(node, 'Coords', ctx);
          const scale = Number(p.scale ?? 5), dist = Number(p.distortion ?? 0); const rings = p.wave_type === 'RINGS';
          const f: ScalarFn = (u, v) => {
            const [x, y] = coords(u, v);
            const base = rings ? Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) * scale : (x + y) * scale * 0.5;
            const n = dist ? valueNoise(x * scale, y * scale) * dist : 0;
            return 0.5 + 0.5 * Math.sin((base + n) * Math.PI * 2);
          };
          setColor(node, 'Color', (u, v) => { const x = f(u, v); return [x, x, x, 1]; });
          setScalar(node, 'Fac', f);
          break;
        }
        case 'TextureNodeMagic': {
          const coords = inVector(node, 'Coords', ctx);
          const scale = Number(p.scale ?? 5), depth = Number(p.depth ?? 2);
          setColor(node, 'Color', (u, v) => {
            const [cu, cv] = coords(u, v);
            let x = cu * scale, y = cv * scale, r = Math.sin(x + y), g = Math.cos(x - y), b = Math.sin(x * y);
            for (let i = 0; i < depth; i++) { const nx = Math.sin(y + r); const ny = Math.cos(x + g); x = nx; y = ny; r = Math.sin(x + y); g = Math.cos(x - y); b = Math.sin(x * y); }
            return [0.5 + 0.5 * r, 0.5 + 0.5 * g, 0.5 + 0.5 * b, 1];
          });
          break;
        }
        case 'TextureNodeBlend': {
          const coords = inVector(node, 'Coords', ctx);
          const prog = String(p.progression ?? 'LINEAR');
          setColor(node, 'Color', (u, v) => {
            const [x, y] = coords(u, v);
            let t = x;
            if (prog === 'RADIAL') t = Math.atan2(y - 0.5, x - 0.5) / (Math.PI * 2) + 0.5;
            else if (prog === 'QUADRATIC') t = x * x;
            t = Math.max(0, Math.min(1, t));
            return [t, t, t, 1];
          });
          break;
        }
        case 'TextureNodeImage': {
          // No real image decode headlessly yet; emit a coordinate gradient so
          // linked Coordinates still affect the placeholder deterministically.
          const coords = inVector(node, 'Coords', ctx);
          setColor(node, 'Color', (u, v) => { const [x, y] = coords(u, v); return [x, y, 0.5, 1]; });
          break;
        }
        case 'TextureNodeMath': {
          const a = inScalar(node, 'Value', ctx), b = inScalar(node, 'Value_001', ctx); const op = String(p.operation ?? 'ADD');
          setScalar(node, 'Value', (u, v) => {
            const x = a(u, v), y = b(u, v);
            switch (op) {
              case 'SUBTRACT': return x - y; case 'MULTIPLY': return x * y;
              case 'DIVIDE': return y ? x / y : 0; case 'POWER': return Math.pow(x, y);
              case 'MINIMUM': return Math.min(x, y); case 'MAXIMUM': return Math.max(x, y);
              default: return x + y;
            }
          });
          break;
        }
        case 'TextureNodeMixRGB': {
          const fac = inScalar(node, 'Fac', ctx), c1 = inColor(node, 'Color1', ctx), c2 = inColor(node, 'Color2', ctx); const blend = String(p.blend_type ?? 'MIX');
          setColor(node, 'Color', (u, v) => {
            const t = Math.max(0, Math.min(1, fac(u, v))); const a = c1(u, v), b = c2(u, v);
            const mixCh = (x: number, y: number) => blend === 'ADD' ? x + y * t : blend === 'MULTIPLY' ? x * (1 - t) + x * y * t : x + (y - x) * t;
            return [mixCh(a[0], b[0]), mixCh(a[1], b[1]), mixCh(a[2], b[2]), a[3]];
          });
          break;
        }
        case 'TextureNodeValToRGB': {
          const fac = inScalar(node, 'Fac', ctx);
          setColor(node, 'Color', (u, v) => { const x = Math.max(0, Math.min(1, fac(u, v))); return [x, x, x, 1]; });
          setScalar(node, 'Alpha', () => 1);
          break;
        }
        default:
          break;
      }
    }

    const root = flat.nodes.find((n) => n.bl_idname === 'TextureNodeOutput');
    let sample: SampleFn = () => [0, 0, 0, 1];
    if (root) {
      const inSock = root.inputs[0];
      const link = inSock ? src.get(inSock) : undefined;
      if (link) {
        const f = ctx.color.get(link.from_socket.id)
          ?? toColorFn(ctx.scalar.get(link.from_socket.id))
          ?? vectorToColorFn(ctx.vector.get(link.from_socket.id));
        if (f) sample = f;
      } else if (inSock && Array.isArray(inSock.default_value)) {
        const dv = inSock.default_value as number[]; const c: RGBA = [Number(dv[0] ?? 0), Number(dv[1] ?? 0), Number(dv[2] ?? 0), Number(dv[3] ?? 1)];
        sample = () => c;
      }
    }

    return {
      output: sample,
      duration_ms: performance.now() - start,
      node_timings: new Map(),
      errors: new Map(),
    };
  }
}

/**
 * Bake a sampler to a THREE.DataTexture of `size`×`size` RGBA8.
 * Returns the texture; caller is responsible for disposal.
 */
export function bakeToDataTexture(
  sample: SampleFn,
  size = 128,
  THREE: typeof import('three'),
): import('three').DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const c = sample(u, v);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(c[0] * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(c[2] * 255)));
      data[i + 3] = Math.max(0, Math.min(255, Math.round(c[3] * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}
