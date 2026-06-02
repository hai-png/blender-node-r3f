/**
 * CPU compositor — a small reference evaluator that runs the *pixel-wise*
 * compositor graph for a single pixel (or solid-color image) entirely on the
 * CPU. It exists so the pixel math can be verified headlessly (no WebGL),
 * complementing the GPU `ShaderOperation` path.
 *
 * Scope: constant inputs (RGB / Value nodes), pixel-wise color/converter
 * nodes, and the Composite / Viewer / Split Viewer outputs. Kernel nodes
 * (Blur, Glare, distort) and external image textures are not evaluated here
 * (they need neighbourhood / GPU sampling); when one is encountered the
 * affected branch falls back to its input unchanged. This mirrors Blender's
 * "single value" CPU shortcut for constant subtrees.
 */
import type { NodeTree } from '../../core/NodeTree';
import type { Node } from '../../core/Node';
import type { NodeSocket } from '../../core/NodeSocket';
import { flattenTree, flatTopoOrder, type FlatLink } from '../flatten';

export type RGBA = [number, number, number, number];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

interface CpuCtx {
  src: Map<NodeSocket, FlatLink>;
  cache: Map<string /* socket.id */, RGBA>;
}

/** Resolve a node's input socket to an RGBA (uses upstream or its default). */
function inputRGBA(node: Node, identifier: string, ctx: CpuCtx): RGBA {
  const sock = node.inputs.find((s) => s.identifier === identifier) ?? node.inputs.find((s) => s.name === identifier);
  if (!sock) return [0, 0, 0, 1];
  const link = ctx.src.get(sock);
  if (link) {
    const v = ctx.cache.get(link.from_socket.id);
    if (v) return v;
  }
  return toRGBA(sock.default_value);
}

function toRGBA(v: unknown): RGBA {
  if (typeof v === 'number') return [v, v, v, 1];
  if (Array.isArray(v)) {
    const n = (i: number, d: number): number => (typeof v[i] === 'number' ? v[i] : d);
    if (v.length >= 4) return [n(0, 0), n(1, 0), n(2, 0), n(3, 1)];
    if (v.length === 3) return [n(0, 0), n(1, 0), n(2, 0), 1];
    if (v.length === 1) return [n(0, 0), n(0, 0), n(0, 0), 1];
  }
  return [0, 0, 0, 1];
}

function scalar(node: Node, identifier: string, ctx: CpuCtx): number {
  return inputRGBA(node, identifier, ctx)[0];
}

function mixBlend(blend: string, a: RGBA, b: RGBA, f: number): RGBA {
  const t = clamp01(f);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  let r: RGBA;
  switch (blend) {
    case 'ADD': r = [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3]]; break;
    case 'MULTIPLY': r = [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3]]; break;
    case 'SUBTRACT': r = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3]]; break;
    case 'DIVIDE': r = [b[0] ? a[0] / b[0] : 0, b[1] ? a[1] / b[1] : 0, b[2] ? a[2] / b[2] : 0, a[3]]; break;
    case 'SCREEN': r = [1 - (1 - a[0]) * (1 - b[0]), 1 - (1 - a[1]) * (1 - b[1]), 1 - (1 - a[2]) * (1 - b[2]), a[3]]; break;
    default: r = b; // MIX uses straight b then lerp below
  }
  return [lerp(a[0], r[0]), lerp(a[1], r[1]), lerp(a[2], r[2]), a[3]];
}

function evalNode(node: Node, ctx: CpuCtx): void {
  const id = node.bl_idname;
  const set = (sockName: string, val: RGBA) => {
    const out = node.outputs.find((s) => s.identifier === sockName) ?? node.outputs.find((s) => s.name === sockName) ?? node.outputs[0];
    if (out) ctx.cache.set(out.id, val);
  };
  switch (id) {
    case 'CompositorNodeRGB': {
      const out0 = node.outputs[0];
      const v = (out0?.default_value as number[]) ?? [1, 1, 1, 1];
      if (out0) ctx.cache.set(out0.id, toRGBA(v));
      return;
    }
    case 'CompositorNodeValue': {
      const out0 = node.outputs[0];
      const v = (out0?.default_value as number) ?? 0.5;
      if (out0) ctx.cache.set(out0.id, [v, v, v, 1]);
      return;
    }
    case 'CompositorNodeMixRGB': {
      const blend = (node as unknown as { blend_type?: string }).blend_type ?? 'MIX';
      const fac = scalar(node, 'Fac', ctx);
      const a = inputRGBA(node, 'Image', ctx);
      const b = inputRGBA(node, 'Image_001', ctx);
      let out = mixBlend(blend, a, b, fac);
      if ((node as unknown as { use_clamp?: boolean }).use_clamp) out = out.map(clamp01) as RGBA;
      set('Image', out); return;
    }
    case 'CompositorNodeInvert': {
      const fac = scalar(node, 'Fac', ctx);
      const c = inputRGBA(node, 'Color', ctx);
      const inv: RGBA = [1 - c[0], 1 - c[1], 1 - c[2], c[3]];
      set('Color', [c[0] + (inv[0] - c[0]) * fac, c[1] + (inv[1] - c[1]) * fac, c[2] + (inv[2] - c[2]) * fac, c[3]]); return;
    }
    case 'CompositorNodeGamma': {
      const c = inputRGBA(node, 'Image', ctx); const g = scalar(node, 'Gamma', ctx) || 1;
      set('Image', [Math.pow(Math.max(c[0], 0), g), Math.pow(Math.max(c[1], 0), g), Math.pow(Math.max(c[2], 0), g), c[3]]); return;
    }
    case 'CompositorNodeBrightContrast': {
      const c = inputRGBA(node, 'Image', ctx);
      const bright = scalar(node, 'Bright', ctx); const contrast = scalar(node, 'Contrast', ctx);
      const a = 1 + contrast / 100; const b = bright / 100 + 0.5 * (1 - a);
      set('Image', [c[0] * a + b, c[1] * a + b, c[2] * a + b, c[3]]); return;
    }
    case 'CompositorNodeExposure': {
      const c = inputRGBA(node, 'Image', ctx); const e = Math.pow(2, scalar(node, 'Exposure', ctx));
      set('Image', [c[0] * e, c[1] * e, c[2] * e, c[3]]); return;
    }
    case 'CompositorNodePosterize': {
      const c = inputRGBA(node, 'Image', ctx); const steps = Math.max(scalar(node, 'Steps', ctx), 1);
      set('Image', [Math.floor(c[0] * steps) / steps, Math.floor(c[1] * steps) / steps, Math.floor(c[2] * steps) / steps, c[3]]); return;
    }
    case 'CompositorNodeMapRange': {
      const v = scalar(node, 'Value', ctx);
      const fmin = scalar(node, 'From Min', ctx), fmax = scalar(node, 'From Max', ctx);
      const tmin = scalar(node, 'To Min', ctx), tmax = scalar(node, 'To Max', ctx);
      let t = fmax - fmin !== 0 ? (v - fmin) / (fmax - fmin) : 0;
      if ((node as unknown as { use_clamp?: boolean }).use_clamp !== false) t = clamp01(t);
      const r = tmin + t * (tmax - tmin);
      set('Value', [r, r, r, 1]); return;
    }
    case 'CompositorNodeCombineColor': {
      const mode = (node as unknown as { mode?: string }).mode ?? 'RGB';
      const r = scalar(node, 'Red', ctx), g = scalar(node, 'Green', ctx), b = scalar(node, 'Blue', ctx), a = scalar(node, 'Alpha', ctx);
      if (mode === 'HSV') { const [rr, gg, bb] = hsv2rgb(r, g, b); set('Image', [rr, gg, bb, a]); }
      else set('Image', [r, g, b, a]);
      return;
    }
    case 'CompositorNodeSeparateColor': {
      const mode = (node as unknown as { mode?: string }).mode ?? 'RGB';
      const c = inputRGBA(node, 'Image', ctx);
      const comps: [number, number, number] = mode === 'HSV' ? rgb2hsv(c[0], c[1], c[2]) : [c[0], c[1], c[2]];
      set('Red', [comps[0], comps[0], comps[0], 1]);
      set('Green', [comps[1], comps[1], comps[1], 1]);
      set('Blue', [comps[2], comps[2], comps[2], 1]);
      set('Alpha', [c[3], c[3], c[3], 1]);
      return;
    }
    case 'CompositorNodeRGBToBW': {
      const c = inputRGBA(node, 'Image', ctx); const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      set('Val', [l, l, l, 1]); return;
    }
    case 'CompositorNodeValToRGB': {
      const f = clamp01(scalar(node, 'Fac', ctx)); set('Image', [f, f, f, 1]); return;
    }
    case 'CompositorNodeMath': {
      const op = (node as unknown as { operation?: string }).operation ?? 'ADD';
      const a = scalar(node, 'Value', ctx); const b = scalar(node, 'Value_001', ctx);
      let r = 0;
      switch (op) {
        case 'ADD': r = a + b; break; case 'SUBTRACT': r = a - b; break;
        case 'MULTIPLY': r = a * b; break; case 'DIVIDE': r = b ? a / b : 0; break;
        case 'POWER': r = Math.pow(a, b); break; case 'MINIMUM': r = Math.min(a, b); break;
        case 'MAXIMUM': r = Math.max(a, b); break; default: r = a + b;
      }
      set('Value', [r, r, r, 1]); return;
    }
    default: {
      // Unknown / kernel node: pass primary image input through unchanged.
      const img = inputRGBA(node, 'Image', ctx);
      set('Image', img);
    }
  }
}

/**
 * Evaluate the compositor tree on the CPU for a constant (solid-color) frame.
 * Returns the RGBA reaching the Composite (or Viewer) output, or null if
 * there is no output node.
 */
export function cpuComposite(tree: NodeTree): RGBA | null {
  const flat = flattenTree(tree);
  const src = new Map<NodeSocket, FlatLink>();
  for (const l of flat.links) src.set(l.to_socket, l);
  const ctx: CpuCtx = { src, cache: new Map() };
  const order = flatTopoOrder(flat);
  for (const n of order) {
    if (n.mute) {
      const links = n.computeInternalLinks();
      for (const out of n.outputs) {
        const inSock = links.get(out.id);
        const v = inSock ? (src.get(inSock) ? ctx.cache.get(src.get(inSock)!.from_socket.id) : toRGBA(inSock.default_value)) : undefined;
        ctx.cache.set(out.id, v ?? toRGBA(out.default_value));
      }
      continue;
    }
    if (n.bl_idname === 'CompositorNodeComposite' || n.bl_idname === 'CompositorNodeViewer' || n.bl_idname === 'CompositorNodeSplitViewer') continue;
    evalNode(n, ctx);
  }
  const out = order.find((n) => n.bl_idname === 'CompositorNodeComposite')
    ?? order.find((n) => n.bl_idname === 'CompositorNodeViewer');
  if (!out) return null;
  return inputRGBA(out, 'Image', ctx);
}
