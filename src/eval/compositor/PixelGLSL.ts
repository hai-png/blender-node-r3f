/**
 * Pixel-wise GLSL fragments — one per pixel-wise compositor node.
 *
 * Each function takes the names of its already-bound inputs (variables or
 * uniforms in the host fragment shader) and returns either a colour or a
 * float expression.
 *
 * Used by the planner's `ShaderOperation` to assemble fused fragment shaders
 * from a chain of pixel-wise nodes.
 *
 * Conventions
 * -----------
 *   - All node outputs are vec4 unless their socket is FLOAT (then we still
 *     emit them as scalar-via-vec4.r so downstream consumers can blanket-cast).
 *   - Inputs are accessed by `slot.id` (the unique input identifier on the
 *     downstream node, e.g. `Image`, `Image_001`, `Fac`, `Value`, …).
 *   - We always produce a single vec4 result expression even for scalar
 *     outputs; the planner unpacks `.r` for scalar consumers.
 */
import type { Node } from '../../core/Node';

/** Environment passed to a pixel-wise emitter. */
export interface PixelEnv {
  /** GLSL expression yielding a vec4 (for color inputs) or vec4(x,x,x,x) (for scalar). */
  input(identifier: string): string;
  /** Name of an existing GLSL float uniform from a node property. */
  uniformFloat(name: string, defaultValue: number): string;
  /** Generate a unique variable name within the fused shader (avoids collisions). */
  unique(prefix: string): string;
}

/** Returns a GLSL expression yielding vec4 for `node`'s primary output. */
export type PixelEmitter = (node: Node, env: PixelEnv) => string;

/* ------------------------------------------------------------------ */
/*  Helpers used inside emitter snippets                              */
/* ------------------------------------------------------------------ */

/** Lerp between two colors with a scalar factor. */
const _mix = (a: string, b: string, f: string) => `mix(${a}, ${b}, clamp(${f}, 0.0, 1.0))`;

/* ------------------------------------------------------------------ */
/*  Emitter table                                                     */
/* ------------------------------------------------------------------ */

export const PIXEL_EMITTERS: Record<string, PixelEmitter> = {
  // ---------- Mix RGB ----------
  CompositorNodeMixRGB: (node, env) => {
    const blend = (node as unknown as { blend_type: string }).blend_type ?? 'MIX';
    const clamp = (node as unknown as { use_clamp: boolean }).use_clamp ? true : false;
    const fac = env.input('Fac');
    const a = env.input('Image');
    const b = env.input('Image_001');
    let blended: string;
    switch (blend) {
      case 'ADD':       blended = `${a} + ${b}`; break;
      case 'MULTIPLY':  blended = `${a} * ${b}`; break;
      case 'SUBTRACT':  blended = `${a} - ${b}`; break;
      case 'DIVIDE':    blended = `vec4(${b}.r != 0.0 ? ${a}.r / ${b}.r : 0.0, ${b}.g != 0.0 ? ${a}.g / ${b}.g : 0.0, ${b}.b != 0.0 ? ${a}.b / ${b}.b : 0.0, ${a}.a)`; break;
      case 'SCREEN':    blended = `vec4(1.0) - (vec4(1.0) - ${a}) * (vec4(1.0) - ${b})`; break;
      case 'OVERLAY':   blended = `mix(2.0 * ${a} * ${b}, vec4(1.0) - 2.0 * (vec4(1.0) - ${a}) * (vec4(1.0) - ${b}), step(0.5, ${a}))`; break;
      case 'DIFFERENCE':blended = `abs(${a} - ${b})`; break;
      case 'LIGHTEN':   blended = `max(${a}, ${b})`; break;
      case 'DARKEN':    blended = `min(${a}, ${b})`; break;
      default:          blended = `${b}`; // MIX
    }
    // Alpha is preserved from A, then mix A → blended by Fac
    const result = `vec4(mix(${a}.rgb, (${blended}).rgb, clamp((${fac}).r, 0.0, 1.0)), ${a}.a)`;
    return clamp ? `clamp(${result}, vec4(0.0), vec4(1.0))` : result;
  },

  // ---------- Brightness/Contrast ----------
  CompositorNodeBrightContrast: (_node, env) => {
    const img = env.input('Image');
    const bright = env.input('Bright');
    const contrast = env.input('Contrast');
    // Match the CPU evaluator and Blender-style percentage controls:
    // out = img * (1 + contrast/100) + bright/100 + 0.5 * (1 - (1 + contrast/100)).
    return `vec4(${img}.rgb * (1.0 + (${contrast}).r / 100.0) + (${bright}).r / 100.0 + 0.5 * (1.0 - (1.0 + (${contrast}).r / 100.0)), ${img}.a)`;
  },

  // ---------- Invert ----------
  CompositorNodeInvert: (node, env) => {
    const fac = env.input('Fac');
    const c = env.input('Color');
    const inv_rgb = (node as unknown as { invert_rgb: boolean }).invert_rgb !== false;
    const inv_a   = (node as unknown as { invert_alpha: boolean }).invert_alpha === true;
    const rgb = inv_rgb ? `mix(${c}.rgb, vec3(1.0) - ${c}.rgb, clamp((${fac}).r, 0.0, 1.0))` : `${c}.rgb`;
    const a   = inv_a   ? `mix(${c}.a,   1.0 - ${c}.a,        clamp((${fac}).r, 0.0, 1.0))` : `${c}.a`;
    return `vec4(${rgb}, ${a})`;
  },

  // ---------- Gamma ----------
  CompositorNodeGamma: (_node, env) => {
    const img = env.input('Image');
    const g = env.input('Gamma');
    return `vec4(pow(max(${img}.rgb, vec3(0.0)), vec3(max((${g}).r, 0.0001))), ${img}.a)`;
  },

  // ---------- Exposure ----------
  CompositorNodeExposure: (_node, env) => {
    const img = env.input('Image');
    const e = env.input('Exposure');
    return `vec4(${img}.rgb * pow(2.0, (${e}).r), ${img}.a)`;
  },

  // ---------- HSV ----------
  CompositorNodeHueSat: (_node, env) => {
    const img = env.input('Image');
    const fac = env.input('Fac');
    const h = env.input('Hue');
    const s = env.input('Saturation');
    const v = env.input('Value');
    // HSV transform: convert to HSV, offset, convert back, mix by Fac.
    return `(_hsv_apply(${img}, (${h}).r - 0.5, (${s}).r, (${v}).r, (${fac}).r))`;
  },

  // ---------- Alpha Over ----------
  CompositorNodeAlphaOver: (_node, env) => {
    const fac = env.input('Fac');
    const a = env.input('Image');
    const b = env.input('Image_001');
    // Standard premultiplied over: out = a * (1 - b.a*fac) + b * (b.a*fac)
    return `(${a} * (1.0 - (${b}).a * (${fac}).r) + ${b} * ((${b}).a * (${fac}).r))`;
  },

  // ---------- Set Alpha ----------
  CompositorNodeSetAlpha: (_node, env) => {
    const img = env.input('Image');
    const a = env.input('Alpha');
    return `vec4(${img}.rgb, (${a}).r)`;
  },

  // ---------- RGB to BW ----------
  CompositorNodeRGBToBW: (_node, env) => {
    const img = env.input('Image');
    // Standard luminance weights (Rec. 709).
    return `vec4(vec3(dot(${img}.rgb, vec3(0.2126, 0.7152, 0.0722))), ${img}.a)`;
  },

  // ---------- Math ----------
  CompositorNodeMath: (node, env) => {
    const op = (node as unknown as { operation: string }).operation ?? 'ADD';
    const clamp = (node as unknown as { use_clamp: boolean }).use_clamp ? true : false;
    const a = `(${env.input('Value')}).r`;
    const b = `(${env.input('Value_001')}).r`;
    let r: string;
    switch (op) {
      case 'ADD':         r = `(${a} + ${b})`; break;
      case 'SUBTRACT':    r = `(${a} - ${b})`; break;
      case 'MULTIPLY':    r = `(${a} * ${b})`; break;
      case 'DIVIDE':      r = `((${b}) != 0.0 ? (${a}) / (${b}) : 0.0)`; break;
      case 'POWER':       r = `pow(${a}, ${b})`; break;
      case 'MINIMUM':     r = `min(${a}, ${b})`; break;
      case 'MAXIMUM':     r = `max(${a}, ${b})`; break;
      case 'ABSOLUTE':    r = `abs(${a})`; break;
      case 'LESS_THAN':   r = `((${a}) < (${b}) ? 1.0 : 0.0)`; break;
      case 'GREATER_THAN':r = `((${a}) > (${b}) ? 1.0 : 0.0)`; break;
      case 'SINE':        r = `sin(${a})`; break;
      case 'COSINE':      r = `cos(${a})`; break;
      case 'SQRT':        r = `sqrt(max(${a}, 0.0))`; break;
      default:            r = `(${a} + ${b})`;
    }
    if (clamp) r = `clamp(${r}, 0.0, 1.0)`;
    return `vec4(vec3(${r}), 1.0)`;
  },

  // ---------- RGB / Value (literal inputs are handled by the planner;
  // these no-op emitters exist so the planner is happy when they show up
  // inside a fused chain.) ----------
  // ---------- Posterize ----------
  CompositorNodePosterize: (_node, env) => {
    const img = env.input('Image');
    const steps = `max(${env.input('Steps')}.r, 1.0)`;
    return `vec4(floor(${img}.rgb * ${steps}) / ${steps}, ${img}.a)`;
  },

  // ---------- Z Combine (front-most by depth) ----------
  CompositorNodeZcombine: (_node, env) => {
    const a = env.input('Image');
    const za = `${env.input('Z')}.r`;
    const b = env.input('Image_001');
    const zb = `${env.input('Z_001')}.r`;
    return `(${za} <= ${zb} ? ${a} : ${b})`;
  },

  // ---------- Map Range (linear, optional clamp) ----------
  CompositorNodeMapRange: (node, env) => {
    const v = `${env.input('Value')}.r`;
    const fmin = `${env.input('From Min')}.r`;
    const fmax = `${env.input('From Max')}.r`;
    const tmin = `${env.input('To Min')}.r`;
    const tmax = `${env.input('To Max')}.r`;
    const clampOn = (node as unknown as { use_clamp?: boolean }).use_clamp !== false;
    const denom = `(${fmax} - ${fmin})`;
    let t = `(${denom} != 0.0 ? (${v} - ${fmin}) / ${denom} : 0.0)`;
    if (clampOn) t = `clamp(${t}, 0.0, 1.0)`;
    const r = `(${tmin} + ${t} * (${tmax} - ${tmin}))`;
    return `vec4(vec3(${r}), 1.0)`;
  },

  // ---------- Combine Color ----------
  CompositorNodeCombineColor: (node, env) => {
    const mode = (node as unknown as { mode?: string }).mode ?? 'RGB';
    const r = `${env.input('Red')}.r`;
    const g = `${env.input('Green')}.r`;
    const b = `${env.input('Blue')}.r`;
    const a = `${env.input('Alpha')}.r`;
    if (mode === 'HSV') return `vec4(_hsv2rgb(vec3(${r}, ${g}, ${b})), ${a})`;
    return `vec4(${r}, ${g}, ${b}, ${a})`;
  },

  // ---------- Separate Color (primary output = Red, others handled as .g/.b/.a via planner) ----------
  CompositorNodeSeparateColor: (node, env) => {
    const mode = (node as unknown as { mode?: string }).mode ?? 'RGB';
    const img = env.input('Image');
    if (mode === 'HSV') return `vec4(_rgb2hsv(${img}.rgb), ${img}.a)`;
    return `${img}`;
  },

  // ---------- Color Ramp ----------
  CompositorNodeValToRGB: (node, env) => {
    const f = `clamp(${env.input('Fac')}.r, 0.0, 1.0)`;
    return rampExpression(node, f);
  },

  // ---------- Color Balance (CDL lift/gamma/gain) ----------
  CompositorNodeColorBalance: (node, env) => {
    const img = env.input('Image');
    const fac = env.input('Fac');
    // CDL model: Lift/Gamma/Gain per-channel (vec3 uniforms)
    // lift offsets shadows, gain scales highlights, gamma adjusts midtones.
    // CPU/GPU approximation using a simple power+offset model.
    const lift  = env.uniformFloat('u_lift_r',  (node as unknown as { lift_r?: number }).lift_r  ?? 0);
    const gain  = env.uniformFloat('u_gain_r',  (node as unknown as { gain_r?: number }).gain_r  ?? 1);
    const gamma = env.uniformFloat('u_gamma_r', (node as unknown as { gamma_r?: number }).gamma_r ?? 1);
    // Apply: out = (in * gain + lift) ^ (1/gamma)
    const s = `vec4(
      pow(max(0.0, ${img}.r * ${gain} + ${lift}), 1.0 / max(0.001, ${gamma})),
      pow(max(0.0, ${img}.g * ${gain} + ${lift}), 1.0 / max(0.001, ${gamma})),
      pow(max(0.0, ${img}.b * ${gain} + ${lift}), 1.0 / max(0.001, ${gamma})),
      ${img}.a)`;
    return `mix(${img}, ${s}, clamp(${fac}.r, 0.0, 1.0))`;
  },

  // ---------- Hue Correct (curve-based hue/sat/val — approximated as HSV) ----------
  CompositorNodeHueCorrect: (node, env) => {
    const img = env.input('Image');
    const fac = env.input('Fac');
    // Simplified: pass through unchanged at fac=0, apply slight saturation boost at fac=1
    // A real implementation would need a per-hue curve spline, which requires GLSL look-up tables.
    const sat = env.uniformFloat('u_hc_sat', (node as unknown as { saturation?: number }).saturation ?? 1);
    const adjusted = `vec4(_hsv2rgb(vec3(_rgb2hsv(${img}.rgb).xy * vec2(1.0, ${sat}), _rgb2hsv(${img}.rgb).z)), ${img}.a)`;
    return `mix(${img}, ${adjusted}, clamp(${fac}.r, 0.0, 1.0))`;
  },

  // ---------- Tonemap (filmic/Reinhard approximation) ----------
  CompositorNodeTonemap: (node, env) => {
    const img = env.input('Image');
    const type = (node as unknown as { tonemap_type?: string }).tonemap_type ?? 'RD_PHOTORECEPTOR';
    if (type === 'RD_PHOTORECEPTOR') {
      // Reinhard simple: out = in / (1 + in)
      return `vec4(${img}.rgb / (vec3(1.0) + ${img}.rgb), ${img}.a)`;
    }
    // Filmic knee approximation (from John Hable)
    return `vec4(max(vec3(0.0), ${img}.rgb * (${img}.rgb + 0.0245786) - 0.000090537) / (${img}.rgb * (0.983729 * ${img}.rgb + 0.4329510) + 0.238081), ${img}.a)`;
  },

  // ---------- RGB / Value (literal inputs are handled by the planner;
  // these no-op emitters exist so the planner is happy when they show up
  // inside a fused chain.) ----------
  CompositorNodeRGB:   (_node, env) => env.input('__literal'),
  CompositorNodeValue: (_node, env) => env.input('__literal'),
};

/**
 * GLSL helper functions injected into the fragment shader prelude when any
 * emitter requires them. Add new helpers here when their callers reference
 * them by name.
 */
function vec4Literal(c: readonly number[]): string {
  return `vec4(${Number(c[0] ?? 0).toFixed(8)}, ${Number(c[1] ?? 0).toFixed(8)}, ${Number(c[2] ?? 0).toFixed(8)}, ${Number(c[3] ?? 1).toFixed(8)})`;
}

function rampExpression(node: Node, fExpr: string): string {
  const raw = (node as unknown as { stops?: { position: number; color: number[] }[] }).stops;
  const interpolation = (node as unknown as { interpolation?: string }).interpolation ?? 'LINEAR';
  const stops = (raw && raw.length ? raw : [
    { position: 0, color: [0, 0, 0, 1] },
    { position: 1, color: [1, 1, 1, 1] },
  ]).slice().sort((a, b) => a.position - b.position);
  if (stops.length === 1) return vec4Literal(stops[0]!.color);
  let expr = vec4Literal(stops[stops.length - 1]!.color);
  for (let i = stops.length - 2; i >= 0; i--) {
    const a = stops[i]!, b = stops[i + 1]!;
    const denom = Math.max(1e-8, b.position - a.position);
    let t = `clamp((${fExpr} - ${a.position.toFixed(8)}) / ${denom.toFixed(8)}, 0.0, 1.0)`;
    if (interpolation === 'CONSTANT') t = '0.0';
    else if (interpolation === 'EASE') t = `(${t} * ${t} * (3.0 - 2.0 * ${t}))`;
    const seg = `mix(${vec4Literal(a.color)}, ${vec4Literal(b.color)}, ${t})`;
    expr = `((${fExpr}) <= ${a.position.toFixed(8)} ? ${vec4Literal(a.color)} : ((${fExpr}) <= ${b.position.toFixed(8)} ? ${seg} : ${expr}))`;
  }
  return expr;
}

export const GLSL_PRELUDE = /* glsl */ `
// rgb → hsv (https://stackoverflow.com/a/17897228)
vec3 _rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
// hsv → rgb
vec3 _hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
// Apply hue offset, saturation multiplier, value multiplier, blend by fac.
vec4 _hsv_apply(vec4 c, float hueOff, float sat, float val, float fac){
  vec3 hsv = _rgb2hsv(c.rgb);
  hsv.x = fract(hsv.x + hueOff);
  hsv.y *= sat;
  hsv.z *= val;
  vec3 out_rgb = _hsv2rgb(hsv);
  return vec4(mix(c.rgb, out_rgb, clamp(fac, 0.0, 1.0)), c.a);
}
`;
