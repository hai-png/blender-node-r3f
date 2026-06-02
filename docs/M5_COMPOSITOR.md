# M5 — Compositor (real WebGL render-target pipeline)

> Mirrors Blender's GPU compositor design: every node is an `Operation`
> that produces a `Result`; per-pixel operations are coalesced into a single
> fragment shader by `ShaderOperation` fusion; image data lives in
> `WebGLRenderTarget`s and is pumped through the chain by a `FullScreenQuad`.

## 1. Concepts

### 1.1 `Result`

A `Result` is either a 2D image (a `WebGLRenderTarget` + texture) or a
single value (float / vec3 / vec4). Operations write Results and consumers
read them.

```ts
type Result =
  | { kind: 'IMAGE'; target: WebGLRenderTarget; width: number; height: number }
  | { kind: 'VALUE'; value: number }
  | { kind: 'COLOR'; value: [number, number, number, number] }
  | { kind: 'VECTOR'; value: [number, number, number] };
```

### 1.2 `Operation`

The base unit of work — one per compositor node (or one per *cluster* of
fused pixel-wise nodes). Has:

- `inputs : Map<socketIdentifier, Result>` (set by the planner before execute)
- `execute(ctx) : Result | Result[]` per-output

```ts
abstract class Operation {
  abstract execute(ctx: ExecContext): Map<string /* outputId */, Result>;
}
```

Two main concrete subclasses:

- **`KernelOperation`** — runs a single fragment shader pass on a
  `WebGLRenderTarget`. Used for Blur, Glare, Vignette, color filters, etc.
- **`ShaderOperation`** — fuses a *compile unit* of pixel-wise nodes
  (Math/Mix/Invert/Brightness etc.) into one fragment shader, with one
  uniform per external input. Mirrors Blender's `ShaderOperation`.

### 1.3 `Context` / `ExecContext`

Owns the WebGLRenderer, a `texture pool` for transient render targets,
default canvas size (`width × height`), and per-evaluation state.

```ts
class Context {
  renderer: WebGLRenderer;
  width: number;
  height: number;
  pool: TexturePool;       // allocates + recycles WebGLRenderTargets
  fsQuad: FullScreenQuad;  // shared
}
```

## 2. Compilation pipeline

```
bNodeTree (CompositorNodeTree)
  ↓ planCompositor()
List<Operation>  in topo order, with:
   - PixelWise nodes that form a chain get bundled into one ShaderOperation
   - Filter / kernel nodes become a KernelOperation each
   - Image / Value / Constant become trivial InputOperations
   - Composite / Viewer become a final blit
  ↓ run()  — for each Operation in order:
     - gather inputs (Results from prior ops)
     - allocate output target(s) from pool
     - bind shader, set uniforms, render fullscreen quad
     - emit Result(s)
```

### 2.1 `ShaderOperation` fusion

A node is **pixel-wise** if it implements a static `pixelGLSL(args, outId)`
helper returning a fragment of GLSL that depends only on the pixel's own
input values. The planner walks downstream from each image-producing root,
greedily accumulating consecutive pixel-wise nodes into a compile unit;
when it hits a non-pixel-wise node (e.g. Blur), it materialises the unit
into a `ShaderOperation` and starts a new chain.

The generated fragment shader for a unit looks like:

```glsl
uniform sampler2D u_input_0;   // each external input becomes a uniform
uniform float     u_const_1;
varying vec2 v_uv;
void main() {
  vec4 n0 = texture2D(u_input_0, v_uv);
  vec4 n1 = n0 * vec4(u_const_1, u_const_1, u_const_1, 1.0);  // Brightness
  vec4 n2 = vec4(1.0) - n1;                                    // Invert
  gl_FragColor = n2;
}
```

For M5 we ship the fusion plumbing + a handful of pixel-wise nodes; the
rest are easy to add as one-line `pixelGLSL` implementations.

### 2.2 Texture pool

`TexturePool` is a tiny LRU of `WebGLRenderTarget`s keyed by
`{width, height, format}`. After an Operation reads its inputs it
releases them back to the pool. Final outputs (`Composite`, `Viewer`)
are *not* pooled — they live until the next evaluation.

## 3. Node specs (M5 ship list)

| Category | Node | Kind |
|---|---|---|
| Input | Image, Render Layers (R3F render of current scene), RGB, Value, Bokeh Image, Time Curve | Source/InputOperation |
| Output | Composite, Viewer, Split Viewer | SinkOperation |
| Color | Mix (RGBA), Brightness/Contrast, Hue/Saturation/Value, Invert, Gamma, Exposure, Posterize, Alpha Over, Set Alpha, Z Combine | Pixel-wise |
| Converter | Math, RGB to BW, ColorRamp, Map Range, Combine/Separate Color, Alpha Convert, Switch | Pixel-wise |
| Filter | Blur (Gaussian, separable H+V), Glare (Fog Glow), Vignette, Pixelate, Sharpen | Kernel |
| Distort | Translate, Scale, Crop, Flip, Rotate | Kernel |
| Vector | Map UV, Normalize, Velocity | Pixel-wise / Kernel |
| Matte | (deferred) | — |

The plumbing supports adding more in a one-class-per-node pattern.

## 4. Public API

```ts
// src/eval/compositor/CompositorEvaluator.ts
class CompositorEvaluator implements SystemEvaluator {
  constructor(opts?: {
    width?: number;            // default 1024
    height?: number;           // default 1024
    renderer?: WebGLRenderer;  // bring your own; otherwise constructed lazily
  });
  evaluate(tree, dirty): EvaluationResult;
  dispose(): void;
}

interface EvaluatedComposite {
  /** Final image, displayable. null when no Composite/Viewer in the tree. */
  texture: THREE.Texture | null;
  width: number;
  height: number;
  /** Optional Viewer output (Blender's "backdrop" preview). */
  viewer?: THREE.Texture | null;
}
```

The demo's `CompositorPreview` is rewritten to draw the produced texture
on a fullscreen quad inside the R3F canvas.

## 5. Headless safety

`CompositorEvaluator` constructs its `WebGLRenderer` lazily inside
`evaluate()` — so importing the module in Node (for our smoke tests) is
safe. When no WebGL is available it falls back to a **CPU emulator** that
runs the same `pixelGLSL` graph through a tiny `Uint8ClampedArray` mock
renderer, producing a small image (e.g. 64×64). This makes the compositor
testable without a browser.
