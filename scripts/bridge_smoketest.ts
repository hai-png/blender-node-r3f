/**
 * Bridge smoke test — validates the addon transpiler and BNG runtime loader.
 *
 * Run: npx tsx scripts/bridge_smoketest.ts
 */

import {
  bootstrapBuiltins,
  NodeRegistry,
  GeometryNodeTree,
  GeometryEvaluator,
  ShaderNodeTree,
  ShaderEvaluator,
  NodeTree,
} from '../src/index';

import {
  transpilePythonAddon,
  transpileFullAddon,
} from '../src/bridge/addon_transpiler';

import {
  loadBngDocument,
} from '../src/bridge/runtime_loader';

import {
  BlenderBridge,
} from '../src/bridge/blender_bridge';

bootstrapBuiltins();

let passes = 0;
let failures = 0;
const fails: string[] = [];

function assert(cond: unknown, label: string): void {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; fails.push(label); console.error(`  ✗ ${label}`); }
}
function test(_label: string, fn: () => void): void { fn(); }

console.log('\n=== Layer 1: Python Addon Transpiler ===\n');

test('Parses simple float property node', () => {
  const py = `
import bpy
class SimpleNode(bpy.types.Node):
    bl_idname = 'SimpleNode'
    bl_label = 'Simple'
    value: bpy.props.FloatProperty(name="Value", default=1.0, min=0, max=10)
    def init(self, ctx):
        self.inputs.new('NodeSocketFloat', 'In')
        self.outputs.new('NodeSocketFloat', 'Out')
`;
  const nodes = transpilePythonAddon(py);
  assert(nodes.length === 1, 'Found 1 class');
  assert(nodes[0]!.bl_idname === 'SimpleNode', 'bl_idname correct');
  assert(nodes[0]!.bl_label === 'Simple', 'bl_label correct');
  assert(nodes[0]!.tsClassSource.includes('static override bl_idname'), 'Has static bl_idname');
  assert(nodes[0]!.tsClassSource.includes('FloatProperty'), 'Has FloatProperty');
});

test('Transpiles enum, vector, and color props', () => {
  const py = `
class ComplexNode(bpy.types.Node):
    bl_idname = 'ComplexNode'
    bl_label = 'Complex'
    mode: bpy.props.EnumProperty(items=[('A','Alpha',''),('B','Beta','')])
    vec: bpy.props.FloatVectorProperty(default=(0,0,0), size=3)
    col: bpy.props.ColorProperty(default=(1,0,0,1))
`;
  const nodes = transpilePythonAddon(py);
  assert(nodes.length === 1, 'Found 1 class');
  const src = nodes[0]!.tsClassSource;
  assert(src.includes('EnumProperty'), 'Has EnumProperty');
  assert(src.includes('FloatVectorProperty'), 'Has FloatVectorProperty');
  assert(src.includes('ColorProperty'), 'Has ColorProperty');
});

test('Full addon transpile generates registrable output', () => {
  const py = `
import bpy
class MyAddonNode(bpy.types.Node):
    bl_idname = 'MyAddonNode'
    bl_label = 'My Addon Node'
    radius: bpy.props.FloatProperty(default=2.0)
    def init(self, ctx):
        self.inputs.new('NodeSocketVector', 'Position')
        self.outputs.new('NodeSocketFloat', 'Factor')
`;
  const result = transpileFullAddon(py);
  assert(result.nodes.length === 1, 'One node');
  assert(result.fullSource.includes('import { bpy'), 'Has import');
  assert(result.fullSource.includes('class MyAddonNode'), 'Has class');
  assert(result.registration.includes('bpy.utils.register_class'), 'Has registration');
});

console.log('\n=== Layer 2: BNG Runtime Loader ===\n');

test('Auto-bridges unknown nodes in BNG JSON', () => {
  const bngJson = {
    schema: 'BNG/1' as const,
    blender_version: '4.2.0',
    trees: [{
      id: 'tree1',
      bl_idname: 'GeometryNodeTree' as const,
      name: 'Test',
      interface: { items: [] },
      nodes: [
        {
          id: 'n1', bl_idname: 'GeometryNodeMeshCube',
          name: 'Cube', location: [0, 0],
          properties: { size: [1, 1, 1] },
          inputs: [], outputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
        },
        {
          id: 'n2', bl_idname: 'UnknownCustomNode',
          name: 'Custom', location: [200, 0],
          properties: { my_param: 42.0, enabled: true },
          inputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
            { identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' },
          ],
          outputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
        },
      ],
      links: [
        { from_node: 'n1', from_socket: 'Geometry', to_node: 'n2', to_socket: 'Geometry' },
      ],
    }],
  };

  const before = NodeRegistry.getNode('UnknownCustomNode');
  assert(before === undefined, 'Unknown node NOT registered before load');

  const result = loadBngDocument(bngJson);
  assert(result.trees.length === 1, 'One tree loaded');
  assert(result.bridgedNodeIds.includes('UnknownCustomNode'), 'Custom node auto-bridged');
  assert(result.warnings.length === 0, 'No warnings: ' + result.warnings.join(', '));

  const after = NodeRegistry.getNode('UnknownCustomNode');
  assert(after !== undefined, 'Unknown node NOW registered');
  assert(result.trees[0]!.nodes.length === 2, 'Tree has 2 nodes');
  assert(result.trees[0]!.nodes[1]!.bl_idname === 'UnknownCustomNode', 'Correct bridged node');
});

test('Bridged tree evaluates without errors', () => {
  const bngJson = {
    schema: 'BNG/1' as const,
    blender_version: '4.2.0',
    trees: [{
      id: 'tree2',
      bl_idname: 'GeometryNodeTree' as const,
      name: 'EvalTest',
      interface: { items: [] },
      nodes: [
        {
          id: 'c1', bl_idname: 'GeometryNodeMeshCube',
          name: 'Cube', location: [0, 0],
          properties: {},
          inputs: [], outputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
        },
        {
          id: 'c2', bl_idname: 'CloudGenerator',
          name: 'Clouds', location: [200, 0],
          properties: { density: 10.0 },
          inputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
          outputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
        },
      ],
      links: [
        { from_node: 'c1', from_socket: 'Geometry', to_node: 'c2', to_socket: 'Geometry' },
      ],
    }],
  };

  const result = loadBngDocument(bngJson, {
    autoRegisterUnknown: true,
    generateExecutors: true,
  });
  const tree = result.trees[0]!;
  tree.depsgraph.setEvaluator(new GeometryEvaluator());

  const evalResult = tree.depsgraph.evaluate();
  assert(evalResult !== undefined, 'Evaluation produces result');
  assert(evalResult!.errors.size === 0, 'No eval errors: ' + [...(evalResult!.errors?.values() ?? [])].join(', '));
});

console.log('\n=== Layer 3: BlenderBridge Pipeline ===\n');

test('BlenderBridge loads BNG JSON end-to-end', () => {
  const bridge = new BlenderBridge();
  const bng = {
    schema: 'BNG/1' as const,
    blender_version: '4.2.0',
    trees: [{
      id: 'tree3',
      bl_idname: 'ShaderNodeTree' as const,
      name: 'ShaderTest',
      interface: { items: [] },
      nodes: [
        {
          id: 's1', bl_idname: 'ShaderNodeOutputMaterial',
          name: 'Output', location: [400, 0],
          properties: {},
          inputs: [
            { identifier: 'Surface', name: 'Surface', socket_type: 'NodeSocketShader' },
            { identifier: 'Volume', name: 'Volume', socket_type: 'NodeSocketShader' },
            { identifier: 'Displacement', name: 'Displacement', socket_type: 'NodeSocketVector' },
          ],
          outputs: [],
        },
        {
          id: 's2', bl_idname: 'ShaderNodeBsdfPrincipled',
          name: 'BSDF', location: [100, 0],
          properties: { base_color: [0.8, 0.2, 0.2, 1] },
          inputs: [
            { identifier: 'Base Color', name: 'Base Color', socket_type: 'NodeSocketColor', default_value: [0.8, 0.2, 0.2, 1] },
            { identifier: 'Metallic', name: 'Metallic', socket_type: 'NodeSocketFloat', default_value: 0 },
            { identifier: 'Roughness', name: 'Roughness', socket_type: 'NodeSocketFloat', default_value: 0.5 },
          ],
          outputs: [
            { identifier: 'BSDF', name: 'BSDF', socket_type: 'NodeSocketShader' },
          ],
        },
      ],
      links: [
        { from_node: 's2', from_socket: 'BSDF', to_node: 's1', to_socket: 'Surface' },
      ],
    }],
  };

  const result = bridge.loadBlendExport(bng);
  assert(result.trees.length === 1, 'One tree loaded');
  assert(result.report.treeCount === 1, 'Report: 1 tree');
  assert(result.evaluators.size === 1, 'One evaluator assigned');
  assert(result.report.bridgedCount === 0, 'No bridging needed (built-in node)');

  const tree = result.trees[0]!;
  const ev = tree.depsgraph.evaluate();
  assert(ev !== undefined, 'Evaluates');
  assert(ev!.errors.size === 0, 'No errors');
});

test('BlenderBridge with Python addon transpilation', () => {
  const bridge = new BlenderBridge();
  bridge.withAddon(`
import bpy
class MyFalloffNode(bpy.types.Node):
    bl_idname = 'MyFalloffNode'
    bl_label = 'My Falloff'
    radius: bpy.props.FloatProperty(default=3.0, min=0.0)
    def init(self, ctx):
        self.inputs.new('NodeSocketGeometry', 'Geometry')
        self.outputs.new('NodeSocketGeometry', 'Geometry')
`);

  const bng = {
    schema: 'BNG/1' as const,
    blender_version: '4.2.0',
    trees: [{
      id: 'addon_tree',
      bl_idname: 'GeometryNodeTree' as const,
      name: 'AddonTest',
      interface: { items: [] },
      nodes: [
        {
          id: 'a1', bl_idname: 'GeometryNodeMeshCube',
          name: 'Cube', location: [0, 0],
          properties: {}, inputs: [], outputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
        },
        {
          id: 'a2', bl_idname: 'MyFalloffNode',
          name: 'Falloff', location: [200, 0],
          properties: { radius: 3.0 },
          inputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
          outputs: [
            { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          ],
        },
      ],
      links: [
        { from_node: 'a1', from_socket: 'Geometry', to_node: 'a2', to_socket: 'Geometry' },
      ],
    }],
  };

  const result = bridge.loadBlendExport(bng);
  assert(result.trees.length === 1, 'Tree loaded');
  assert(result.report.addonTranspiled, 'Addon was transpiled');
  assert(result.report.addonNodes.includes('MyFalloffNode'), 'Falloff node in report');

  const tree = result.trees[0]!;
  tree.depsgraph.setEvaluator(new GeometryEvaluator());
  const ev = tree.depsgraph.evaluate();
  assert(ev !== undefined, 'Addon tree evaluates');
  assert(ev!.errors.size === 0, 'No eval errors');
});

// ── Summary ──
console.log(`\n${'═'.repeat(56)}`);
console.log(`  Bridge Results: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.log('  Failures:');
  for (const f of fails) console.error(`    ✗ ${f}`);
  process.exit(1);
}
console.log(`${'═'.repeat(56)}\n`);
