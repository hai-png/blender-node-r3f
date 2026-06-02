# Blender Node System — Deep Research

> Goal: build a feature-equivalent Blender node system on top of three.js / React‑Three‑Fiber, with a runtime API that mirrors `bpy.types.Node` closely enough that Python node-group addons can be ported (or auto-translated) to JavaScript/TypeScript with minimal friction.

This document is the source-of-truth for what we are recreating and **why** it is shaped the way it is. The architecture document (`ARCHITECTURE.md`) maps every concept here onto a concrete TypeScript module.

---

## 1. Top-level overview

Blender ships **four distinct node systems**, all sharing the same generic substrate (`bNodeTree` / `bNode` / `bNodeSocket` / `bNodeLink` in DNA), but each with its own **evaluator / compiler / context**:

| System | tree `bl_idname` | Purpose | Evaluator |
|---|---|---|---|
| **Shader** | `ShaderNodeTree` | Materials, world, light shaders | GPU codegen (GLSL for EEVEE, OSL/SVM for Cycles). Pull-based, lazy. |
| **Geometry** | `GeometryNodeTree` | Procedural mesh/curve/point/volume/instance generation | **Multi‑function (MFN) lazy field evaluator** + data-flow nodes. |
| **Compositor** | `CompositorNodeTree` | 2D image post‑processing | Full‑frame buffer pipeline (CPU or GPU via `ShaderOperation`). |
| **Texture** | `TextureNodeTree` (legacy) | Procedural textures (BI legacy) | Pixel‑callback per sample. |

All systems share:
- A **directed acyclic graph** of nodes
- Typed sockets with **automatic coercion** (e.g. float → vec3 = vec3(f,f,f))
- **Node groups** (encapsulation, recursive, with their own NodeTree + interface)
- **Reroutes**, **Frames**, **Group Input/Output** nodes
- **Muting** (skip the node, pass-through first compatible socket)
- **Multi-input sockets** (compositor / geometry only — e.g. `Join Geometry`)

---

## 2. Core data model (`bpy.types.*` mirror)

### 2.1 `NodeTree`
```
class NodeTree(ID):
    bl_idname: str          # 'ShaderNodeTree', 'GeometryNodeTree', ...
    bl_label : str
    bl_icon  : str
    nodes    : NodeTreeNodes        # collection
    links    : NodeLinks            # collection
    interface: NodeTreeInterface    # group I/O definition (since 4.0)
    inputs   : deprecated alias for interface inputs
    outputs  : deprecated alias for interface outputs
    animation_data : AnimationData  # drivers, keyframes
    @classmethod poll(cls, context) -> bool   # who can use this tree
```
Key behaviours:
- `update()` callback runs after edits; addons can override to do validation.
- `interface.new_socket(name, in_out, socket_type)` defines the group I/O (replaced the old `inputs/outputs` collections in 4.0).
- Trees are **ID datablocks** → can be linked across .blend files.

### 2.2 `Node`
```
class Node(bpy_struct):
    bl_idname     : str       # e.g. 'ShaderNodeBsdfPrincipled'
    bl_label      : str
    bl_icon       : str
    bl_static_type: enum      # built-in classifier
    bl_width_min/max/default
    name          : str       # unique within tree
    label         : str       # user override
    location      : Vector2
    width / height: float
    color, use_custom_color, hide, mute, select
    inputs        : NodeInputs   # ordered collection of NodeSocket
    outputs       : NodeOutputs
    internal_links: NodeLinks    # used when node is muted (pass-through map)
    parent        : Node | None  # for frames

    @classmethod poll(cls, ntree) -> bool
    def poll_instance(self, ntree) -> bool
    def init(self, context)         # build sockets on creation
    def copy(self, node)            # init from existing
    def free(self)                  # cleanup
    def update(self)                # called after link changes
    def insert_link(self, link)     # custom link routing
    def draw_buttons(self, context, layout)
    def draw_buttons_ext(self, context, layout)
    def draw_label(self) -> str
```

### 2.3 `NodeSocket`
```
class NodeSocket:
    bl_idname            : str    # 'NodeSocketFloat', 'NodeSocketGeometry', ...
    bl_label             : str
    name, identifier     : str    # identifier is stable across renames
    description, default_value, value
    type                 : enum   # VALUE,INT,BOOLEAN,VECTOR,ROTATION,MATRIX,
                                  # STRING,RGBA,SHADER,OBJECT,IMAGE,GEOMETRY,
                                  # COLLECTION,TEXTURE,MATERIAL,MENU,CUSTOM
    is_output            : bool
    is_linked, is_multi_input, hide, hide_value, enabled
    link_limit           : int    # 0 = unlimited (multi-input)
    display_shape        : enum   # CIRCLE / SQUARE / DIAMOND / DOT variants
    node                 : Node   # back-ref
    links                : tuple[NodeLink, ...]
    def draw(self, context, layout, node, text)
    def draw_color(self, context, node) -> (r,g,b,a)
```

#### Built-in socket types (2025)
- `NodeSocketFloat` (+ subtypes `…Factor`, `…Angle`, `…Percentage`, `…Time`, `…Distance`, `…Unsigned`)
- `NodeSocketInt` (+ `…Unsigned`)
- `NodeSocketBool`
- `NodeSocketVector` (+ `…XYZ`, `…Direction`, `…Euler`, `…Translation`, `…Velocity`, `…Acceleration`)
- `NodeSocketRotation` (quaternion+euler dual)
- `NodeSocketMatrix` (4×4)
- `NodeSocketColor` (RGBA, linear)
- `NodeSocketString` (+ `…Filepath`)
- `NodeSocketShader` (opaque BSDF closure handle — Shader system only)
- `NodeSocketGeometry` (opaque geometry blob — Geometry system only)
- `NodeSocketObject`, `NodeSocketCollection`, `NodeSocketMaterial`, `NodeSocketImage`, `NodeSocketTexture`
- `NodeSocketMenu` (enum)
- `NodeSocketVirtual` (used while dragging a connection)

#### Socket display shapes & field status (Geometry Nodes; 2025 redesign)
Before Blender 4.x, three shapes communicated field status dynamically. The 2025 design simplifies: **socket shape is now fixed and only describes the kind of data the socket accepts** (single value, field, list, grid). Dashed link rendering still indicates fields. We replicate the **fixed** model.

### 2.4 `NodeLink`
```
from_node, from_socket, to_node, to_socket
is_valid     : bool   # true if types/poll allow it
is_muted     : bool
multi_input_sort_id : int   # ordering inside a multi-input socket
```

### 2.5 `NodeTreeInterface` (the modern group I/O API, 4.0+)
```
items_tree : ordered tree of NodeTreeInterfaceSocket / Panel
new_socket(name, description, in_out, socket_type, parent=None) -> NodeTreeInterfaceSocket
new_panel(name, default_closed=False) -> NodeTreeInterfacePanel
remove(item)
move(item, to_position)
```
Replaces the legacy `tree.inputs` / `tree.outputs`. Panels group sockets visually.

---

## 3. Evaluation models per system

Each system has a fundamentally different runtime. We need to model them all.

### 3.1 Shader Node Trees → GPU shader codegen
- The tree is a **pull-based DAG**, walked from `ShaderNodeOutputMaterial` (or `…World`/`…Light`) backwards.
- Each node emits a snippet of **GLSL** (EEVEE) or **OSL / SVM bytecode** (Cycles). EEVEE-Next uses a unified material library written in GLSL with `#include` chunks.
- `Shader` sockets are not "values" — they are **BSDF closures**: opaque handles carrying surface response data (diffuse, specular, transmission, emission, normal). Closures can be added (`Add Shader`) or mixed (`Mix Shader`).
- Constants (literal default values) are inlined; varying inputs (UV, position, normal, generated coords) come from a fixed library of inputs (`ShaderNodeTexCoord`, `ShaderNodeGeometry`).
- **Our equivalent**: emit Three.js TSL (Three Shading Language) nodes. TSL is essentially a JS DSL that compiles to GLSL/WGSL — a near-perfect target. `MeshStandardNodeMaterial` exposes the same slot names (`colorNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `positionNode`, `opacityNode`, `aoNode`) that Blender's Principled BSDF feeds.

### 3.2 Geometry Node Trees → multi-function / field evaluator
- Two node categories:
  - **Data‑flow nodes** carry geometry through round sockets (`Set Position`, `Transform Geometry`, `Join Geometry`, `Mesh Boolean`, primitives, `Distribute Points on Faces`…).
  - **Field nodes** are diamond-socket *functions*: they don't compute by themselves; they are **evaluated in the context** of the geometry consumer (`Set Position` evaluates its `Offset` field once per point of its incoming geometry).
- A field is conceptually `(context: AttributeDomain, geometry: Geometry) → Value[]`. It is built lazily by composition; when a data-flow node consumes it, the field is materialised over the relevant domain (`POINT`, `EDGE`, `FACE`, `CORNER`, `CURVE`, `INSTANCE`).
- Geometry is a **container** of components: `Mesh`, `Curves`, `PointCloud`, `Volume`, `Instances`. Each carries **attributes** (named per-domain arrays: built-in `position`, `normal`, `radius`, `id`, plus anonymous + named user attributes).
- Implementation in Blender uses C++ multi-functions ("MFN"), SIMD spans, and an implicit-sharing CoW system.
- **Our equivalent**: TypeScript field abstractions backed by `Float32Array`/`Int32Array` per-domain attribute buffers; lazy materialisation when a data-flow node executes. Geometry mapped to **BufferGeometry** for rendering. `Instances` mapped to `InstancedMesh` / R3F `<Instances>`.

### 3.3 Compositor Node Trees → image buffer DAG
- Tree is converted into an **operation graph** (`Operation` nodes that own input/output `Result` buffers — either `GPUTexture` or CPU `GSpan`).
- Two backends:
  - **CPU**: full‑frame execution, multi-threaded; "ShaderOperation" lumps adjacent pixel-wise nodes into one GLSL-compiled kernel.
  - **GPU**: WebGPU/Vulkan/OpenGL kernels; the new "GPU compositor" is the default.
- Each operation declares: `determineResolution()`, `execPixels()` (CPU) or a kernel function (GPU), `getNPasses()` for multi‑pass nodes.
- **Our equivalent**: render each compositor pass to a `WebGLRenderTarget` (or `WebGPURenderTarget`), chain them via fullscreen quad shaders. Pixel‑wise nodes are fused into a single fragment shader. Filter nodes (blur, glare, denoise) use dedicated passes from postprocessing libs.

### 3.4 Texture Node Trees → per‑sample callback
- Legacy Blender Internal trees, mostly superseded by procedural shader textures, but addons still target them. Each node implements `exec(coord, derivative) → color`. Simple to evaluate analytically.

---

## 4. Node categories (canonical lists we must implement)

This is a complete list of built-in nodes in Blender 4.x / 5.x that we plan to ship. Implementing all of them is large; in code we group by category and progressively implement.

### 4.1 Common (all systems)
- Group Input / Group Output / Group (instanced node group)
- Frame, Reroute
- Note (text annotation)
- Custom Group (user-defined node group)
- Color Ramp, RGB Curves, Vector Curves, Float Curve, Brightness/Contrast, Gamma, Hue/Saturation/Value, Invert, Mix Color, RGB→BW
- Math (50+ ops), Vector Math (~25 ops), Boolean Math, Compare, Map Range, Clamp, Combine/Separate XYZ/RGB/HSV/Color, Random Value, Switch, Index Switch, Menu Switch

### 4.2 Shader nodes
- **Output**: Material Output, World Output, Light Output, AOV Output
- **Shaders (BSDFs)**: Principled BSDF, Principled Hair BSDF, Principled Volume, Diffuse, Glossy, Anisotropic, Refraction, Glass, Transparent, Translucent, Velvet/Sheen, Toon, Subsurface Scattering, Hair, Emission, Background, Ambient Occlusion, Holdout, Volume Absorption, Volume Scatter, Volume Info, Add Shader, Mix Shader
- **Textures**: Image, Environment, Sky, Noise, Voronoi, Musgrave/Hetero‑Terrain (legacy), Wave, Magic, Brick, Checker, Gradient, IES, Point Density, White Noise
- **Color**: see Common
- **Vector**: Bump, Normal, Normal Map, Vector Displacement, Mapping, Vector Rotate, Vector Transform
- **Converter**: ColorRamp, Combine/Separate, Map Range, Math, RGB to BW, Shader to RGB (EEVEE)
- **Input**: Attribute, Camera Data, Fresnel, Geometry, Hair Info, Layer Weight, Light Path, Object Info, Particle Info, RGB, Tangent, Texture Coordinate, UV Map, Value, Vertex Color, Volume Info, Wireframe, Curves Info
- **Script**: OSL Script (Cycles only)

### 4.3 Geometry nodes (5.x, condensed by group)
- **Attribute**: Attribute Statistic, Capture Attribute, Domain Size, Remove Named Attribute, Store Named Attribute, Named Attribute, Blur Attribute
- **Input → Constant**: Boolean, Collection, Color, Image, Integer, Material, Object, Rotation, String, Value, Vector
- **Input → Gizmo**: Linear, Dial, Transform
- **Input → Group**: Group Input/Output
- **Input → Scene**: Active Camera, Collection Info, Image Info, Is Viewport, Object Info, Scene Time, Self Object
- **Input → File**: Import OBJ/PLY/STL/CSV/VDB
- **Geometry → Read**: Position, Normal, Radius, ID, Index, Named Attribute, Selection, Active Element
- **Geometry → Sample**: Geometry Proximity, Index of Nearest, Raycast, Sample Index, Sample Nearest
- **Geometry → Write**: Set ID, Set Position, Set Selection, Set Geometry Name
- **Geometry → Operations**: Bake, Bounding Box, Convex Hull, Delete Geometry, Duplicate Elements, Merge by Distance, Sort Elements, Split To Instances, Transform Geometry, Separate Components, Separate Geometry, Displace Geometry, Smooth Geometry, Geometry to Instance, Join Geometry, Geometry Input
- **Geometry → Material**: Replace Material, Material Index, Material Selection, Set Material, Set Material Index
- **Geometry → Selection**: Box Selection, Normal Selection, Sphere Selection
- **Mesh → Read**: 20+ topology / measurement nodes
- **Mesh → Primitives**: Cone, Cube, Cylinder, Grid, Icosphere, Mesh Circle, Mesh Line, UV Sphere
- **Mesh → Operations**: Dual Mesh, Edge Paths to Curves/Selection, Extrude Mesh, Flip Faces, Mesh Boolean, Mesh to Curve, Mesh to Points, Mesh to (Density/SDF/Volume) Grid, Scale Elements, Split Edges, Subdivide, Subdivision Surface, Triangulate
- **Mesh → Topology**: Corners of Edge/Face/Vertex, Edges of Corner/Vertex, Face of Corner, Offset Corner in Face, Vertex of Corner
- **Mesh → UV**: Pack UV Islands, UV Tangent, UV Unwrap
- **Curves → Read**: 18 nodes (Spline Length, Curve Tangent, Endpoint Selection, Spline Resolution, Handle Type Selection, Curve Tilt, Spline Cyclic, Curve Parameter, Spline Type Selection, Index in Spline …)
- **Curves → Sample**: Sample Curve
- **Curves → Write**: Set Curve Normal, Set Curve Radius, Set Curve Tilt, Set Handle Type, Set Spline Cyclic, Set Spline Resolution, Set Spline Type
- **Curves → Operations**: Curve to Mesh, Curve to Points, Deform Curves on Surface, Fill Curve, Fillet Curve, Interpolate Curves, Resample Curve, Reverse Curve, Subdivide Curve, Trim Curve
- **Curves → Primitives**: Arc, Bezier Segment, Curve Circle, Curve Line, Curve Spiral, Quadratic Bezier, Star, Quadrilateral
- **Curves → Topology**: Curve of Point, Offset Point in Curve, Points of Curve
- **Points → Read/Write/Operations**: Points to Curves/Vertices/Volume, Distribute Points in Grid/Volume, Distribute Points on Faces, Set Point Radius, Points
- **Instances**: Instance on Points, Instances to Points, Realize Instances, Rotate Instances, Scale Instances, Translate Instances, Set Instance Transform, Instance Transform, Instance Rotation, Instance Scale
- **Volume / Grid**: 25+ nodes for OpenVDB integration (sparse grids, advect, gradient/divergence/laplacian, level sets, voxelize, SDF ops)
- **Simulation / Repeat / Foreach Element**: zone nodes — special!
- **Texture (same as shader)**: Brick, Checker, Gradient, Image, Magic, Noise, Voronoi, Wave, White Noise
- **Utilities**: same Common set + Field‑specific (Accumulate Field, Evaluate at Index, Evaluate on Domain, Field on Domain), Rotation utilities, Matrix utilities, Vector utilities

### 4.4 Compositor nodes
- **Input**: Render Layers, Image, Movie Clip, Mask, Texture, Bokeh Image, Time Curve, Track Position, RGB, Value, Scene Time
- **Output**: Composite, Viewer, File Output, Split Viewer
- **Color**: Alpha Over, Brightness/Contrast, Color Balance, Color Correction, Gamma, Hue Saturation Value, Hue Correct, Invert, Mix, Posterize, Tonemap, Z Combine, Exposure, Gamma
- **Filter**: Blur (gaussian/fast/bokeh/zoom/directional/motion/vector), Glare, Defocus, Denoise (OpenImageDenoise), Despeckle, Dilate/Erode, Filter (kuwahara/sharpen/edge), Inpaint, Pixelate, Sun Beams, Anti-Aliasing
- **Vector**: Map Range, Map UV, Normal, Normalize, Vector Curves, Velocity
- **Matte**: Box/Ellipse/Cryptomatte/Channel/Chroma/Color Key/Color Spill/Difference/Distance/Keying/Keying Screen/Luminance Key
- **Distort**: Corner Pin, Crop, Displace, Flip, Lens Distortion, Map UV, Movie Distortion, Plane Track Deform, Rotate, Scale, Stabilize 2D, Transform, Translate
- **Track**: Plane Track Deform, Stabilize 2D, Track Position
- **Layout**: same as Common
- **Converter**: Alpha Convert, Color Ramp, Combine/Separate XYZ/RGBA/HSVA/YUVA/YCbCrA, ID Mask, Math, RGB to BW, Set Alpha, Switch, Switch View

### 4.5 Texture nodes (legacy)
- Output, Image, Curve Time, Coordinates, Noise, Magic, Blend, Marble, Clouds, Wood, Distorted Noise, Voronoi, Bricks, Stucci, Checker
- ColorRamp, Mix, Hue/Sat/Value, Combine/Separate, Math, RGB to BW, Value to Normal
- Bricks, Translate, Scale, Rotate, At, Curve RGB, Invert, Distance, …

---

## 5. Group nodes & the interface system

Group nodes are the **single most important feature** for addon compatibility — most Blender addons ship as `.blend` files containing **node groups** loaded into the user's scene.

A node group consists of:
- A **child `NodeTree`** (any of the 4 types)
- An **interface** (`NodeTreeInterface`) defining inputs + outputs + panels
- Two virtual nodes embedded in the child tree: `NodeGroupInput`, `NodeGroupOutput`
- A **container node** (`ShaderNodeGroup`, `GeometryNodeGroup`, `CompositorNodeGroup`, `TextureNodeGroup`) that holds a reference (`node_tree`) to the child tree and exposes its interface as its own sockets

**Recursive evaluation rule:** A group node behaves exactly like inlining its child tree, with the group inputs taking the values from the container node's input sockets, and the container's outputs reading from the group output node's inputs.

**Versioning:** groups are versioned by interface. When the interface changes, existing container nodes auto-migrate by socket `identifier` (stable IDs, not names).

---

## 6. Special node zones (Geometry Nodes, 4.0+)

- **Simulation Zone** (`Simulation Input` ↔ `Simulation Output`): state is preserved between frames. The output feeds back as the input next frame. Used for cloth, particles, growth.
- **Repeat Zone** (`Repeat Input` ↔ `Repeat Output`): runs the enclosed sub-graph N times, feeding output back as input. For iterative algorithms.
- **Foreach Element Zone** (`Foreach Element Input` ↔ `Foreach Element Output`, 4.4+): operate per element of a geometry/list.

Zones require:
- A **paired link** between input and output nodes (special `zone_id` matching)
- Their own scoped attribute & state buffers
- A specialised evaluator that knows how to iterate / accumulate

---

## 7. Drivers, animation, and dependency graph

- Any node socket / property can be **animated** via keyframes or **driven** by a Python expression (`bpy.app.drivers`).
- The **Depsgraph** tracks data dependencies (object → mesh → modifier → nodetree → group → …) and triggers re-evaluation on change.
- For our system: every editable property becomes a Zustand atom; we run incremental re-evaluation with a topological dirty-flag walker.

---

## 8. Wire-format & .blend import

The .blend file format is a complex C-struct dump (DNA + SDNA + BHead chunks). Direct .blend reading from JS is technically feasible (cf. `blender-file` projects) but **enormous**. A pragmatic approach:

1. **Python export side**: a small Blender addon walks `bpy.data.node_groups` and serialises each tree to a JSON document matching our schema (`BNGSchema v1`).
2. **JS import side**: validate against the schema, instantiate `NodeTree`, `Node`, `NodeSocket`, `NodeLink` objects through the public runtime API — exactly as if a user had constructed them.

**Round-trippable.** The same JSON can be re-imported into Blender via the exporter's inverse.

---

## 9. Why React Flow + Zustand + R3F is the right stack

| Concern | Choice | Reason |
|---|---|---|
| Node graph rendering | **React Flow 12** | Mature DAG editor, zoom/pan/minimap, custom nodes, multi-input handles, sub-flows for zones, undo/redo plugins. |
| Reactive state | **Zustand** | Atomic store, perfect for mutating large node trees without React reconciler thrashing. Plays well with React Flow's controlled mode. |
| 3D viewport | **react-three-fiber + drei + TSL** | Declarative R3F means the viewport tracks the evaluator's output naturally. TSL maps near 1:1 to Blender shader nodes. |
| Field evaluator | Pure TS, no framework | Headless library so it can run in workers / SSR / Node CLI. |
| Schema validation | **Zod** | JSON import safety + type inference. |
| Workers | **Comlink** | Move heavy geometry eval off the main thread. |
| Build | **Vite + TypeScript strict** | Fast HMR, ESM-first. |
| UI chrome | **Tailwind + Radix** | Quickly match Blender's dark, dense look. |

---

## 10. Mapping table: Blender → our system (executive summary)

| Blender concept | Our module |
|---|---|
| `bpy.types.NodeTree` | `src/core/NodeTree.ts` |
| `bpy.types.Node` | `src/core/Node.ts` (abstract) |
| `bpy.types.NodeSocket` | `src/core/NodeSocket.ts` (+ subclasses in `src/sockets/`) |
| `bpy.types.NodeLink` | `src/core/NodeLink.ts` |
| `bpy.types.NodeTreeInterface` | `src/core/NodeTreeInterface.ts` |
| `bpy.props.*` | `src/core/Properties.ts` (FloatProperty, EnumProperty, …) |
| `bpy.utils.register_class` | `src/registry/NodeRegistry.ts` |
| `nodeitems_utils.NodeCategory` | `src/registry/NodeRegistry.ts` (`NodeCategory` + `NodeCategories` + `NodeItem` classes) |
| Depsgraph | `src/eval/Depsgraph.ts` |
| Shader evaluator | `src/eval/ShaderEvaluator.ts` → emits TSL |
| Geometry evaluator | `src/eval/GeometryEvaluator.ts` → executes MFN over BufferGeometry |
| Compositor evaluator | `src/eval/CompositorEvaluator.ts` → WebGL/WebGPU render-target chain |
| Texture evaluator | `src/eval/TextureEvaluator.ts` → per-sample callback |
| Group nodes | `src/nodes/common/Group.ts` (calls child tree's evaluator recursively) |
| Frame / Reroute | `src/nodes/common/Frame.ts`, `src/nodes/common/Reroute.ts` |
| Simulation / Repeat / Foreach zones | `src/eval/zones/` |
| .blend bridge | `src/bridge/blender_exporter.py` + `src/bridge/importer.ts` |
| React Flow editor | `src/ui/NodeEditor.tsx` |
| Viewport | `demo/Viewport.tsx` |

---

## 11. References

- Blender Manual — Geometry Nodes / Fields: https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/
- Blender Manual — Compositor: https://docs.blender.org/manual/en/latest/compositing/
- Blender Python API: https://docs.blender.org/api/current/
- `bpy.types.NodeTreeInterface`: https://docs.blender.org/api/current/bpy.types.NodeTreeInterface.html
- DeepWiki — Blender Compositor: https://deepwiki.com/blender/blender/9.2-compositor
- Blender Devblog — New socket shapes (Aug 2025): https://code.blender.org/2025/08/new-socket-shapes/
- Three.js TSL: https://threejs.org/docs/TSL.html
- React Flow: https://reactflow.dev/
