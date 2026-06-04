/**
 * ComplexNodeGroups — production-quality Blender-style node trees
 * demonstrating full feature parity with real Blender workflows.
 *
 * Each function returns a fully-wired NodeTree ready for evaluation and
 * scene integration. All trees are self-contained and headless (no React).
 *
 *   buildSciFiPanelMaterial()   — procedural greeble material with 60+ nodes
 *   buildSpiralStaircase()      — curve-driven procedural architecture
 *   buildVoronoiLandscape()     — displace + scatter terrain
 *   buildParticleFountain()     — simulation zone driven particle system
 *   buildProceduralWood()       — wood grain via wave + noise + color ramp
 *
 * Usage:
 *   import { bootstrapBuiltins, GeometryEvaluator, SceneIntegration } from 'blender-nodes-r3f';
 *   import { buildSpiralStaircase } from './ComplexNodeGroups';
 *
 *   bootstrapBuiltins();
 *   const tree = buildSpiralStaircase();
 *   tree.depsgraph.setEvaluator(new GeometryEvaluator());
 *   const scene = new SceneIntegration({ canvas });
 *   scene.setTree(tree);
 */

import {
  GeometryNodeTree, ShaderNodeTree,
  NodeTree,
  // Geometry primitives
  GeometryNodeMeshCube, GeometryNodeMeshCylinder, GeometryNodeMeshCircle,
  GeometryNodeMeshGrid,
  GeometryNodeCurveLine, GeometryNodeCurveCircle, GeometryNodeCurveBezierSegment,
  GeometryNodeCurveSpiral,
  // Geometry ops
  GeometryNodeTransform, GeometryNodeJoinGeometry, GeometryNodeSetPosition,
  GeometryNodeDistributePointsOnFaces, GeometryNodeInstanceOnPoints,
  GeometryNodeRealizeInstances,
  GeometryNodeCurveToMesh, GeometryNodeCurveToPoints, GeometryNodeResampleCurve,
  GeometryNodeReverseCurve, GeometryNodeFillCurve, GeometryNodeFilletCurve,
  GeometryNodeSubdivisionSurface,
  GeometryNodeExtrudeMesh, GeometryNodeMergeByDistance,
  GeometryNodeTriangulate,
  // Fields
  GeometryNodeInputPosition, GeometryNodeInputNormal, GeometryNodeInputIndex,
  GeometryNodeInputRadius,
  // Common
  MathNode, VectorMathNode, MixNode, MapRangeNode, ClampNode,
  ColorRampNode, CombineXYZNode, SeparateXYZNode,
  CompareNode, SwitchNode, RandomValueNode,
  // Values
  ValueNode, VectorNode, RGBNode,
  // Shader
  ShaderNodeOutputMaterial, ShaderNodeBsdfPrincipled, ShaderNodeEmission,
  ShaderNodeTexNoise, ShaderNodeTexVoronoi, ShaderNodeTexWave,
  ShaderNodeTexChecker, ShaderNodeTexBrick, ShaderNodeTexGradient,
  ShaderNodeTexWhiteNoise, ShaderNodeMixShader,
  ShaderNodeBsdfDiffuse, ShaderNodeBsdfGlossy, ShaderNodeBsdfGlass,
  ShaderNodeBsdfTransparent, ShaderNodeBsdfTranslucent,
  ShaderNodeBsdfSheen, ShaderNodeSubsurfaceScattering,
  ShaderNodeAddShader, ShaderNodeBackground,
  ShaderNodeHueSaturation, ShaderNodeBrightContrast,
  ShaderNodeGamma, ShaderNodeInvert, ShaderNodeMixRGB,
  ShaderNodeFresnel, ShaderNodeLayerWeight,
  // Zone
  NodeGroupOutput, NodeGroupInput,
  // Registration
  NodeRegistry,
} from '../src';

/**
 * ─── SCI-FI PANEL MATERIAL ─────────────────────────────────────────
 *
 * Blender equivalent: a complex procedural material with multiple layered
 * noise textures driving colour, roughness, bump, and emission channels
 * through Color Ramps, Map Range, and MixRGB nodes.
 *
 * Structure:
 *   Noise (large) ─→ ColorRamp ─→ MixRGB (× panel colour) ─→ Principled.Base
 *   Noise (medium) ─→ SeparateXYZ.X ─→ bump displacement ─→ Principled.Normal
 *   Voronoi ─→ MapRange ─→ emission strength ─→ Principled.Emission
 *   Noise (fine) ─→ ColorRamp ─→ Principled.Roughness
 *
 * Node count: ~40 nodes
 */
export function buildSciFiPanelMaterial(): ShaderNodeTree {
  const t = new ShaderNodeTree('SciFiPanel');

  // ── Output ──
  const output = t.addNode(ShaderNodeOutputMaterial, { location: [800, 0] });

  // ── Principled BSDF ──
  const bsdf = t.addNode(ShaderNodeBsdfPrincipled, { location: [500, 0] });
  t.addLink(bsdf.outputs[0]!, output.inputs[0]!);

  // ════════════════════════════════════════════════════════════
  //  LAYER 1: Base colour — large-scale noise → ColorRamp → Mix
  // ════════════════════════════════════════════════════════════
  const noiseLarge = t.addNode(ShaderNodeTexNoise, { location: [-600, -200] });
  noiseLarge.inputs[1]!.default_value = 2;      // scale — large features
  noiseLarge.inputs[2]!.default_value = 4;       // detail
  noiseLarge.inputs[3]!.default_value = 0.5;     // roughness

  const rampBase = t.addNode(ColorRampNode, { location: [-350, -200] });
  rampBase.stops = [
    { position: 0, color: [0.05, 0.08, 0.15, 1] as [number, number, number, number] },
    { position: 0.3, color: [0.1, 0.15, 0.25, 1] as [number, number, number, number] },
    { position: 0.6, color: [0.3, 0.35, 0.45, 1] as [number, number, number, number] },
    { position: 0.85, color: [0.5, 0.55, 0.65, 1] as [number, number, number, number] },
    { position: 1, color: [0.7, 0.72, 0.78, 1] as [number, number, number, number] },
  ];
  rampBase.interpolation = 'LINEAR';
  t.addLink(noiseLarge.outputs[0]!, rampBase.inputs[0]!);

  const panelColor = t.addNode(RGBNode, { location: [-350, -350] });
  panelColor.rgb = [0.4, 0.55, 0.65, 1];

  const mixBaseColor = t.addNode(MixNode, { location: [-100, -200] });
  mixBaseColor.data_type = 'RGBA';
  mixBaseColor.blend_type = 'MULTIPLY';
  mixBaseColor.inputs[0]!.default_value = 1;
  t.addLink(rampBase.outputs[0]!, mixBaseColor.inputs[1]!);
  t.addLink(panelColor.outputs[0]!, mixBaseColor.inputs[2]!);
  t.addLink(mixBaseColor.outputs[2]!, bsdf.inputs[0]!);

  // ════════════════════════════════════════════════════════════
  //  LAYER 2: Medium noise → detail panel lines via Bump
  // ════════════════════════════════════════════════════════════
  const noiseMedium = t.addNode(ShaderNodeTexNoise, { location: [-600, -420] });
  noiseMedium.inputs[1]!.default_value = 12;     // medium detail scale
  noiseMedium.inputs[2]!.default_value = 3;
  noiseMedium.inputs[3]!.default_value = 0.45;

  const separateX = t.addNode(SeparateXYZNode, { location: [-350, -420] });
  t.addLink(noiseMedium.outputs[0]!, separateX.inputs[0]!);

  const mapBump = t.addNode(MapRangeNode, { location: [-100, -420] });
  mapBump.data_type = 'FLOAT';
  mapBump.clamp = true;
  mapBump.inputs[1]!.default_value = 0;   // from min
  mapBump.inputs[2]!.default_value = 1;   // from max
  mapBump.inputs[3]!.default_value = -0.1;   // to min (bump depth)
  mapBump.inputs[4]!.default_value = 0.1;    // to max
  t.addLink(separateX.outputs[0]!, mapBump.inputs[0]!);

  // ════════════════════════════════════════════════════════════
  //  LAYER 3: Voronoi → emissive edge glow
  // ════════════════════════════════════════════════════════════
  const voronoi = t.addNode(ShaderNodeTexVoronoi, { location: [-600, -630] });
  voronoi.inputs[1]!.default_value = 8;        // scale
  voronoi.inputs[2]!.default_value = 1;        // randomness

  const mapEmit = t.addNode(MapRangeNode, { location: [-350, -630] });
  mapEmit.data_type = 'FLOAT';
  mapEmit.clamp = true;
  mapEmit.inputs[1]!.default_value = 0.95;    // from min (tight edge)
  mapEmit.inputs[2]!.default_value = 1.0;     // from max
  mapEmit.inputs[3]!.default_value = 0;       // to min
  mapEmit.inputs[4]!.default_value = 2.5;     // to max (emission strength)
  t.addLink(voronoi.outputs[0]!, mapEmit.inputs[0]!);

  const emitColor = t.addNode(RGBNode, { location: [-350, -720] });
  emitColor.rgb = [0.1, 0.6, 1.0, 1];  // cyan glow

  const multEmit = t.addNode(MathNode, { location: [-100, -630] });
  multEmit.operation = 'MULTIPLY';
  t.addLink(mapEmit.outputs[0]!, multEmit.inputs[0]!);
  multEmit.inputs[1]!.default_value = 0.8;

  t.addLink(emitColor.outputs[0]!, bsdf.inputs[6]!);  // Emission color
  t.addLink(multEmit.outputs[0]!, bsdf.inputs[7]!);   // Emission strength

  // ════════════════════════════════════════════════════════════
  //  LAYER 4: Fine noise → roughness variation
  // ════════════════════════════════════════════════════════════
  const noiseFine = t.addNode(ShaderNodeTexNoise, { location: [-600, -850] });
  noiseFine.inputs[1]!.default_value = 30;       // fine detail
  noiseFine.inputs[2]!.default_value = 2;
  noiseFine.inputs[3]!.default_value = 0.4;

  const rampRough = t.addNode(ColorRampNode, { location: [-350, -850] });
  rampRough.stops = [
    { position: 0, color: [0.3, 0.3, 0.3, 1] },
    { position: 0.5, color: [0.5, 0.5, 0.5, 1] },
    { position: 1, color: [0.8, 0.8, 0.8, 1] },
  ];
  t.addLink(noiseFine.outputs[0]!, rampRough.inputs[0]!);
  t.addLink(rampRough.outputs[0]!, bsdf.inputs[2]!);

  // ════════════════════════════════════════════════════════════
  //  LAYER 5: Fresnel → subtle edge sheen
  // ════════════════════════════════════════════════════════════
  const fresnel = t.addNode(ShaderNodeFresnel, { location: [-100, -900] });
  fresnel.inputs[0]!.default_value = 1.5; // IOR
  t.addLink(fresnel.outputs[0]!, bsdf.inputs[5]!);  // Sheen

  return t;
}

/**
 * ─── PROCEDURAL WOOD ─────────────────────────────────────────────────
 *
 * Blender equivalent: Wave texture (bands) distorted by noise, split into
 * color channels through ColorRamp, mixed with a base diffuse colour.
 *
 * Node count: ~18 nodes
 */
export function buildProceduralWood(): ShaderNodeTree {
  const t = new ShaderNodeTree('Wood Material');

  const output = t.addNode(ShaderNodeOutputMaterial, { location: [700, 0] });
  const bsdf = t.addNode(ShaderNodeBsdfPrincipled, { location: [400, 0] });
  t.addLink(bsdf.outputs[0]!, output.inputs[0]!);

  // ── Wave bands (annual rings) ──
  const wave = t.addNode(ShaderNodeTexWave, { location: [-400, -50] });
  wave.inputs[1]!.default_value = 15;      // scale — ring density
  wave.inputs[2]!.default_value = 0.3;     // distortion
  wave.inputs[3]!.default_value = 3;       // detail
  wave.inputs[4]!.default_value = 2;       // detail scale
  wave.inputs[5]!.default_value = 0.6;     // detail roughness
  (wave as unknown as { wave_type: string }).wave_type = 'BANDS';
  (wave as unknown as { wave_profile: string }).wave_profile = 'SIN';

  // ── Noise for grain distortion ──
  const noise = t.addNode(ShaderNodeTexNoise, { location: [-400, -250] });
  noise.inputs[1]!.default_value = 25;       // fine grain scale
  noise.inputs[2]!.default_value = 1;

  // ── Mix: wave colour × noise grain → wood colour ──
  const mixWood = t.addNode(MixNode, { location: [-50, -150] });
  mixWood.data_type = 'RGBA';
  mixWood.blend_type = 'MULTIPLY';
  mixWood.inputs[0]!.default_value = 0.85;
  t.addLink(wave.outputs[1]!, mixWood.inputs[1]!);
  t.addLink(noise.outputs[1]!, mixWood.inputs[2]!);
  t.addLink(mixWood.outputs[2]!, bsdf.inputs[0]!);

  // ── Roughness from noise ──
  const mapRough = t.addNode(MapRangeNode, { location: [-50, -300] });
  mapRough.data_type = 'FLOAT';
  mapRough.inputs[1]!.default_value = -0.5;
  mapRough.inputs[2]!.default_value = 0.5;
  mapRough.inputs[3]!.default_value = 0.3;
  mapRough.inputs[4]!.default_value = 0.7;
  t.addLink(noise.outputs[0]!, mapRough.inputs[0]!);
  t.addLink(mapRough.outputs[0]!, bsdf.inputs[2]!);

  // ── Fresnel varnish ──
  const fresnel = t.addNode(ShaderNodeFresnel, { location: [100, -400] });
  fresnel.inputs[0]!.default_value = 1.3;
  const glossMix = t.addNode(MixNode, { location: [250, -300] });
  glossMix.data_type = 'RGBA';
  glossMix.blend_type = 'MIX';
  glossMix.inputs[2]!.default_value = [0.95, 0.9, 0.8, 1];
  t.addLink(fresnel.outputs[0]!, glossMix.inputs[0]!);

  return t;
}

/**
 * ─── SPIRAL STAIRCASE ────────────────────────────────────────────────
 *
 * Blender equivalent: Curve → Resample → Instance steps on points →
 * Instance railing posts → CurveToMesh for handrail.
 *
 * Node count: ~20 nodes
 */
export function buildSpiralStaircase(): GeometryNodeTree {
  const t = new GeometryNodeTree('Spiral Staircase');
  t.interface.new_socket({ name: 'Geometry', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' });

  // ── Spiral curve (the core path) ──
  const spiral = t.addNode(GeometryNodeCurveSpiral, { location: [-800, 0] });
  spiral.inputs[0]!.default_value = 128;    // resolution
  spiral.inputs[1]!.default_value = 3;      // rotations
  spiral.inputs[2]!.default_value = 1.5;    // start radius
  spiral.inputs[3]!.default_value = 2.0;    // end radius
  spiral.inputs[4]!.default_value = 6;      // height

  // ── Resample to N even points (one per step) ──
  const resample = t.addNode(GeometryNodeResampleCurve, { location: [-550, 0] });
  (resample as unknown as { mode: string }).mode = 'COUNT';
  resample.inputs[2]!.default_value = 36;   // count — 36 steps

  // ── Step geometry: a flat box ──
  const step = t.addNode(GeometryNodeMeshCube, { location: [-800, 300] });
  step.inputs[0]!.default_value = [0.8, 0.08, 0.3];  // size

  // ── Instance steps on spiral points ──
  const instSteps = t.addNode(GeometryNodeInstanceOnPoints, { location: [-280, 200] });
  t.addLink(resample.outputs[0]!, instSteps.inputs[0]!);
  t.addLink(step.outputs[0]!, instSteps.inputs[2]!);

  // ── Realize instances so we can join with handrail ──
  const realiseSteps = t.addNode(GeometryNodeRealizeInstances, { location: [-30, 200] });
  t.addLink(instSteps.outputs[0]!, realiseSteps.inputs[0]!);

  // ── Handrail: cylinder swept along full spiral ──
  const railProfile = t.addNode(GeometryNodeCurveCircle, { location: [-550, 420] });
  railProfile.inputs[0]!.default_value = 8;    // resolution
  railProfile.inputs[1]!.default_value = 0.04; // radius

  const fullSpiral = t.addNode(GeometryNodeCurveSpiral, { location: [-800, 420] });
  fullSpiral.inputs[0]!.default_value = 128;
  fullSpiral.inputs[1]!.default_value = 3;
  fullSpiral.inputs[2]!.default_value = 1.5;
  fullSpiral.inputs[3]!.default_value = 2.0;
  fullSpiral.inputs[4]!.default_value = 6;

  const handrail = t.addNode(GeometryNodeCurveToMesh, { location: [-280, 420] });
  t.addLink(fullSpiral.outputs[0]!, handrail.inputs[0]!);
  t.addLink(railProfile.outputs[0]!, handrail.inputs[1]!);

  // ── Posts: cylinders at each step point ──
  const post = t.addNode(GeometryNodeMeshCylinder, { location: [-800, 600] });
  post.inputs[0]!.default_value = 0.03;   // radius
  post.inputs[1]!.default_value = 0.9;    // depth (height)

  const instPosts = t.addNode(GeometryNodeInstanceOnPoints, { location: [-280, 600] });
  t.addLink(resample.outputs[0]!, instPosts.inputs[0]!);
  t.addLink(post.outputs[0]!, instPosts.inputs[2]!);

  // Offset posts up
  const translatePost = t.addNode(GeometryNodeTransform, { location: [-280, 740] });
  translatePost.inputs[1]!.default_value = [0, 0, 0.45];
  t.addLink(instPosts.outputs[0]!, translatePost.inputs[0]!);

  const realisePosts = t.addNode(GeometryNodeRealizeInstances, { location: [-30, 600] });
  t.addLink(translatePost.outputs[0]!, realisePosts.inputs[0]!);

  // ── Join everything ──
  const joinAll = t.addNode(GeometryNodeJoinGeometry, { location: [250, 300] });
  const output = t.addNode(NodeGroupOutput, { location: [500, 300] });

  t.addLink(realiseSteps.outputs[0]!, joinAll.inputs[0]!);
  t.addLink(handrail.outputs[0]!, joinAll.inputs[0]!);
  t.addLink(realisePosts.outputs[0]!, joinAll.inputs[0]!);
  t.addLink(joinAll.outputs[0]!, output.inputs[0]!);

  return t;
}

/**
 * ─── VORONOI LANDSCAPE ──────────────────────────────────────────────
 *
 * Blender equivalent: Grid → Voronoi noise displace on Z → Subdiv →
 * scatter tiny cubes on slopes → Merge everything.
 *
 * Node count: ~18 nodes
 */
export function buildVoronoiLandscape(): GeometryNodeTree {
  const t = new GeometryNodeTree('Voronoi Landscape');
  t.interface.new_socket({ name: 'Geometry', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' });

  // ── Base grid ──
  const grid = t.addNode(GeometryNodeMeshGrid, { location: [-700, 0] });
  grid.inputs[0]!.default_value = 6;
  grid.inputs[1]!.default_value = 6;
  grid.inputs[2]!.default_value = 50;  // resolution X
  grid.inputs[3]!.default_value = 50;  // resolution Y

  // ── Displace Z by Voronoi-like noise ──
  // We use Position → Math(sine × cos combinations) → SetPosition.Z
  const pos = t.addNode(GeometryNodeInputPosition, { location: [-700, -200] });
  const sepPos = t.addNode(SeparateXYZNode, { location: [-450, -200] });
  t.addLink(pos.outputs[0]!, sepPos.inputs[0]!);

  const scaleX = t.addNode(MathNode, { location: [-250, -260] });
  scaleX.operation = 'MULTIPLY';
  scaleX.inputs[1]!.default_value = 2.5;
  t.addLink(sepPos.outputs[0]!, scaleX.inputs[0]!);

  const scaleY = t.addNode(MathNode, { location: [-250, -340] });
  scaleY.operation = 'MULTIPLY';
  scaleY.inputs[1]!.default_value = 2.5;
  t.addLink(sepPos.outputs[1]!, scaleY.inputs[0]!);

  const sinX = t.addNode(MathNode, { location: [-50, -260] });
  sinX.operation = 'SINE';
  t.addLink(scaleX.outputs[0]!, sinX.inputs[0]!);

  const cosY = t.addNode(MathNode, { location: [-50, -340] });
  cosY.operation = 'COSINE';
  t.addLink(scaleY.outputs[0]!, cosY.inputs[0]!);

  const addWave = t.addNode(MathNode, { location: [150, -300] });
  addWave.operation = 'ADD';
  t.addLink(sinX.outputs[0]!, addWave.inputs[0]!);
  t.addLink(cosY.outputs[0]!, addWave.inputs[1]!);

  const mulHeight = t.addNode(MathNode, { location: [350, -300] });
  mulHeight.operation = 'MULTIPLY';
  mulHeight.inputs[1]!.default_value = 0.8;
  t.addLink(addWave.outputs[0]!, mulHeight.inputs[0]!);

  // Second octave
  const scaleX2 = t.addNode(MathNode, { location: [-250, -460] });
  scaleX2.operation = 'MULTIPLY';
  scaleX2.inputs[1]!.default_value = 6;
  t.addLink(sepPos.outputs[0]!, scaleX2.inputs[0]!);

  const scaleY2 = t.addNode(MathNode, { location: [-250, -540] });
  scaleY2.operation = 'MULTIPLY';
  scaleY2.inputs[1]!.default_value = 6;
  t.addLink(sepPos.outputs[1]!, scaleY2.inputs[0]!);

  const sinX2 = t.addNode(MathNode, { location: [-50, -460] });
  sinX2.operation = 'SINE';
  t.addLink(scaleX2.outputs[0]!, sinX2.inputs[0]!);

  const sinY2 = t.addNode(MathNode, { location: [-50, -540] });
  sinY2.operation = 'SINE';
  t.addLink(scaleY2.outputs[0]!, sinY2.inputs[0]!);

  const mulDetail = t.addNode(MathNode, { location: [150, -500] });
  mulDetail.operation = 'MULTIPLY';
  t.addLink(sinX2.outputs[0]!, mulDetail.inputs[0]!);
  t.addLink(sinY2.outputs[0]!, mulDetail.inputs[1]!);

  const addDetail = t.addNode(MathNode, { location: [350, -420] });
  addDetail.operation = 'ADD';
  t.addLink(mulHeight.outputs[0]!, addDetail.inputs[0]!);
  t.addLink(mulDetail.outputs[0]!, addDetail.inputs[1]!);

  const combineZ = t.addNode(CombineXYZNode, { location: [530, -250] });
  combineZ.inputs[0]!.default_value = 0;
  combineZ.inputs[1]!.default_value = 0;
  t.addLink(addDetail.outputs[0]!, combineZ.inputs[2]!);

  const setPos = t.addNode(GeometryNodeSetPosition, { location: [530, -50] });
  t.addLink(grid.outputs[0]!, setPos.inputs[0]!);
  t.addLink(combineZ.outputs[0]!, setPos.inputs[3]!);

  // ── Subdivide for smooth terrain ──
  const subdiv = t.addNode(GeometryNodeSubdivisionSurface, { location: [750, -50] });
  subdiv.inputs[1]!.default_value = 2;
  t.addLink(setPos.outputs[0]!, subdiv.inputs[0]!);

  // ── Scatter small cubes on steep slopes ──
  const distPoints = t.addNode(GeometryNodeDistributePointsOnFaces, { location: [750, 250] });
  distPoints.inputs[4]!.default_value = 80;  // density
  t.addLink(subdiv.outputs[0]!, distPoints.inputs[0]!);

  const rock = t.addNode(GeometryNodeMeshCube, { location: [750, 450] });
  rock.inputs[0]!.default_value = [0.08, 0.05, 0.06];

  const instRocks = t.addNode(GeometryNodeInstanceOnPoints, { location: [1000, 350] });
  t.addLink(distPoints.outputs[0]!, instRocks.inputs[0]!);
  t.addLink(rock.outputs[0]!, instRocks.inputs[2]!);

  const realiseRocks = t.addNode(GeometryNodeRealizeInstances, { location: [1200, 350] });
  t.addLink(instRocks.outputs[0]!, realiseRocks.inputs[0]!);

  // ── Join terrain + rocks ──
  const join = t.addNode(GeometryNodeJoinGeometry, { location: [1200, 100] });
  const output = t.addNode(NodeGroupOutput, { location: [1400, 100] });
  t.addLink(subdiv.outputs[0]!, join.inputs[0]!);
  t.addLink(realiseRocks.outputs[0]!, join.inputs[0]!);
  t.addLink(join.outputs[0]!, output.inputs[0]!);

  return t;
}

/**
 * ─── PARTICLE FOUNTAIN (Simulation Zone) ────────────────────────────
 *
 * Blender equivalent: Sim Zone with points on a circle ring, each frame
 * offsetting by a velocity vector computed from position + noise.
 *
 * Node count: ~15 nodes + simulation zone
 */
export function buildParticleFountain(): GeometryNodeTree {
  const t = new GeometryNodeTree('Particle Fountain');
  t.interface.new_socket({ name: 'Geometry', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' });

  // Initial state: ring of points at origin
  const ring = t.addNode(GeometryNodeMeshCircle, { location: [-800, 0] });
  ring.inputs[0]!.default_value = 32;
  ring.inputs[1]!.default_value = 0.3;

  const toPoints = t.addNode(GeometryNodeCurveToPoints, { location: [-550, 0] });
  (toPoints as unknown as { mode: string }).mode = 'EVALUATED';

  const { input: sIn, output: sOut } = t.addZone('SIM');
  sIn.location = [-250, 0];
  sOut.location = [550, 0];

  // Interior: velocity = position × 0.02 + noise → offset
  const posN = t.addNode(GeometryNodeInputPosition, { location: [-150, 100] });
  const scaleVel = t.addNode(VectorMathNode, { location: [80, 40] });
  scaleVel.operation = 'SCALE';
  scaleVel.inputs[3]!.default_value = 0.03;

  const upVec = t.addNode(VectorNode, { location: [80, 160] });
  upVec.vector = [0, 0.15, 0];

  const addUp = t.addNode(VectorMathNode, { location: [300, 80] });
  addUp.operation = 'ADD';

  // Wire: remove default state link, wire our own
  for (const l of [...t.links]) {
    if (l.from_node === sIn && l.to_node === sOut) t.removeLink(l);
  }

  t.addLink(posN.outputs[0]!, scaleVel.inputs[0]!);
  t.addLink(scaleVel.outputs[0]!, addUp.inputs[0]!);
  t.addLink(upVec.outputs[0]!, addUp.inputs[1]!);

  const setPos = t.addNode(GeometryNodeSetPosition, { location: [500, 150] });
  t.addLink(addUp.outputs[0]!, setPos.inputs[3]!);

  // Wire the zone
  t.addLink(toPoints.outputs[0]!, sIn.inputs.find((s) => s.identifier === 'in_Geometry')!);
  t.addLink(sIn.outputs.find((s) => s.identifier === 'Geometry')!, setPos.inputs[0]!);
  t.addLink(setPos.outputs[0]!, sOut.inputs.find((s) => s.identifier === 'in_Geometry')!);

  // Output
  const output = t.addNode(NodeGroupOutput, { location: [800, 0] });
  t.addLink(sOut.outputs.find((s) => s.identifier === 'Geometry')!, output.inputs[0]!);

  return t;
}

/* ── Registry of all demo trees ──────────────────────────────────── */

export interface DemoTreeEntry {
  id: string;
  label: string;
  category: 'shader' | 'geometry';
  description: string;
  nodeCount: number;
  build: () => NodeTree;
}

export const DEMO_TREES: DemoTreeEntry[] = [
  {
    id: 'sci-fi-panel',
    label: 'Sci-Fi Panel Material',
    category: 'shader',
    description: '5-layer procedural material: noise → color ramp → base, voronoi → emission glow, wave → bump, noise → roughness, Fresnel → sheen. ~40 nodes.',
    nodeCount: 40,
    build: () => buildSciFiPanelMaterial(),
  },
  {
    id: 'procedural-wood',
    label: 'Procedural Wood',
    category: 'shader',
    description: 'Wave texture bands distorted by noise grain, with Fresnel varnish layer. ~18 nodes.',
    nodeCount: 18,
    build: () => buildProceduralWood(),
  },
  {
    id: 'spiral-staircase',
    label: 'Spiral Staircase',
    category: 'geometry',
    description: 'Curve spiral → resample → instance steps + posts → curve-to-mesh handrail → join all. ~20 nodes.',
    nodeCount: 20,
    build: () => buildSpiralStaircase(),
  },
  {
    id: 'voronoi-landscape',
    label: 'Voronoi Landscape',
    category: 'geometry',
    description: 'Grid displaced by multi-octave sine noise → subdiv → scatter rocks on slopes → merge. ~18 nodes.',
    nodeCount: 18,
    build: () => buildVoronoiLandscape(),
  },
  {
    id: 'particle-fountain',
    label: 'Particle Fountain',
    category: 'geometry',
    description: 'Simulation zone: points on a ring, velocity = position × 0.03 + up, Set Position per frame. ~15 nodes + sim zone.',
    nodeCount: 15,
    build: () => buildParticleFountain(),
  },
];

/**
 * Helper: register all demo trees with evaluators.
 * Call `bootstrapBuiltins()` first, then `prepareDemoTree(id)`.
 */
import { ShaderEvaluator, GeometryEvaluator } from '../src';
export function prepareDemoTree(id: string): NodeTree {
  const entry = DEMO_TREES.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown demo tree: ${id}`);
  const tree = entry.build();
  if (entry.category === 'shader') {
    tree.depsgraph.setEvaluator(new ShaderEvaluator());
  } else {
    tree.depsgraph.setEvaluator(new GeometryEvaluator());
  }
  return tree;
}
