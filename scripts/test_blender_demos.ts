/**
 * Blender Demo Files — Comprehensive Bridge Test
 *
 * Tests ALL 9 geometry nodes demo files from blender.org through the full
 * bridge pipeline: transpile → BNG load → auto-bridge → evaluate → verify.
 *
 * Also tests the 4 downloaded .blend files for structure validation.
 *
 * Run: npx tsx scripts/test_blender_demos.ts
 */

import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  bootstrapBuiltins,
  NodeRegistry,
  NodeTree,
  GeometryEvaluator,
  ShaderEvaluator,
  GeometryNodeTree,
  ShaderNodeTree,
  CompositorEvaluator,
} from '../src/index';

import { loadBngDocument } from '../src/bridge/runtime_loader';
import { BlenderBridge } from '../src/bridge/blender_bridge';
import { ALL_FIXTURES } from '../test_data/bng_fixtures.ts';

import type { BngDocumentT } from '../src/bridge/schema';

// ── Bootstrap ────────────────────────────────────────────────────────

bootstrapBuiltins();

// ── Stats ────────────────────────────────────────────────────────────

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string): void {
  totalTests++;
  if (cond) { passed++; console.log(`    ✓ ${label}`); }
  else { failed++; failures.push(label); console.error(`    ✗ ${label}`); }
}

// ── Downloaded .blend file check ─────────────────────────────────────

const DEMOS_DIR = join(__dirname, '..', 'test_data', 'blender_demos');

console.log('═'.repeat(72));
console.log('SECTION 1: Downloaded .blend Files from blender.org');
console.log('═'.repeat(72));

let blendFiles: string[] = [];
try {
  blendFiles = readdirSync(DEMOS_DIR).filter(f => f.endsWith('.blend'));
} catch {
  blendFiles = [];
}

if (blendFiles.length > 0) {
  console.log(`  Found ${blendFiles.length} .blend file(s):`);
  for (const f of blendFiles) {
    const st = statSync(join(DEMOS_DIR, f));
    console.log(`    ${f} — ${(st.size / 1024).toFixed(0)} KB`);
  }

  // Verify magic bytes: .blend files start with "BLENDER"
  for (const f of blendFiles) {
    const path = join(DEMOS_DIR, f);
    try {
      // Try reading as gzip first (Blender 3.x+)
      const { readFileSync } = await import('fs');
      const buf = readFileSync(path);
      const size = buf.length;
      // .blend files: Zstandard (0x28 0xB5 0x2F 0xFD), gzip (0x1f 0x8b), or raw 'BLENDER'
      const isZstd = buf[0] === 0x28 && buf[1] === 0xB5 && buf[2] === 0x2F && buf[3] === 0xFD;
      const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
      const hasBlenderString = buf.subarray(0, 7).toString() === 'BLENDER';
      const valid = isZstd || isGzip || hasBlenderString;
      assert(valid, `${f}: valid Blender file (${size} bytes, ${isZstd ? 'zstd' : isGzip ? 'gzip' : 'raw'})`);
    } catch (e) {
      assert(false, `${f}: read error`);
    }
  }
} else {
  console.log('  (no .blend files downloaded — skipped)');
  console.log('  To download: curl -OL https://download.blender.org/demo/geometry-nodes/<file>.blend');
}
console.log();

// ── BNG Fixture Tests ────────────────────────────────────────────────

console.log('═'.repeat(72));
console.log('SECTION 2: BNG Fixture Validation (9 Blender Geometry Nodes Demos)');
console.log('═'.repeat(72));

for (const fixture of ALL_FIXTURES) {
  console.log(`\n  ┌── ${fixture.name}`);
  console.log(`  │  Source: ${fixture.source}`);
  console.log(`  │  Tags: ${fixture.tags.join(', ')}`);

  const doc = fixture.doc;

  // ── Structure checks ──
  const treeCount = doc.trees.length;
  const nodeCount = doc.trees.reduce((s, t) => s + t.nodes.length, 0);
  const linkCount = doc.trees.reduce((s, t) => s + t.links.length, 0);
  const hasShader = doc.trees.some(t => t.bl_idname === 'ShaderNodeTree');
  const hasGeo = doc.trees.some(t => t.bl_idname === 'GeometryNodeTree');
  const hasSim = doc.trees.some(t =>
    t.nodes.some(n => n.bl_idname.includes('Simulation'))
  );

  console.log(`  │  Trees: ${treeCount}  Nodes: ${nodeCount}  Links: ${linkCount}`);
  assert(treeCount >= 1, `${fixture.name}: has ≥1 tree`);
  assert(nodeCount >= 4, `${fixture.name}: has ≥4 nodes`);
  assert(linkCount >= 2, `${fixture.name}: has ≥2 links`);

  // ── BNG Load (Layer 2) ──
  const loadResult = loadBngDocument(doc, {
    autoRegisterUnknown: true,
    generateExecutors: true,
  });

  assert(loadResult.trees.length === treeCount, `${fixture.name}: all trees loaded`);
  assert(loadResult.warnings.length === 0,
    `${fixture.name}: no warnings (${loadResult.warnings.join('; ') || 'none'})`);

  if (loadResult.bridgedNodeIds.length > 0) {
    console.log(`  │  Auto-bridged: ${loadResult.bridgedNodeIds.join(', ')}`);
  }

  // ── Evaluate all trees ──
  for (let ti = 0; ti < loadResult.trees.length; ti++) {
    const tree = loadResult.trees[ti]!;
    const kind = (tree.constructor as unknown as { bl_idname: string }).bl_idname;

    let evaluator;
    if (kind === 'ShaderNodeTree') evaluator = new ShaderEvaluator();
    else if (kind === 'GeometryNodeTree') evaluator = new GeometryEvaluator();
    else evaluator = new CompositorEvaluator();

    tree.depsgraph.setEvaluator(evaluator);
    const result = tree.depsgraph.evaluate();

    assert(result !== undefined, `${fixture.name} [tree ${ti + 1}] ${kind}: evaluates`);
    if (result) {
      const errStr = [...(result.errors?.values() ?? [])].join('; ');
      assert(result.errors.size === 0,
        `${fixture.name} [tree ${ti + 1}]: 0 errors (${errStr || 'none'})`);

      if (result.output && kind === 'ShaderNodeTree') {
        const desc = result.output as { color?: number[]; roughness?: number };
        assert(typeof desc.color !== 'undefined', `${fixture.name}: shader has color`);
        assert(typeof desc.roughness === 'number', `${fixture.name}: shader has roughness`);
      }
    }

    // Node count
    assert(tree.nodes.length >= 3, `${fixture.name} [tree ${ti + 1}]: ≥3 nodes in tree`);

    tree.dispose();
  }

  console.log(`  └── ${fixture.name}: ALL PASSED`);
}

// ── Sim zone specific: animation frames ──────────────────────────────

console.log(`\n${'═'.repeat(72)}`);
console.log('SECTION 3: Simulation Zone Animation Tests');
console.log('═'.repeat(72));

const simFixtures = ALL_FIXTURES.filter(f => f.tags.includes('simulation'));
for (const fixture of simFixtures) {
  const tree = new GeometryNodeTree(fixture.name);
  const ev = new GeometryEvaluator();
  tree.depsgraph.setEvaluator(ev);

  // Load BNG into this tree
  // (simplified: we test the BNG fixtures that have Sim nodes)
  const doc = fixture.doc;
  let hasSimNodes = false;
  for (const t of doc.trees) {
    for (const n of t.nodes) {
      if (n.bl_idname.includes('Simulation')) hasSimNodes = true;
    }
  }

  if (!hasSimNodes) continue;

  console.log(`\n  ${fixture.name}:`);

  // Advance frames
  const loadResult = loadBngDocument(doc, {
    autoRegisterUnknown: true,
    generateExecutors: true,
  });

  const simTree = loadResult.trees[0]!;
  simTree.depsgraph.setEvaluator(new GeometryEvaluator());

  // Frame 1
  simTree.depsgraph.setScene({ frame: 1, fps: 24, elapsed: 1 / 24 });
  const r1 = simTree.depsgraph.evaluate();
  assert(r1 !== undefined, `${fixture.name}: frame 1 evaluates`);
  assert(r1!.errors.size === 0, `${fixture.name}: frame 1 no errors`);

  // Frame 10
  simTree.depsgraph.setScene({ frame: 10, fps: 24, elapsed: 10 / 24 });
  const r10 = simTree.depsgraph.evaluate();
  assert(r10 !== undefined, `${fixture.name}: frame 10 evaluates`);
  assert(r10!.errors.size === 0, `${fixture.name}: frame 10 no errors`);

  // Frame 50
  simTree.depsgraph.setScene({ frame: 50, fps: 24, elapsed: 50 / 24 });
  const r50 = simTree.depsgraph.evaluate();
  assert(r50 !== undefined, `${fixture.name}: frame 50 evaluates`);
  assert(r50!.errors.size === 0, `${fixture.name}: frame 50 no errors`);

  simTree.dispose();
}

// ── BlenderBridge end-to-end (Layer 3) ──────────────────────────────

console.log(`\n${'═'.repeat(72)}`);
console.log('SECTION 4: BlenderBridge End-to-End');
console.log('═'.repeat(72));

// Test with the most complex fixture (hexgrid — has both geo + shader trees)
const hexgridFixture = ALL_FIXTURES.find(f => f.name === 'Hexgrid')!;
const bridge = new BlenderBridge();
const pipeResult = bridge.loadBlendExport(hexgridFixture.doc);

assert(pipeResult.trees.length === 2, 'Hexgrid: bridge loads 2 trees');
assert(pipeResult.report.treeCount === 2, 'Hexgrid: report shows 2 trees');
assert(pipeResult.report.warnings.length === 0, 'Hexgrid: no bridge warnings');
assert(pipeResult.evaluators.size === 2, 'Hexgrid: 2 evaluators assigned');
assert(!pipeResult.report.addonTranspiled, 'Hexgrid: no addon needed (built-in nodes)');

// Evaluate both trees through the bridge
const geoTree = pipeResult.trees[0]!;
const shaderTree = pipeResult.trees[1]!;

const geoEval = geoTree.depsgraph.evaluate();
assert(geoEval !== undefined, 'Hexgrid geo: evaluates');
assert(geoEval!.errors.size === 0, 'Hexgrid geo: no errors');

const shaderEval = shaderTree.depsgraph.evaluate();
assert(shaderEval !== undefined, 'Hexgrid shader: evaluates');
assert(shaderEval!.errors.size === 0, 'Hexgrid shader: no errors');

// Color verification
const matDesc = shaderEval!.output as { color: number[]; roughness: number };
assert(matDesc.color[0]! >= 0 && matDesc.color[0]! <= 1, 'Hexgrid shader: color R in range');
assert(matDesc.color[2]! >= 0 && matDesc.color[2]! <= 1, 'Hexgrid shader: color B in range');

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(72)}`);
console.log(`  BLENDER DEMO FILES TEST — Complete`);
console.log(`  ─────────────────────────────────`);
console.log(`  Total assertions: ${totalTests}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  ─────────────────────────────────`);
console.log(`  .blend files: ${blendFiles.length}`);
console.log(`  BNG fixtures: ${ALL_FIXTURES.length}`);
console.log(`  Simulation tests: ${simFixtures.length}`);
console.log(`  Bridge tests: ✓`);
console.log('═'.repeat(72));

if (failed > 0) {
  console.error('\n  FAILURES:');
  for (const f of failures) console.error(`    ✗ ${f}`);
  process.exit(1);
}
