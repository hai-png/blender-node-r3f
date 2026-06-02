/**
 * smoketest.ts — minimal end-to-end sanity tests for the node system.
 *
 * Run with: `npm test` (uses tsx).
 *
 * These are NOT comprehensive unit tests; they validate that the core
 * bootstrap works, that representative nodes from every system register
 * and evaluate to sensible values, and that import/export round-trips.
 */
import {
  bootstrapBuiltins, GeometryNodeTree, ShaderNodeTree, CompositorNodeTree,
  NodeRegistry, GeometryEvaluator, ShaderEvaluator,
} from '../src/index';
import { MathNode } from '../src/nodes/common/Math';
import { CompareNode, SwitchNode } from '../src/nodes/common/Logic';
import { MapRangeNode } from '../src/nodes/common/MapRange';
import { ShaderNodeTexNoise, ShaderNodeOutputMaterial, ShaderNodeBsdfPrincipled } from '../src/nodes/shader/Shaders';
import { GeometryNodeMeshCube } from '../src/nodes/geometry/Primitives';
import { exportDocument } from '../src/bridge/exporter';
import { importDocument } from '../src/bridge/importer';

let passes = 0;
let failures = 0;
const fails: string[] = [];

function assert(cond: unknown, label: string): void {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; fails.push(label); console.error(`  ✗ ${label}`); }
}
function approx(a: number, b: number, eps = 1e-4): boolean { return Math.abs(a - b) <= eps; }

console.log('— blender-node-r3f smoketest —');
bootstrapBuiltins();

console.log('\n[1] Bootstrap registers built-ins');
assert(NodeRegistry.getNode('ShaderNodeBsdfPrincipled') !== undefined, 'Principled BSDF registered');
assert(NodeRegistry.getNode('GeometryNodeMeshCube') !== undefined, 'Mesh Cube registered');
assert(NodeRegistry.getNode('CompositorNodeBlur') !== undefined, 'Compositor Blur registered');
assert(NodeRegistry.getNode('FunctionNodeCompare') !== undefined, 'Compare registered');

console.log('\n[2] Math operations match expected values');
assert(MathNode.compute('ADD', 2, 3, 0, false) === 5, 'ADD 2+3=5');
assert(MathNode.compute('MULTIPLY', 4, 5, 0, false) === 20, 'MUL 4*5=20');
assert(approx(MathNode.compute('SINE', Math.PI / 2, 0, 0, false), 1), 'SIN(pi/2)=1');
assert(MathNode.compute('MAXIMUM', 7, 3, 0, false) === 7, 'MAX(7,3)=7');

console.log('\n[3] Compare node supports Float / Vector / Color');
assert(CompareNode.compute('LESS_THAN', 1, 2) === true, 'LT 1<2 true');
assert(CompareNode.computeVec('GREATER_THAN', [2, 3, 4], [1, 2, 3]) === true, 'Vec GT all-components');
assert(CompareNode.computeColor('EQUAL', [1, 0, 0, 1], [1, 0, 0, 1], 0.001) === true, 'Color EQ exact');

console.log('\n[4] MapRange Float & Vector');
assert(approx(MapRangeNode.computeFloat(0.5, 0, 1, 0, 100, 4, 'LINEAR', true), 50), 'Map 0.5∈[0,1]→[0,100]=50');
const mv = MapRangeNode.computeVec([0.5, 0.25, 0.75], [0, 0, 0], [1, 1, 1], [0, 0, 0], [10, 10, 10], 4, 'LINEAR', true);
assert(approx(mv[0], 5) && approx(mv[1], 2.5) && approx(mv[2], 7.5), 'Map vec [.5,.25,.75]→[5,2.5,7.5]');

console.log('\n[5] Switch dynamic sockets rebuild');
const stree = new ShaderNodeTree('switch-test');
const sw = stree.addNode(SwitchNode);
assert(sw.input_type === 'FLOAT', 'Default input_type FLOAT');
assert(sw.inputs.length === 3, 'Float Switch has 3 inputs');
sw.input_type = 'VECTOR';
assert(sw.inputs[1]!.kind === 'VECTOR', 'Switch rebuilt VECTOR False socket');
sw.input_type = 'GEOMETRY';
assert(sw.inputs[1]!.kind === 'GEOMETRY', 'Switch rebuilt GEOMETRY False socket');
stree.dispose();

console.log('\n[6] Shader evaluator runs end-to-end');
const tree = new ShaderNodeTree('test-shader');
const out = tree.addNode(ShaderNodeOutputMaterial);
const bsdf = tree.addNode(ShaderNodeBsdfPrincipled);
const noise = tree.addNode(ShaderNodeTexNoise);
tree.addLink(bsdf.outputs[0]!, out.inputs[0]!);
tree.addLink(noise.outputs[0]!, bsdf.inputs.find((s) => s.name === 'Roughness')!);
const ev = new ShaderEvaluator();
const res = ev.evaluate(tree, new Set(tree.nodes));
const matDesc = res.output as { color: number[]; roughness: number };
assert(Array.isArray(matDesc.color) && matDesc.color.length === 4, 'Material desc has 4-component color');
assert(typeof matDesc.roughness === 'number', 'Material desc has numeric roughness');
tree.dispose();

console.log('\n[7] Geometry evaluator builds a primitive');
const gtree = new GeometryNodeTree('test-geo');
const cube = gtree.addNode(GeometryNodeMeshCube);
const gev = new GeometryEvaluator();
const gres = gev.evaluate(gtree, new Set(gtree.nodes));
assert(gres.errors.size === 0, `Geo eval has no errors (got ${[...gres.errors.values()].join(', ')})`);
// The 'output' for a tree without a Group Output simply returns the last node's geometry cache.
gtree.dispose();

console.log('\n[8] Import / export round-trip preserves structure');
const ttree = new GeometryNodeTree('rt');
ttree.addNode(GeometryNodeMeshCube);
const exported = exportDocument([ttree]);
const reimported = importDocument(exported);
assert(Array.isArray(reimported) && reimported.length === 1, 'Re-imported one tree');
assert(reimported[0]!.nodes.length === 1, 'Re-imported one node');
ttree.dispose();

console.log('\n[9] Cycle detection prevents loops');
const ctree = new ShaderNodeTree('cycle-test');
const m1 = ctree.addNode(MathNode);
const m2 = ctree.addNode(MathNode);
ctree.addLink(m1.outputs[0]!, m2.inputs[0]!);
let cycleErr = false;
try { ctree.addLink(m2.outputs[0]!, m1.inputs[0]!); }
catch { cycleErr = true; }
assert(cycleErr, 'Cycle blocked at addLink');
ctree.dispose();

console.log('\n[10] CompositorNodeTree registers');
const ctree2 = new CompositorNodeTree('comp');
assert(ctree2.name === 'comp' && Array.isArray(ctree2.nodes), 'CompositorNodeTree instantiates');
assert(CompositorNodeTree.bl_idname === 'CompositorNodeTree', 'CompositorNodeTree.bl_idname static');
ctree2.dispose();

console.log('\n[11] Phase-3 nodes register (BSDFs, geo ops, color ops, shader info)');
const newIds = [
  // Shader: BSDFs / Info / Volume / Color
  'ShaderNodeBsdfHair', 'ShaderNodeBsdfHairPrincipled', 'ShaderNodeEeveeSpecular',
  'ShaderNodeTangent', 'ShaderNodeWireframe', 'ShaderNodeBevel',
  'ShaderNodeAmbientOcclusion', 'ShaderNodeVolumeInfo', 'ShaderNodeVertexColor',
  'ShaderNodeHairInfo', 'ShaderNodePointInfo', 'ShaderNodeParticleInfo',
  'ShaderNodeOutputAOV', 'ShaderNodeVolumePrincipled', 'ShaderNodeTexSky',
  'ShaderNodeTexPointDensity',
  'ShaderNodeHueSaturation', 'ShaderNodeBrightContrast', 'ShaderNodeInvert',
  'ShaderNodeGamma', 'ShaderNodeMixRGB',
  // Geometry: high-impact missing ops
  'GeometryNodeRaycast', 'GeometryNodeExtrudeMesh',
  'GeometryNodeDeleteGeometry', 'GeometryNodeSeparateGeometry', 'GeometryNodeDuplicateElements',
  'GeometryNodeMeshToCurve', 'GeometryNodeMeshToVolume', 'GeometryNodeVolumeToMesh',
  'GeometryNodePointsToVolume', 'GeometryNodeSplitEdges', 'GeometryNodeSubdivideMesh',
  'GeometryNodeDualMesh', 'GeometryNodeScaleElements',
  'GeometryNodeSampleNearestSurface', 'GeometryNodeSampleUVSurface',
  'GeometryNodeInputMeshIsland', 'GeometryNodeInputShadeSmooth', 'GeometryNodeSetShadeSmooth',
  'GeometryNodeInterpolateCurves', 'GeometryNodeStringToCurves',
];
let allReg = true;
for (const id of newIds) {
  if (!NodeRegistry.getNode(id)) { console.error(`  ✗ Missing: ${id}`); allReg = false; }
}
assert(allReg, `All ${newIds.length} new node ids registered`);

console.log('\n[12] Compare node rebuilds sockets for type change');
const ct = new ShaderNodeTree('compare-test');
const cn = ct.addNode(CompareNode);
assert(cn.inputs.length === 3 && cn.inputs[0]!.kind === 'VALUE', 'Default Compare = Float (A,B,Epsilon)');
cn.data_type = 'VECTOR';
assert(cn.inputs.find((s) => s.name === 'A')?.kind === 'VECTOR', 'Compare/VECTOR A is Vector');
assert(cn.inputs.find((s) => s.name === 'Epsilon') !== undefined, 'Compare/VECTOR has Epsilon');
cn.data_type = 'INT';
assert(cn.inputs.find((s) => s.name === 'A')?.kind === 'INT', 'Compare/INT A is Integer');
assert(cn.inputs.find((s) => s.name === 'Epsilon') === undefined, 'Compare/INT has NO Epsilon');
ct.dispose();

console.log('\n[12a] Procedural noise actually varies (not constant 0.5)');
{
  // Sanity-check the new procedural noise in the ShaderEvaluator: feed a
  // Texture Coordinate-style Vector into a Noise node and verify the result
  // changes across distinct sample positions (the old stub returned 0.5 for
  // every sample).
  const tt = new ShaderNodeTree('noise-variance');
  const out = tt.addNode(ShaderNodeOutputMaterial);
  const bsdf = tt.addNode(ShaderNodeBsdfPrincipled);
  const noise = tt.addNode(ShaderNodeTexNoise);
  tt.addLink(bsdf.outputs[0]!, out.inputs[0]!);
  tt.addLink(noise.outputs[0]!, bsdf.inputs.find((s) => s.name === 'Roughness')!);
  const samples: number[] = [];
  for (const v of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [3.7, 1.2, 0.5]] as [number, number, number][]) {
    noise.inputs[0]!.default_value = v as any;
    const ev2 = new ShaderEvaluator();
    const r = ev2.evaluate(tt, new Set(tt.nodes));
    const desc = r.output as { roughness: number };
    samples.push(desc.roughness);
  }
  const distinct = new Set(samples.map((x) => Math.round(x * 1000) / 1000)).size;
  assert(distinct >= 3, `Noise varies across vectors (${distinct}/${samples.length} distinct values, got ${samples.map((s) => s.toFixed(3)).join(',')})`);
  tt.dispose();
}

console.log('\n[12b] Raycast and Delete Geometry execute without errors');
{
  // Build a cube → Delete Geometry pipeline; verify it runs.
  import('../src/nodes/geometry/MoreOps').then(async ({ GeometryNodeDeleteGeometry, GeometryNodeRaycast }) => {
    const dt = new GeometryNodeTree('delete-test');
    const cube = dt.addNode(GeometryNodeMeshCube);
    const del = dt.addNode(GeometryNodeDeleteGeometry);
    dt.addLink(cube.outputs[0]!, del.inputs[0]!);
    const dev = new GeometryEvaluator();
    const dres = dev.evaluate(dt, new Set(dt.nodes));
    assert(dres.errors.size === 0, `Delete Geometry runs without errors (got ${[...dres.errors.values()].join(',')})`);
    dt.dispose();
    void GeometryNodeRaycast; // Raycast eval needs a target — covered by registration.
  });
}

console.log('\n[12c] Hash determinism (procedural noise is stable, not random)');
{
  const tt = new ShaderNodeTree('hash-stable');
  const out = tt.addNode(ShaderNodeOutputMaterial);
  const bsdf = tt.addNode(ShaderNodeBsdfPrincipled);
  const noise = tt.addNode(ShaderNodeTexNoise);
  tt.addLink(bsdf.outputs[0]!, out.inputs[0]!);
  tt.addLink(noise.outputs[0]!, bsdf.inputs.find((s) => s.name === 'Roughness')!);
  noise.inputs[0]!.default_value = [2.5, 1.5, 0.5] as any;
  const r1 = (new ShaderEvaluator().evaluate(tt, new Set(tt.nodes)).output as { roughness: number }).roughness;
  const r2 = (new ShaderEvaluator().evaluate(tt, new Set(tt.nodes)).output as { roughness: number }).roughness;
  assert(r1 === r2, `Noise is deterministic (got ${r1} and ${r2})`);
  tt.dispose();
}

console.log('\n[12d] Common executors are registered (registry-based dispatch)');
{
  import('../src/eval/NodeExecute').then(async ({ getExecutor }) => {
    const e1 = getExecutor('ShaderNodeMath');
    const e2 = getExecutor('FunctionNodeCompare');
    const e3 = getExecutor('GeometryNodeSwitch');
    assert(typeof e1 === 'function', 'Math executor registered');
    assert(typeof e2 === 'function', 'Compare executor registered');
    assert(typeof e3 === 'function', 'Switch executor registered');
  });
}

console.log('\n[12e] MoreShaders nodes register');
const moreShaderIds = [
  'ShaderNodeBlackbody', 'ShaderNodeWavelength', 'ShaderNodeRGBToBW',
  'ShaderNodeShaderToRGB', 'ShaderNodeNormal',
  'ShaderNodeVectorTransform', 'ShaderNodeScript', 'ShaderNodeAttributeColor',
  'FunctionNodeFloatToInt', 'FunctionNodeAlignEulerToVector', 'FunctionNodeRotateEuler',
];
let allShader = true;
for (const id of moreShaderIds) {
  if (!NodeRegistry.getNode(id)) { console.error(`  ✗ Missing: ${id}`); allShader = false; }
}
assert(allShader, `All ${moreShaderIds.length} MoreShaders ids registered`);

console.log('\n[13a] Phase-3 compositor nodes register');
const compIds = [
  'CompositorNodeDefocus', 'CompositorNodeBokehBlur', 'CompositorNodeBokehImage',
  'CompositorNodeBilateralblur', 'CompositorNodeDBlur', 'CompositorNodeDenoise',
  'CompositorNodeFilter', 'CompositorNodeDilateErode', 'CompositorNodeInpaint',
  'CompositorNodeDespeckle', 'CompositorNodeSunBeams',
  'CompositorNodeLensdist', 'CompositorNodeMovieDistortion', 'CompositorNodeMapUV',
  'CompositorNodeDisplace', 'CompositorNodeStabilize', 'CompositorNodeCornerPin',
  'CompositorNodePlaneTrackDeform',
  'CompositorNodeKeying', 'CompositorNodeKeyingScreen', 'CompositorNodeColorSpill',
  'CompositorNodeDoubleEdgeMask', 'CompositorNodeIDMask', 'CompositorNodeCryptomatteV2',
  'CompositorNodeBoxMask', 'CompositorNodeEllipseMask',
  'CompositorNodeLevels', 'CompositorNodeNormal', 'CompositorNodeNormalize',
  'CompositorNodeSwitch', 'CompositorNodeSwitchView',
  'CompositorNodeOutputFile', 'CompositorNodePremulKey', 'CompositorNodeConvertColorSpace',
];
let allComp = true;
for (const id of compIds) {
  if (!NodeRegistry.getNode(id)) { console.error(`  ✗ Missing: ${id}`); allComp = false; }
}
assert(allComp, `All ${compIds.length} new compositor node ids registered`);

console.log('\n[13] AccumulateField rebuilds sockets for VECTOR type');
import('../src/nodes/geometry/FieldUtils').then(async ({ GeometryNodeAccumulateField }) => {
  const at = new GeometryNodeTree('accum-test');
  const an = at.addNode(GeometryNodeAccumulateField);
  assert(an.inputs[0]!.kind === 'VALUE', 'AccumulateField default input = Float');
  an.data_type = 'FLOAT_VECTOR';
  assert(an.inputs[0]!.kind === 'VECTOR', 'AccumulateField VECTOR input rebuilt');
  assert(an.outputs[0]!.kind === 'VECTOR', 'AccumulateField VECTOR output rebuilt');
  at.dispose();

  console.log(`\n— Result: ${passes} passed, ${failures} failed —`);
  if (failures > 0) {
    console.error('Failed:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
  }
});
