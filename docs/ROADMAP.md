# Roadmap

Implementation order, sized so each milestone is independently demoable.

> **Baseline note (2026-06-02):** current verified state is **90 smoke tests passing**, strict `tsc` clean, and `vite build` clean. See [`PHASE0_AUDIT_2026-06-02.md`](./PHASE0_AUDIT_2026-06-02.md) for the authoritative current audit; this roadmap describes milestone intent plus what still remains to close.

## M0 — Foundations (this commit)
- Project scaffold, TypeScript strict, Vite app
- `core/`: NodeTree, Node, NodeSocket, NodeLink, NodeTreeInterface, Properties
- `registry/`: NodeRegistry, NodeCategory
- 16 built-in socket types
- `eval/Depsgraph.ts`
- `bridge/bpy_shim.ts` skeleton
- Demo app shell: split layout (React Flow on the left, R3F viewport on the right)

## M1 — Common + Shader (Three.js TSL)  ✅ **shipped**
- Common nodes: Math, Vector Math, Mix (Float/Vec/Color, 19 blend modes), Map Range, Clamp, Combine/Separate XYZ + Color, ColorRamp (5 interpolation modes), Boolean Math, Compare, Switch, Random Value, RGB, Value, Vector, Frame, Reroute, Group I/O, Group container.
- Shader nodes: Output Material, Principled BSDF, Diffuse/Glossy/Refraction/Glass/Transparent/Translucent/Sheen/Toon BSDFs, Subsurface Scattering, Background, Holdout, Add/Mix Shader, Volume Absorption/Scatter; Image/Environment/Voronoi/Wave/Checker/Brick/Gradient/Magic/White Noise/Noise textures; UV Map, Geometry, Attribute, Fresnel, Layer Weight, Object Info, Camera Data, Light Path, Tex Coordinate; Bump, Normal Map, Mapping, Vector Rotate, Vector/Surface Displacement.
- **`TSLShaderEvaluator`** emits real Three.js TSL nodes and assembles a `MeshStandardNodeMaterial` (toggle "TSL / WebGPU" in the demo).
- Original `ShaderEvaluator` (POJO material descriptor, WebGL fallback) now also handles all new node types.

## M2 — Geometry foundations  ✅ **shipped**
- Expanded Geometry container: `Mesh` + `Curves` (CSR offsets, cyclic, resolution, spline type) + `PointCloud` + `Instances`, all with per-domain attribute spans and lazy face-/point-normal + face-area caches.
- **Field system** (`src/eval/geometry/Field.ts`): lazy `Field<T>` with `eval(ctx)` materialisation, constant fields, attribute fields, Position / Normal / Index / ID / Radius input helpers, Named Attribute, anonymous-attribute Capture pattern, automatic domain interpolation (FACE↔POINT averaging), implicit lift of literal values, and `map`/`zip` combinators.
- Mesh primitives: Cube, UV Sphere, Ico Sphere, Cylinder, Cone, Grid, Mesh Line, Mesh Circle.
- Field-input nodes: Position, Normal, Index, ID, Radius, Named Attribute.
- Data-flow ops: Set Position (with full Selection + Position + Offset field semantics), Transform Geometry, Join Geometry (multi-input merge across all components), Bounding Box, Merge by Distance (grid hashing), Realize Instances, Triangulate.
- `GeometryEvaluator` dispatches on `node_kind: 'FIELD' | 'DATA'`, threads Field<T> through field-typed sockets, and materialises them with the consumer's geometry+domain context.

## M3 — Geometry advanced  ✅ **shipped**
- Curve primitives: Curve Line, Curve Circle, Bezier Segment, Spiral.
- Curve ops: Curve to Mesh (profile sweep), Curve to Points (Evaluated/Count/Length), Resample Curve, Reverse Curve.
- Mesh ops: Subdivision Surface (Loop algorithm with adjacency-based smoothing + edge midpoints, iterates per level), Mesh to Points (Vertices/Edges/Faces/Corners), Points to Vertices.
- Distribute Points on Faces (Random + Poisson Disk with brute-force rejection), Instance on Points (Selection + Rotation + Scale fields), Translate/Rotate/Scale Instances (transform pre-multiply).
- Attribute pattern: **Capture Attribute** (writes anonymous attr, returns a field that reads from the captured snapshot — correctly decoupled from later geometry mutations, verified by smoke test), Store Named Attribute, Remove Named Attribute, Named Attribute read.
- Sampling: Sample Index (re-evaluates Index in the consumer's domain), Sample Nearest, Geometry Proximity.
- **R3F viewport** now renders mesh, point cloud, curve, and InstancedMesh outputs side-by-side.

## M4 — Zones  ✅ **shipped**
- **Six new node classes** for the three zone kinds: `GeometryNodeSimulationInput/Output`, `GeometryNodeRepeatInput/Output`, `GeometryNodeForeachGeometryElementInput/Output`.
- **Zone state items**: typed loop carriers (geometry / float / vector / color / etc.); the Input node owns the authoritative list, both Input and Output rebuild sockets from it; new items add automatically when you drag a link onto the "+" socket (planned UI path) or via `zoneInput.addStateItem({…})`.
- **Pairing by `zone_id`**: both nodes carry the same id; `findPair()` locates the partner by walking the tree. Dangling halves render but evaluate as pass-through.
- **`ZoneRunner`** (`src/eval/zones/ZoneRunner.ts`): general-purpose interior driver that locates the topo-restricted interior (forward-from-Input ∩ backward-from-Output), seeds the Input's interior outputs with current state, runs the interior nodes, and collects the Output's incoming state for the next iteration.
- **Simulation Zone**: per-zone `SimZoneCache` keyed by frame, owned by the `Depsgraph`. First frame reads initial state from external inputs; subsequent frames replay from the previous frame's cache. `Delta Time` is `0` on the first frame and `1/fps` thereafter (cache-aware). Rewinding via `setScene({ frame: lower })` invalidates the trailing cache. `resetSimulation()` wipes all caches.
- **Repeat Zone**: pure functional iteration; reads `Iterations` socket, loops N times, feeds each iteration's Output state back into Input. Exposes the current `Iteration` index inside the zone.
- **Foreach Element Zone**: iterates over a chosen `domain` (POINT / EDGE / FACE / CORNER / CURVE / INSTANCE) of the input geometry, exposes the `Index`, aggregates geometry outputs by `joinGeometries`.
- **Zone-escape rule**: `NodeTree.addLink()` flags links that violate "interior → exterior only via Output" with `link.escapes_zone = true`. The evaluator's `topoOrder()` skips them; the React Flow editor renders them red/dashed.
- **`NodeTree.addZone(kind)`**: convenience constructor — drops a paired Input + Output, shares the zone_id, pre-wires the default `Geometry → Geometry` state link, and registers them with the tree.
- **Demo: Simulation tree** with Play / Pause / Step / Reset / frame counter, driven by `requestAnimationFrame` ticking the `Depsgraph.setScene({frame})`. Points scatter on a grid then drift outward by `Position × 0.05` per frame.
- **6 new smoke tests** cover all three zone kinds + the escape rule + cache replay + reset semantics.

## M5 — Compositor  ✅ **shipped**
- **Real WebGL render-target pipeline** (`src/eval/compositor/CompositorEvaluator.ts`): owns a `WebGLRenderer` (lazy, can BYO), a `TexturePool` (recycles `WebGLRenderTarget`s by `WxH`), and a shared `FullScreenQuad` (single-triangle, no seams).
- **`Result` model** mirroring Blender's: `IMAGE` (render target + texture), `VALUE`, `COLOR`, `VECTOR`. Operations consume Results and produce Results.
- **`ShaderOperation` fusion**: the planner walks topo order and greedily bundles consecutive pixel-wise nodes into a single fused fragment shader (one node = one GLSL snippet emitted by `PIXEL_EMITTERS`); kernel nodes break the chain. Verified end-to-end: a 3-node BrightContrast→Invert→Gamma chain compiles to **one** `PIXEL_FUSED` op; inserting a Blur splits it into 2 fused chains around the kernel.
- **`PixelGLSL.ts`** with emitters for Mix RGB (10 blend modes), Brightness/Contrast, Invert (RGB + Alpha), Gamma, Exposure, Hue/Sat/Value, Alpha Over, Set Alpha, RGB→BW, Math (13 ops). Plus a shared GLSL prelude with HSV helpers.
- **`KernelShaders.ts`** with full programs for Gaussian Blur (separable H+V, 9-tap), Glare (Fog Glow: threshold → blur → add), Vignette (radial smoothstep), Pixelate, Translate, Scale, Rotate, Flip, Crop.
- **25 compositor nodes** registered: Image, RGB, Value, Render Layers, Composite, Viewer, Mix RGB, Brightness/Contrast, Invert, Gamma, Exposure, Hue/Sat/Value, Alpha Over, Set Alpha, RGB→BW, Math, Blur, Glare, Vignette, Pixelate, Translate, Scale, Rotate, Flip, Crop.
- **External texture resolver**: `new CompositorEvaluator({ resolveTexture: (key) => Texture | null })` lets the host wire `CompositorNodeImage.image_src` (or Render Layers' node id) to any THREE texture — e.g. the result of a previous R3F render pass.
- **Headless safety**: in Node / SSR (no `<canvas>`), the evaluator returns `{ headless: true, texture: null }` instead of crashing. The smoke tests rely on this.
- **`planTree(tree)`** public introspection helper returns the operation list without GPU work — used by tests and the demo's inspection panel.
- **Demo Compositor tree**: RGB×2 → Mix → BrightContrast → Invert → Blur → Glare → Vignette → Composite. The viewport renders the produced texture on a fullscreen quad. 3 smoke tests cover the planner shape + fusion behaviour.

## M6 — Texture (legacy)  ✅ **shipped**
- **Sampler-graph `TextureEvaluator`** compiles a TextureNodeTree into a
  per-sample `(u,v)=>RGBA` callback; group + reroute handled via the shared
  flatten utility.
- **12 nodes**: Output, Coordinates, Noise, Checker, Voronoi (Euclidean/
  Manhattan), Wave (bands/rings + distortion), Magic, Blend (linear/radial/
  quadratic), Image (UV placeholder headless), Math (7 ops), Mix, Color Ramp.
- **`bakeToDataTexture(sample, size, THREE)`** rasterises the sampler to a
  `THREE.DataTexture` (RGBA8).
- 4 smoke tests (Voronoi range, Math, Coordinates→Checker, baking).

## M7 — Bridge & addon compatibility  ✅ **shipped**
- `blender_exporter.py` (Blender 4.x + 5.x), `importer.ts` (Zod), round-trip
  `exporter.ts`.
- **Per-node extension point**: custom nodes implement `executeGeo(ctx)` (the
  GeometryEvaluator calls it for any node not in its built-in switch), giving
  ported addons the per-node behaviour Blender's C core normally supplies.
- **Worked example**: [`examples/falloff_addon.ts`](../examples/falloff_addon.ts)
  ports a Blender custom-node addon (`GeometryNodeRadialFalloff`) end-to-end
  through the `bpy` shim — registers via `bpy.utils.register_class` +
  `nodeitems_utils`, then evaluates inside a real tree (2 smoke tests).
- **Honest scope note**: porting is *mechanical but manual* — there is **no
  automatic Python→TS translator**. Class structure transliterates 1:1; node
  *behaviour* is supplied by `executeGeo` (geometry) or an evaluator emitter
  (shader/compositor).

## M8 — Polish  ✅ **operators shipped** (UI chrome partial)
- **Headless, testable editor operators** in `src/ui/operators.ts`:
  - `History` — snapshot-based undo/redo (BNG JSON round-trip).
  - `makeGroup(tree, selection, ctors)` — pack a selection into a child group,
    auto-deriving the interface from boundary links.
  - `ungroup(tree, container)` — inline a group back into the parent
    (eval-preserving round-trip, verified by a smoke test).
  - `autoLayout(tree)` — topological-depth column layout.
- 3 smoke tests (autoLayout ordering, undo/redo, makeGroup↔ungroup parity).
- Since the original milestone write-up, the editor also gained **copy/paste**,
  **search/filter in AddMenu**, and core **keyboard shortcuts** (undo/redo,
  auto-layout, mute, hide, add-menu).
- Still TODO (UI chrome / app wiring): surface **makeGroup/ungroup** in the
  editor toolbar, improve multi-select / marquee workflows, add a dedicated
  inspector/properties panel, preserve per-tree edits when switching demo tree
  types, and finish theming / polish.

## Cross-cutting completed in this pass
- **Group nodes** now recursively evaluate in **all** systems (geometry,
  legacy shader, TSL shader, compositor, texture) — nesting + recursion guard.
  Compositor/texture use a shared `flattenTree`/`flatTopoOrder` that inlines
  groups and bypasses reroutes (Blender's actual inlining model).
- **Node mute** uses real `Node.computeInternalLinks()` routing everywhere.
- **Reroute** works in every evaluator (+ `NodeLink.is_valid` relays CUSTOM/
  virtual sockets).
- **Interface reactivity** — Group I/O + container sockets refresh by
  identifier, preserving links.
- **Compositor** completed to its M5 ship list (Color Ramp, Map Range,
  Combine/Separate Color, Posterize, Z Combine, Split Viewer) + a **CPU
  evaluator** (`cpuComposite`) so pixel math is verified headlessly.
- **Cycle detection/reporting**: `NodeTree.topoOrder()` annotates cycle nodes
  and `Depsgraph.evaluate()` surfaces a `__cycle__` error instead of failing
  silently.
- **Build hygiene**: `tsc --noEmit` in build, `dist*` git-ignored, `LICENSE`
  (MIT) added.
- **Current limitation**: depsgraph dirty tracking exists, but evaluators still
  perform full-tree evaluation rather than true incremental re-execution.

## Out of scope (documented, not planned)
- Volume / OpenVDB geometry nodes (sparse grids, level sets, advection).
- Cycles/OSL shader paths; full World/Light shading (World/Light *output*
  nodes exist as declarations).
- Real `.blend` binary parsing (we use the JSON bridge instead).
- GPU pixel-exactness tests (CPU path covers constant-frame correctness).
