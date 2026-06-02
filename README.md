# blender-nodes-r3f

A **Blender-compatible node system** for three.js + react-three-fiber. Mirrors `bpy.types.Node`, `NodeSocket`, `NodeTree`, `NodeTreeInterface`, `bpy.props.*`, `bpy.utils.register_class`, and `nodeitems_utils` closely enough that Blender Python addons that ship as node-group `.blend` files can be **ported** to TypeScript with minimal *structural* change. Porting is mechanical but **manual** — there is no automatic Python→TS translator; class structure transliterates 1:1 and per-node behaviour is supplied by an `executeGeo(ctx)` hook (see [`examples/falloff_addon.ts`](examples/falloff_addon.ts)).

> **Status**: broad **M0–M8 prototype/subset implemented**, with active gap-closure in progress. All four node systems (Shader/Geometry/Compositor/Texture) evaluate, including **recursive node groups in every system**, node **mute**, **reroute**, interface reactivity, an M5-style **compositor** WebGL pipeline (+ a headless CPU pixel evaluator), the **texture** sampler graph with `DataTexture` baking, geometry **field utilities**, a worked **ported-addon example** through the `bpy` shim, and headless editor **operators** (undo/redo, make-group/ungroup, auto-layout). **215 unique node classes** register at runtime. **168 headless smoke tests pass; strict `tsc` clean; `vite build` clean.** 
## Documents

| Document | Purpose |
|---|---|
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Deep research into Blender's node system — data model, evaluation per system, group nodes, zones, sockets, field model, references. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Concrete TypeScript architecture mapping every Blender concept onto our modules. |

## Quick start

```bash
cd blender-nodes-r3f
npm install
npm run dev   # opens http://localhost:5173
```

You'll see a split UI: React Flow editor on the left, R3F viewport on the right. Use the tree dropdown in the toolbar to switch between Shader / Geometry / Compositor / Texture trees.

## What currently ships

| | |
|---|---|
| **Core runtime** | `Node`, `NodeSocket`, `NodeLink`, `NodeTree`, `NodeTreeInterface`, `Depsgraph`, `Properties` (Float/Int/Bool/String/Enum/Vector/Color), `NodeRegistry`, `NodeCategory` |
| **Sockets (16+ built-in)** | Float (+6 subtypes), Int (+1), Bool, Vector (+6 subtypes), Rotation, Matrix, Color, String (+1), Shader, Geometry, Object, Collection, Material, Image, Texture, Menu, Virtual |
| **Trees (4)** | `ShaderNodeTree`, `GeometryNodeTree`, `CompositorNodeTree`, `TextureNodeTree` |
| **Common nodes** | Math (50 ops), Vector Math (27 ops), Mix (Float/Vec/Color × 19 blend modes), Map Range (4 interp modes), Clamp, Combine/Separate XYZ + Combine/Separate Color, Color Ramp (5 interp modes), Boolean Math (9 ops), Compare (6 ops), Switch, Random Value, Value, RGB, Vector, Frame, Reroute, Group Input/Output, Group container (one per system) |
| **Shader nodes** | Output Material, **Principled BSDF**, Diffuse/Glossy/Refraction/Glass/Transparent/Translucent/Sheen/Toon BSDFs, Subsurface Scattering, Background, Holdout, Add/Mix Shader, Volume Absorption/Scatter; **Procedural textures**: Noise, Voronoi, Wave, Checker, Brick, Gradient, Magic, White Noise, Image, Environment; **Inputs**: UV Map, Geometry, Attribute, Fresnel, Layer Weight, Object Info, Camera Data, Light Path, Tex Coordinate; **Vector ops**: Bump, Normal Map, Mapping, Vector Rotate, Vector Displacement, Displacement |
| **Geometry nodes** | **Primitives**: Mesh Cube/UV Sphere/Ico Sphere/Cylinder/Cone/Grid/Mesh Line/Mesh Circle; Curve Line/Circle/Bezier Segment/Spiral. **Field inputs**: Position, Normal, Index, ID, Radius, Named Attribute. **Ops**: Set Position, Transform Geometry, Join Geometry, Capture Attribute, Store/Remove Named Attribute, Bounding Box, Convex Hull, Merge by Distance, Subdivision Surface (Loop), Triangulate, Distribute Points on Faces (Random + Poisson), Mesh to Points, Points to Vertices, Instance on Points, Realize Instances, Translate/Rotate/Scale Instances, Curve to Mesh, Curve to Points, Resample Curve, Reverse Curve, Sample Index, Sample Nearest, Geometry Proximity. **Zones (M4)**: Simulation Input/Output (per-frame cache + Delta Time / Elapsed Time), Repeat Input/Output (N iterations + iteration index), Foreach Element Input/Output (per-element loop with Index, domain selectable) |
| **Compositor nodes (M5)** | **Input**: Image, RGB, Value, Render Layers. **Output**: Composite, Viewer. **Color/Converter (pixel-wise, fused)**: Mix RGB (10 blend modes), Brightness/Contrast, Invert, Gamma, Exposure, Hue/Sat/Value, Alpha Over, Set Alpha, RGB→BW, Math (13 ops). **Filter (kernel)**: Blur (separable Gaussian), Glare (Fog Glow: threshold → blur → add), Vignette, Pixelate. **Distort (kernel)**: Translate, Scale, Rotate, Flip, Crop. **Also (Phase 3)**: Color Ramp, Map Range, Combine/Separate Color, Posterize, Z Combine, Split Viewer. Pixel-wise chains auto-fuse into a single fragment shader; a **CPU evaluator** (`cpuComposite`) verifies pixel math headlessly. |
| **Texture nodes** | Output, Coordinates, Noise, Checker, Voronoi, Wave, Magic, Blend, Image, Math, Mix, Color Ramp — sampler-graph evaluator + `bakeToDataTexture` |
| **Evaluators** | **TSLShaderEvaluator** (emits real Three.js TSL graph → `MeshStandardNodeMaterial`); legacy WebGL **ShaderEvaluator** (POJO descriptor → `MeshStandardMaterial`); **GeometryEvaluator** with full **Field<T>** pipeline + **ZoneRunner** for Simulation/Repeat/Foreach zones; **CompositorEvaluator** (M5) — real WebGL render-target pipeline with `ShaderOperation` fusion, `TexturePool` recycling, shared `FullScreenQuad`, headless-safe in Node; Texture (per-sample callback) |
| **Depsgraph** | Per-tree singleton owning the **scene clock** (`setScene({frame,fps,elapsed})`), **simulation caches** (`SimZoneCache` per zone, survives across `evaluate()` calls), `invalidate()`/`invalidateAll()` with microtask scheduling, `resetSimulation()` to wipe caches |
| **UI** | React Flow editor with Blender-style coloured handles, dashed shader links, animated geometry links, inline socket value editors, property panels, right-click Add menu with search & categories |
| **Bridge** | `BNG/1` JSON schema + Zod validation; Python exporter (`src/bridge/blender_exporter.py`) + TS importer + round-trip exporter; `bpy` / `nodeitems_utils` shim + `executeGeo` per-node hook for ported addons (worked example in `examples/`) |
| **Groups & flow** | Recursive group evaluation in all 4 systems (nesting + recursion guard); `flattenTree`/`flatTopoOrder` inlining; node mute via `computeInternalLinks`; reroute pass-through; interface reactivity |
| **Editor operators** | `History` (undo/redo), `makeGroup`/`ungroup` (eval-preserving), `autoLayout` — all headless + tested; group/ungroup are now surfaced in the editor toolbar |

## Porting a Blender addon

Original Python:

```python
import bpy
from bpy.types import Node, NodeSocket
import nodeitems_utils
from nodeitems_utils import NodeCategory, NodeItem

class MyMultiplyNode(Node):
    bl_idname = 'MyMultiplyNode'
    bl_label  = 'My Multiply'

    factor: bpy.props.FloatProperty(default=2.0, min=0.0, max=10.0)

    def init(self, ctx):
        self.inputs.new('NodeSocketFloat', 'Value')
        self.outputs.new('NodeSocketFloat', 'Out')

bpy.utils.register_class(MyMultiplyNode)
nodeitems_utils.register_node_categories('CUSTOM', [
    NodeCategory('MY', 'Custom', items=[NodeItem('MyMultiplyNode')]),
])
```

Translation to our shim:

```ts
import { bpy, nodeitems_utils, FloatProperty } from 'blender-nodes-r3f';

class MyMultiplyNode extends bpy.types.Node {
  static bl_idname = 'MyMultiplyNode';
  static bl_label  = 'My Multiply';
  static tree_types = ['ShaderNodeTree'] as const;
  static properties = {
    factor: FloatProperty({ default: 2.0, min: 0.0, max: 10.0 }),
  };
  declare factor: number;

  init() {
    this.inputs_new('NodeSocketFloat', 'Value');
    this.outputs_new('NodeSocketFloat', 'Out');
  }
}
bpy.utils.register_class(MyMultiplyNode);
nodeitems_utils.register_node_categories('CUSTOM', [
  new nodeitems_utils.NodeCategory('MY', 'Custom', [
    new nodeitems_utils.NodeItem('MyMultiplyNode'),
  ]),
]);
```

To make the node actually *do* something, implement a per-node behaviour hook. For geometry nodes this is `executeGeo(ctx)` on the class — the `GeometryEvaluator` calls it for any node not in its built-in switch, handing you `inputField`/`setOutputField`/`mapField`/`zipField` helpers. See [`examples/falloff_addon.ts`](examples/falloff_addon.ts) for a complete ported addon. (Shader/compositor nodes plug in via their evaluator's emitter table.)

## Sampling real textures in the TSL path

`TSLShaderEvaluator` can now resolve real textures for `ShaderNodeTexImage`
and `ShaderNodeTexEnvironment`:

```ts
import { TSLShaderEvaluator } from 'blender-nodes-r3f/tsl';

const tsl = new TSLShaderEvaluator({
  resolveTexture: (key, kind) => {
    // key = node.image_src (when set) or a fallback node id
    // kind = 'IMAGE' | 'ENVIRONMENT'
    return myTextureMap.get(`${kind}:${key}`) ?? null;
  },
});
```

If no texture is resolved, the evaluator falls back to deterministic procedural
placeholder output so graphs still evaluate headlessly.

## Loading a real `.blend` node group

1. In Blender (4.x or 5.x): run [`src/bridge/blender_exporter.py`](src/bridge/blender_exporter.py) from the Text editor → `BNG: Export`. Save the resulting JSON.
2. In your app:
   ```ts
   import { importDocument, bootstrapBuiltins } from 'blender-nodes-r3f';
   bootstrapBuiltins();
   const json = await fetch('/my-group.bng.json').then(r => r.json());
   const trees = importDocument(json);
   ```
   Unknown node types are logged but don't break the import.

## Architecture at a glance

```
bpy.types.NodeTree          ─►  src/core/NodeTree.ts
bpy.types.Node              ─►  src/core/Node.ts
bpy.types.NodeSocket        ─►  src/core/NodeSocket.ts + src/sockets/
bpy.types.NodeLink          ─►  src/core/NodeLink.ts
bpy.types.NodeTreeInterface ─►  src/core/NodeTreeInterface.ts
bpy.props.*                 ─►  src/core/Properties.ts
bpy.utils.register_class    ─►  src/registry/NodeRegistry.ts
nodeitems_utils             ─►  src/registry/NodeRegistry.ts  (NodeCategory + NodeCategories + NodeItem)
Depsgraph                   ─►  src/eval/Depsgraph.ts
Shader evaluator — TSL      ─►  src/eval/tsl/TSLShaderEvaluator.ts      (primary, emits MeshStandardNodeMaterial)
Shader evaluator — legacy   ─►  src/eval/ShaderEvaluator.ts             (WebGL fallback, approximate)
Geometry evaluator          ─►  src/eval/GeometryEvaluator.ts
Zone runner                 ─►  src/eval/zones/ZoneRunner.ts
Compositor evaluator        ─►  src/eval/compositor/CompositorEvaluator.ts  (real WebGL pipeline)
Texture evaluator           ─►  src/eval/TextureEvaluator.ts
.blend → JSON bridge        ─►  src/bridge/{schema,importer,exporter,blender_exporter.py}
React Flow editor           ─►  src/ui/{NodeEditor,BlenderNode,AddMenu,store,operators}.ts(x)
Editor operators            ─►  src/ui/operators.ts  (autoLayout, makeGroup, ungroup, History)
R3F viewport                ─►  demo/Viewport.tsx  (ShaderPreview / GeometryPreview / TexturePreview / CompositorPreview)
Library build               ─►  tsup.config.ts → dist/{index,tsl}.{esm,cjs}.js + .d.ts
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module specification.

## License

MIT (suggested).
