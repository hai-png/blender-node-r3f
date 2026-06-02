/**
 * Fragment-shader factories for kernel-class compositor operations.
 *
 * Each factory returns { vertex, fragment, uniforms } that the runner uses
 * to build a `THREE.ShaderMaterial`. Uniforms are an object literal so the
 * runner can clone + populate them per execution.
 */
import * as THREE from 'three';

export interface KernelProgram {
  vertex: string;
  fragment: string;
  /** Factory so each material instance gets its own uniforms object. */
  makeUniforms(): Record<string, THREE.IUniform>;
  /** Number of separable passes (1 for most, 2 for separable Gaussian, etc.). */
  passes?: number;
}

/* ------------------------------------------------------------------ */
/*  Shared vertex shader for fullscreen passes                        */
/* ------------------------------------------------------------------ */
export const FULLSCREEN_VS = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

/* ------------------------------------------------------------------ */
/*  Blur (separable Gaussian)                                          */
/* ------------------------------------------------------------------ */
/**
 * Returns a program that runs *one* pass — caller invokes it twice with
 * `u_direction` = (1,0) then (0,1) and ping-pongs targets.
 */
export const BlurProgram = (radiusPx: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_direction;   // (1,0) horizontal, (0,1) vertical
uniform vec2  u_texelSize;
uniform float u_radius;
void main(){
  // 9-tap Gaussian (sigma ≈ radius/2).
  float sigma = max(u_radius * 0.5, 0.0001);
  float weight = 0.0;
  vec4  acc = vec4(0.0);
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    float w = exp(-(fi*fi) / (2.0 * sigma * sigma));
    vec2  off = u_direction * u_texelSize * fi * u_radius / 8.0;
    acc += texture2D(tDiffuse, vUv + off) * w;
    weight += w;
  }
  gl_FragColor = acc / max(weight, 1e-6);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_direction: { value: new THREE.Vector2(1, 0) },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_radius: { value: radiusPx },
  }),
  passes: 2,
});

/* ------------------------------------------------------------------ */
/*  Glare (Fog Glow): threshold → blur → add                          */
/* ------------------------------------------------------------------ */
export const GlareThresholdProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_threshold;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - u_threshold, 0.0);
  gl_FragColor = vec4(c.rgb * (k / max(l, 1e-4)), c.a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_threshold: { value: 1 },
  }),
};

export const GlareAddProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;   // original
uniform sampler2D tGlow;      // blurred-bright
uniform float u_mix;          // -1 (only base) … 0 (50/50) … +1 (only glow)
void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  vec4 glow = texture2D(tGlow, vUv);
  float f = clamp((u_mix + 1.0) * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(base.rgb + glow.rgb * f, base.a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    tGlow: { value: null },
    u_mix: { value: 0 },
  }),
};

/* ------------------------------------------------------------------ */
/*  Vignette                                                          */
/* ------------------------------------------------------------------ */
export const VignetteProgram = (radius: number, softness: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_radius;
uniform float u_softness;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - vec2(0.5);
  float r = length(d) * 1.4142;        // 0 at center, ~1 at corners
  float v = smoothstep(u_radius, u_radius - max(u_softness, 0.0001), r);
  gl_FragColor = vec4(c.rgb * v, c.a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_radius: { value: radius },
    u_softness: { value: softness },
  }),
});

/* ------------------------------------------------------------------ */
/*  Pixelate                                                          */
/* ------------------------------------------------------------------ */
export const PixelateProgram = (pixelSize: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 u_texelSize;
uniform float u_pixelSize;
void main(){
  vec2 stepUV = u_texelSize * max(u_pixelSize, 1.0);
  vec2 snapped = (floor(vUv / stepUV) + 0.5) * stepUV;
  gl_FragColor = texture2D(tDiffuse, snapped);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_pixelSize: { value: pixelSize },
  }),
});

/* ------------------------------------------------------------------ */
/*  Translate / Scale / Rotate / Flip / Crop                          */
/* ------------------------------------------------------------------ */

export const TranslateProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 u_offset;
void main(){
  vec2 uv = vUv - u_offset;
  vec4 c = texture2D(tDiffuse, uv);
  float in_bounds = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  gl_FragColor = c * in_bounds;
}`,
  makeUniforms: () => ({ tDiffuse: { value: null }, u_offset: { value: new THREE.Vector2() } }),
};

export const ScaleProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 u_scale;
void main(){
  vec2 uv = (vUv - 0.5) / u_scale + 0.5;
  vec4 c = texture2D(tDiffuse, uv);
  float in_bounds = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  gl_FragColor = c * in_bounds;
}`,
  makeUniforms: () => ({ tDiffuse: { value: null }, u_scale: { value: new THREE.Vector2(1, 1) } }),
};

export const RotateProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_angle;     // radians
void main(){
  vec2 d = vUv - 0.5;
  float c = cos(-u_angle), s = sin(-u_angle);
  vec2 uv = vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5;
  float in_bounds = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  gl_FragColor = texture2D(tDiffuse, uv) * in_bounds;
}`,
  makeUniforms: () => ({ tDiffuse: { value: null }, u_angle: { value: 0 } }),
};

export const FlipProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 u_axis;       // (x>0 → flip x), (y>0 → flip y)
void main(){
  vec2 uv = vec2(
    u_axis.x > 0.5 ? 1.0 - vUv.x : vUv.x,
    u_axis.y > 0.5 ? 1.0 - vUv.y : vUv.y);
  gl_FragColor = texture2D(tDiffuse, uv);
}`,
  makeUniforms: () => ({ tDiffuse: { value: null }, u_axis: { value: new THREE.Vector2(0, 0) } }),
};

export const CropProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec4 u_crop;       // (minX, minY, maxX, maxY)
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float in_box = step(u_crop.x, vUv.x) * step(vUv.x, u_crop.z) * step(u_crop.y, vUv.y) * step(vUv.y, u_crop.w);
  gl_FragColor = c * in_box;
}`,
  makeUniforms: () => ({ tDiffuse: { value: null }, u_crop: { value: new THREE.Vector4(0, 0, 1, 1) } }),
};


/* ==================================================================== */
/*  Additional kernels (Phase-3 audit)                                  */
/* ==================================================================== */

/* ── Filter (3x3 convolutions) ────────────────────────────────────── */
/**
 * 3×3 convolution filter for sharpen / soften / Laplace / Sobel / Prewitt /
 * Kirsch / shadow. The kernel is encoded as 9 floats; the caller picks the
 * right preset (and edge-detection presets sum |Gx|+|Gy| of two 3×3 kernels).
 */
export const FilterProgram = (kernelType: string): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
uniform float u_fac;
uniform mat3  u_kernel;     // primary 3x3 kernel
uniform mat3  u_kernel2;    // optional secondary (for edge detection)
uniform float u_useEdge;    // 0 = single conv; 1 = |Gx|+|Gy| magnitude
void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  vec4 c[9];
  c[0] = texture2D(tDiffuse, vUv + u_texelSize * vec2(-1.0, -1.0));
  c[1] = texture2D(tDiffuse, vUv + u_texelSize * vec2( 0.0, -1.0));
  c[2] = texture2D(tDiffuse, vUv + u_texelSize * vec2( 1.0, -1.0));
  c[3] = texture2D(tDiffuse, vUv + u_texelSize * vec2(-1.0,  0.0));
  c[4] = texture2D(tDiffuse, vUv + u_texelSize * vec2( 0.0,  0.0));
  c[5] = texture2D(tDiffuse, vUv + u_texelSize * vec2( 1.0,  0.0));
  c[6] = texture2D(tDiffuse, vUv + u_texelSize * vec2(-1.0,  1.0));
  c[7] = texture2D(tDiffuse, vUv + u_texelSize * vec2( 0.0,  1.0));
  c[8] = texture2D(tDiffuse, vUv + u_texelSize * vec2( 1.0,  1.0));
  vec4 gx = vec4(0.0);
  for (int i = 0; i < 9; i++) {
    int col = i - (i / 3) * 3;     // i % 3
    int row = i / 3;
    gx += c[i] * u_kernel[col][row];
  }
  vec4 result;
  if (u_useEdge > 0.5) {
    vec4 gy = vec4(0.0);
    for (int i = 0; i < 9; i++) {
      int col = i - (i / 3) * 3;
      int row = i / 3;
      gy += c[i] * u_kernel2[col][row];
    }
    result = sqrt(gx * gx + gy * gy);
    result.a = base.a;
  } else {
    result = gx;
  }
  gl_FragColor = mix(base, result, clamp(u_fac, 0.0, 1.0));
}`,
  makeUniforms: () => {
    let k1: number[]; let k2: number[] | null = null; let edge = 0;
    switch (kernelType) {
      case 'SHARPEN':
        k1 = [0, -1, 0, -1, 5, -1, 0, -1, 0]; break;
      case 'LAPLACE':
        k1 = [0, -1, 0, -1, 4, -1, 0, -1, 0]; break;
      case 'SOBEL':
        k1 = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        k2 = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
        edge = 1;
        break;
      case 'PREWITT':
        k1 = [-1, 0, 1, -1, 0, 1, -1, 0, 1];
        k2 = [-1, -1, -1, 0, 0, 0, 1, 1, 1];
        edge = 1;
        break;
      case 'KIRSCH':
        k1 = [-3, -3, 5, -3, 0, 5, -3, -3, 5];
        k2 = [5, 5, 5, -3, 0, -3, -3, -3, -3];
        edge = 1;
        break;
      case 'SHADOW':
        k1 = [1, 2, 1, 0, 1, 0, -1, -2, -1]; break;
      case 'SOFTEN':
      default:
        k1 = [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9];
    }
    return {
      tDiffuse: { value: null },
      u_texelSize: { value: new THREE.Vector2(0, 0) },
      u_fac: { value: 1 },
      u_kernel: { value: new THREE.Matrix3().fromArray(k1) },
      u_kernel2: { value: new THREE.Matrix3().fromArray(k2 ?? k1) },
      u_useEdge: { value: edge },
    };
  },
});

/* ── Dilate / Erode (single-pass min/max within radius) ──────────── */
export const DilateErodeProgram = (distancePx: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
uniform float u_distance;    // positive = dilate, negative = erode
void main(){
  float r = abs(u_distance);
  bool dilate = u_distance > 0.0;
  vec4 acc = texture2D(tDiffuse, vUv);
  int steps = int(min(r, 16.0));
  for (int dy = -16; dy <= 16; dy++) {
    if (abs(dy) > steps) continue;
    for (int dx = -16; dx <= 16; dx++) {
      if (abs(dx) > steps) continue;
      if (float(dx*dx + dy*dy) > r*r) continue;
      vec4 s = texture2D(tDiffuse, vUv + u_texelSize * vec2(float(dx), float(dy)));
      acc = dilate ? max(acc, s) : min(acc, s);
    }
  }
  gl_FragColor = acc;
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_distance: { value: distancePx },
  }),
});

/* ── Defocus / Bokeh Blur (disc-kernel approximation) ────────────── */
export const DefocusProgram = (radius: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
uniform float u_radius;
// 24-tap golden-angle disc sampler (Vogel)
void main(){
  if (u_radius < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
  vec4 acc = vec4(0.0);
  float w = 0.0;
  const int N = 24;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N));
    float a = fi * 2.39996323; // golden angle
    vec2  o = vec2(cos(a), sin(a)) * r * u_radius;
    acc += texture2D(tDiffuse, vUv + u_texelSize * o);
    w += 1.0;
  }
  gl_FragColor = acc / w;
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_radius: { value: radius },
  }),
});

/* ── Lens Distortion (radial barrel/pincushion + dispersion) ─────── */
export const LensDistortionProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_distortion;   // -1..1
uniform float u_dispersion;   // 0..1
void main(){
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 ofs = c * (1.0 + u_distortion * r2);
  // Chromatic aberration: shift R/B channels by ±dispersion * radial.
  vec2 disp = c * u_dispersion * r2;
  float r = texture2D(tDiffuse, 0.5 + ofs + disp).r;
  float g = texture2D(tDiffuse, 0.5 + ofs).g;
  float b = texture2D(tDiffuse, 0.5 + ofs - disp).b;
  float a = texture2D(tDiffuse, 0.5 + ofs).a;
  gl_FragColor = vec4(r, g, b, a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_distortion: { value: 0 },
    u_dispersion: { value: 0 },
  }),
};

/* ── Displace (UV offset by a vector field) ───────────────────────── */
export const DisplaceProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tVector;
uniform vec2  u_scale;
void main(){
  vec3 v = texture2D(tVector, vUv).xyz - 0.5;
  vec2 ofs = v.xy * u_scale;
  gl_FragColor = texture2D(tDiffuse, vUv + ofs);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    tVector: { value: null },
    u_scale: { value: new THREE.Vector2(0, 0) },
  }),
};

/* ── Map UV (sample tDiffuse at provided UV channel) ──────────────── */
export const MapUVProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tUV;
uniform float u_alpha;     // anti-alias edge falloff
void main(){
  vec3 uv = texture2D(tUV, vUv).xyz;
  // Out-of-bounds UVs alpha-fade.
  vec2 d = vec2(0.5) - abs(uv.xy - 0.5);
  float edge = clamp(min(d.x, d.y) / max(u_alpha, 0.0001), 0.0, 1.0);
  vec4 c = texture2D(tDiffuse, uv.xy);
  gl_FragColor = vec4(c.rgb, c.a * edge);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    tUV: { value: null },
    u_alpha: { value: 0.02 },
  }),
};

/* ── ID Mask (1.0 where ID value == target, 0 otherwise) ─────────── */
export const IDMaskProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_target;
uniform float u_aa;
void main(){
  float id = texture2D(tDiffuse, vUv).r;
  float diff = abs(id - u_target);
  float v = u_aa > 0.5 ? smoothstep(0.5, 0.0, diff * 8.0) : (diff < 0.5/256.0 ? 1.0 : 0.0);
  gl_FragColor = vec4(v, v, v, 1.0);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_target: { value: 0 },
    u_aa: { value: 0 },
  }),
};

/* ── Color Spill (suppress a channel where it dominates) ─────────── */
export const ColorSpillProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_fac;
uniform int   u_channel;  // 0=R 1=G 2=B
uniform int   u_method;   // 0=simple 1=average
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float src = u_channel == 0 ? c.r : u_channel == 1 ? c.g : c.b;
  float limit;
  if (u_method == 0) {
    limit = max(u_channel == 0 ? c.g : c.r,
                u_channel == 2 ? c.g : c.b);
  } else {
    float a = u_channel == 0 ? c.g : c.r;
    float b = u_channel == 2 ? c.g : c.b;
    limit = (a + b) * 0.5;
  }
  float spill = max(0.0, src - limit) * clamp(u_fac, 0.0, 1.0);
  if (u_channel == 0) c.r -= spill;
  else if (u_channel == 1) c.g -= spill;
  else c.b -= spill;
  gl_FragColor = c;
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_fac: { value: 1 },
    u_channel: { value: 1 },
    u_method: { value: 1 },
  }),
};

/* ── Premul Key (straight→premul / premul→straight) ──────────────── */
export const PremulKeyProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform int u_dir;     // 0 = straight→premul, 1 = premul→straight
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  if (u_dir == 0) {
    gl_FragColor = vec4(c.rgb * c.a, c.a);
  } else {
    float a = max(c.a, 1e-6);
    gl_FragColor = vec4(c.rgb / a, c.a);
  }
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_dir: { value: 0 },
  }),
};

/* ── Convert Colorspace (sRGB ↔ Linear) ──────────────────────────── */
export const ConvertColorSpaceProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform int u_dir;     // 0 = sRGB→linear, 1 = linear→sRGB
vec3 sRGBToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(u_dir == 0 ? sRGBToLinear(c.rgb) : linearToSRGB(c.rgb), c.a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_dir: { value: 0 },
  }),
};

/* ── Levels (mean / std-dev over the image — single-pixel reduction)  */
// Implemented as a per-pixel pass that returns the channel value; the
// runner's CPU side computes mean/std-dev from a downsampled read. For the
// GPU pass we just blit so the output is "available". Mean/StdDev outputs
// are scalar — emitted by the runner via valueResult() from the read-back.
export const LevelsBlitProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`,
  makeUniforms: () => ({ tDiffuse: { value: null } }),
};

/* ── Box / Ellipse Mask ──────────────────────────────────────────── */
export const BoxMaskProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec4  u_box;       // (cx, cy, halfW, halfH)
uniform float u_rotation;
uniform int   u_op;        // 0 ADD 1 SUBTRACT 2 MULTIPLY 3 NOT
void main(){
  float v = texture2D(tDiffuse, vUv).r;
  vec2 p = vUv - u_box.xy;
  float c = cos(u_rotation), s = sin(u_rotation);
  vec2 r = mat2(c, -s, s, c) * p;
  float inside = step(abs(r.x), u_box.z) * step(abs(r.y), u_box.w);
  float m;
  if (u_op == 0)      m = max(v, inside);
  else if (u_op == 1) m = clamp(v - inside, 0.0, 1.0);
  else if (u_op == 2) m = v * inside;
  else                m = (1.0 - inside);
  gl_FragColor = vec4(m, m, m, 1.0);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_box: { value: new THREE.Vector4(0.5, 0.5, 0.15, 0.1) },
    u_rotation: { value: 0 },
    u_op: { value: 0 },
  }),
};

export const EllipseMaskProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec4  u_box;
uniform float u_rotation;
uniform int   u_op;
void main(){
  float v = texture2D(tDiffuse, vUv).r;
  vec2 p = vUv - u_box.xy;
  float c = cos(u_rotation), s = sin(u_rotation);
  vec2 r = mat2(c, -s, s, c) * p;
  float d = (r.x*r.x) / (u_box.z*u_box.z) + (r.y*r.y) / (u_box.w*u_box.w);
  float inside = step(d, 1.0);
  float m;
  if (u_op == 0)      m = max(v, inside);
  else if (u_op == 1) m = clamp(v - inside, 0.0, 1.0);
  else if (u_op == 2) m = v * inside;
  else                m = (1.0 - inside);
  gl_FragColor = vec4(m, m, m, 1.0);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_box: { value: new THREE.Vector4(0.5, 0.5, 0.1, 0.1) },
    u_rotation: { value: 0 },
    u_op: { value: 0 },
  }),
};

/* ── Switch (passes A or B based on a uniform) ───────────────────── */
export const CompSwitchProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tA;
uniform sampler2D tB;
uniform int       u_use;     // 0 = A, 1 = B
void main(){
  gl_FragColor = u_use == 0 ? texture2D(tA, vUv) : texture2D(tB, vUv);
}`,
  makeUniforms: () => ({
    tA: { value: null }, tB: { value: null },
    u_use: { value: 0 },
  }),
};

/* ── Sun Beams (radial sweep accumulation) ───────────────────────── */
export const SunBeamsProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_source;
uniform float u_rayLength;   // in UV units
void main(){
  vec4 acc = vec4(0.0);
  const int STEPS = 48;
  float total = 0.0;
  vec2 dir = vUv - u_source;
  for (int i = 0; i < STEPS; i++) {
    float t = float(i) / float(STEPS - 1);
    vec2 p = u_source + dir * (1.0 - t * u_rayLength);
    acc += texture2D(tDiffuse, p) * (1.0 - t);
    total += (1.0 - t);
  }
  gl_FragColor = acc / max(total, 1e-6);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_source: { value: new THREE.Vector2(0.5, 0.5) },
    u_rayLength: { value: 0.2 },
  }),
};

/* ── Despeckle (3×3 median of luminance — quick CPU-style on GPU) ── */
export const DespeckleProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
uniform float u_fac;
float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
void main(){
  vec4 c[9];
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++)
      c[(dy+1)*3 + (dx+1)] = texture2D(tDiffuse, vUv + u_texelSize * vec2(float(dx), float(dy)));
  // Bubble-sort 9 elements by luminance, pick the middle.
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8 - i; j++) {
      if (lum(c[j].rgb) > lum(c[j+1].rgb)) {
        vec4 t = c[j]; c[j] = c[j+1]; c[j+1] = t;
      }
    }
  }
  vec4 base = c[4];
  vec4 med  = c[4];
  gl_FragColor = mix(base, med, clamp(u_fac, 0.0, 1.0));
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_fac: { value: 0.5 },
  }),
};

/* ── Bilateral Blur (edge-preserving 5x5 weighted average) ───────── */
export const BilateralBlurProgram = (iterations: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
uniform float u_sigmaColor;
uniform float u_sigmaSpace;
void main(){
  vec3 center = texture2D(tDiffuse, vUv).rgb;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float sigC = max(u_sigmaColor, 1e-4);
  float sigS = max(u_sigmaSpace, 1e-4);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 o = u_texelSize * vec2(float(dx), float(dy));
      vec3 s = texture2D(tDiffuse, vUv + o).rgb;
      float spaceW = exp(-(float(dx*dx + dy*dy)) / (2.0 * sigS * sigS));
      vec3 dc = s - center;
      float colorW = exp(-dot(dc, dc) / (2.0 * sigC * sigC));
      float w = spaceW * colorW;
      acc += s * w; wsum += w;
    }
  }
  gl_FragColor = vec4(acc / max(wsum, 1e-6), texture2D(tDiffuse, vUv).a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_sigmaColor: { value: 0.3 },
    u_sigmaSpace: { value: 5.0 },
  }),
  passes: iterations,
});

/* ── Directional Blur (linear sweep) ─────────────────────────────── */
export const DirectionalBlurProgram = (samples: number): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
uniform vec2  u_offset;      // per-step
uniform float u_zoom;        // per-step scale (1 = none)
uniform float u_spin;        // per-step rotation (radians)
void main(){
  vec4 acc = vec4(0.0);
  vec2 c = vUv - 0.5;
  float w = 0.0;
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float scale = pow(u_zoom, fi);
    float ang = u_spin * fi;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 p = (R * c) * scale + 0.5 + u_offset * fi;
    acc += texture2D(tDiffuse, p);
    w += 1.0;
  }
  gl_FragColor = acc / w;
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
    u_offset: { value: new THREE.Vector2(0, 0) },
    u_zoom: { value: 1 },
    u_spin: { value: 0 },
  }),
  passes: samples,
});

/* ── Denoise (3x3 median chroma + bilateral luminance) — approximation */
// Fast box average using the existing Blur 5x5 is "good enough" as a CPU/GPU
// denoiser placeholder; real Intel Open Image Denoise is out of scope.
export const DenoiseProgram = (): KernelProgram => ({
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  u_texelSize;
void main(){
  vec3 acc = vec3(0.0);
  float w = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 o = u_texelSize * vec2(float(dx), float(dy));
      vec3 s = texture2D(tDiffuse, vUv + o).rgb;
      float gw = (dx == 0 && dy == 0) ? 4.0 : ((dx == 0 || dy == 0) ? 2.0 : 1.0);
      acc += s * gw; w += gw;
    }
  }
  gl_FragColor = vec4(acc / w, texture2D(tDiffuse, vUv).a);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_texelSize: { value: new THREE.Vector2(0, 0) },
  }),
});

/* ── Normalize (per-channel rescale to [0,1] based on uniform min/max) */
export const NormalizeProgram: KernelProgram = {
  vertex: FULLSCREEN_VS,
  fragment: /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float u_min;
uniform float u_max;
void main(){
  float v = texture2D(tDiffuse, vUv).r;
  float d = max(u_max - u_min, 1e-6);
  float n = clamp((v - u_min) / d, 0.0, 1.0);
  gl_FragColor = vec4(n, n, n, 1.0);
}`,
  makeUniforms: () => ({
    tDiffuse: { value: null },
    u_min: { value: 0 },
    u_max: { value: 1 },
  }),
};
