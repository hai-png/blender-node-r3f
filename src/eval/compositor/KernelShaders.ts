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


