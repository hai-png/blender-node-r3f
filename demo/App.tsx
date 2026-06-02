/**
 * Demo app — split layout:
 *   - Top: toolbar with tree picker, evaluate, export JSON, TSL toggle.
 *   - Left: React Flow node editor.
 *   - Right: R3F viewport (WebGL fallback OR TSL/WebGPU).
 *
 * On mount, builds one example tree per system to show the system works.
 */
import { useEffect, useState } from 'react';
import {
  bootstrapBuiltins,
  ShaderNodeTree, GeometryNodeTree, CompositorNodeTree, TextureNodeTree,
  ShaderEvaluator, GeometryEvaluator, CompositorEvaluator, TextureEvaluator,
  ShaderNodeOutputMaterial, ShaderNodeBsdfPrincipled, ShaderNodeTexNoise,
  GeometryNodeMeshCube, GeometryNodeMeshUVSphere, GeometryNodeMeshIcoSphere,
  GeometryNodeMeshGrid, GeometryNodeTransform, GeometryNodeJoinGeometry,
  GeometryNodeInputNormal, GeometryNodeInputPosition, GeometryNodeSetPosition,
  GeometryNodeDistributePointsOnFaces, GeometryNodeInstanceOnPoints,
  GeometryNodeRealizeInstances,
  VectorMathNode, MathNode,
  NodeGroupOutput,
  CompositorNodeImage, CompositorNodeBlur, CompositorNodeComposite,
  CompositorNodeRGB, CompositorNodeMixRGB, CompositorNodeBrightContrast,
  CompositorNodeInvert, CompositorNodeVignette, CompositorNodeGlare,
  TextureNodeNoise, TextureNodeChecker, TextureNodeOutput,
  exportDocument,
  type NodeTree,
} from '../src';
import { TSLShaderEvaluator } from '../src/tsl';
import { NodeEditor } from '../src/ui/NodeEditor';
import { useTreeStore } from '../src/ui/store';
import { Viewport } from './Viewport';
import { TSLViewport } from './TSLViewport';

bootstrapBuiltins();

// ---------------------------------------------------------------------------
//  Build one example tree per system
// ---------------------------------------------------------------------------
function buildShaderTree(useTSL: boolean): NodeTree {
  const t = new ShaderNodeTree('Material');
  t.depsgraph.setEvaluator(useTSL ? new TSLShaderEvaluator() : new ShaderEvaluator());

  const out = t.addNode(ShaderNodeOutputMaterial, { location: [400, 0] });
  const bsdf = t.addNode(ShaderNodeBsdfPrincipled, { location: [50, 0] });
  const noise = t.addNode(ShaderNodeTexNoise, { location: [-250, -120] });
  t.addLink(bsdf.outputs[0]!, out.inputs[0]!);
  t.addLink(noise.outputs[1]!, bsdf.inputs[0]!);
  (bsdf.inputs[0]!.default_value as number[]).splice(0, 4, 0.9, 0.6, 0.2, 1);
  (bsdf.inputs[1]!.default_value as unknown) = 0.8;
  (bsdf.inputs[2]!.default_value as unknown) = 0.25;
  return t;
}

function buildGeometryTree(): NodeTree {
  const t = new GeometryNodeTree('Geo');
  t.depsgraph.setEvaluator(new GeometryEvaluator());
  t.interface.new_socket({ name: 'Geometry', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' });

  // 1. Inflate an icosphere along its normal: ico + (normal × 0.3) → set position
  const ico = t.addNode(GeometryNodeMeshIcoSphere, { location: [-700, 0] });
  (ico.subdivisions as unknown) = 2;
  const normal = t.addNode(GeometryNodeInputNormal, { location: [-700, -220] });
  const scale = t.addNode(VectorMathNode, { location: [-460, -220] });
  scale.operation = 'SCALE';
  (scale.inputs[3]!.default_value as unknown) = 0.3;
  const setp = t.addNode(GeometryNodeSetPosition, { location: [-220, -50] });
  t.addLink(normal.outputs[0]!, scale.inputs[0]!);
  t.addLink(ico.outputs[0]!, setp.inputs[0]!);
  t.addLink(scale.outputs[0]!, setp.inputs[3]!);

  // 2. Move the inflated ball up so it sits above the scattered cubes.
  const lift = t.addNode(GeometryNodeTransform, { location: [40, -50] });
  (lift.inputs[1]!.default_value as number[]).splice(0, 3, 0, 1.5, 0);
  t.addLink(setp.outputs[0]!, lift.inputs[0]!);

  // 3. Scatter little cubes on a grid using Distribute Points + Instance On Points.
  const grid = t.addNode(GeometryNodeMeshGrid, { location: [-700, 280] });
  (grid.inputs[0]!.default_value as unknown) = 6; (grid.inputs[1]!.default_value as unknown) = 6;
  (grid.inputs[2]!.default_value as unknown) = 8; (grid.inputs[3]!.default_value as unknown) = 8;
  const dist = t.addNode(GeometryNodeDistributePointsOnFaces, { location: [-440, 280] });
  (dist.inputs[4]!.default_value as unknown) = 4;
  const tinyCube = t.addNode(GeometryNodeMeshCube, { location: [-440, 460] });
  (tinyCube.inputs[0]!.default_value as number[]).splice(0, 3, 0.15, 0.15, 0.15);
  const inst = t.addNode(GeometryNodeInstanceOnPoints, { location: [-180, 280] });
  const realise = t.addNode(GeometryNodeRealizeInstances, { location: [60, 280] });
  t.addLink(grid.outputs[0]!, dist.inputs[0]!);
  t.addLink(dist.outputs[0]!, inst.inputs[0]!);
  t.addLink(tinyCube.outputs[0]!, inst.inputs[2]!);
  t.addLink(inst.outputs[0]!, realise.inputs[0]!);

  // 4. Join the inflated ball + scattered cubes.
  const join = t.addNode(GeometryNodeJoinGeometry, { location: [320, 100] });
  const out = t.addNode(NodeGroupOutput, { location: [560, 100] });
  t.addLink(lift.outputs[0]!, join.inputs[0]!);
  t.addLink(realise.outputs[0]!, join.inputs[0]!);
  t.addLink(join.outputs[0]!, out.inputs[0]!);
  return t;
}

function buildCompositorTree(): NodeTree {
  const t = new CompositorNodeTree('Comp');
  t.depsgraph.setEvaluator(new CompositorEvaluator({ width: 512, height: 512 }));

  // Source image: a flat red, mixed by gradient with a flat blue → produces
  // a placeholder for demo purposes. (Real apps wire CompositorNodeImage to
  // an external texture via `resolveTexture`.)
  const red  = t.addNode(CompositorNodeRGB, { location: [-700,  120] });
  (red.outputs[0]!.default_value as number[]).splice(0, 4, 0.9, 0.2, 0.2, 1);
  const blue = t.addNode(CompositorNodeRGB, { location: [-700, -120] });
  (blue.outputs[0]!.default_value as number[]).splice(0, 4, 0.1, 0.3, 0.9, 1);

  const mix  = t.addNode(CompositorNodeMixRGB, { location: [-440, 0] });
  (mix.inputs[0]!.default_value as unknown) = 0.5;
  t.addLink(red.outputs[0]!,  mix.inputs[1]!);
  t.addLink(blue.outputs[0]!, mix.inputs[2]!);

  // Pixel-wise chain — the planner fuses these into a SINGLE shader pass.
  const bc   = t.addNode(CompositorNodeBrightContrast, { location: [-200, 0] });
  (bc.inputs[1]!.default_value as unknown) = 0.1; // bright
  (bc.inputs[2]!.default_value as unknown) = 0.2; // contrast
  const inv  = t.addNode(CompositorNodeInvert,         { location: [40, 0] });
  (inv.inputs[0]!.default_value as unknown) = 0.4;  // partial invert

  t.addLink(mix.outputs[0]!, bc.inputs[0]!);
  t.addLink(bc.outputs[0]!,  inv.inputs[1]!);

  // A kernel (Blur) — this BREAKS the fused chain, becomes its own pass.
  const blur = t.addNode(CompositorNodeBlur, { location: [280, 0] });
  blur.size_x = 6; blur.size_y = 6;
  t.addLink(inv.outputs[0]!, blur.inputs[0]!);

  // Glare adds a fog-glow halo.
  const glare = t.addNode(CompositorNodeGlare, { location: [520, 0] });
  glare.threshold = 0.6; glare.mix = 0; glare.size = 12;
  t.addLink(blur.outputs[0]!, glare.inputs[0]!);

  // Vignette darkens corners.
  const vig = t.addNode(CompositorNodeVignette, { location: [760, 0] });
  vig.radius = 0.85; vig.softness = 0.4;
  t.addLink(glare.outputs[0]!, vig.inputs[0]!);

  const comp = t.addNode(CompositorNodeComposite, { location: [1020, 0] });
  t.addLink(vig.outputs[0]!, comp.inputs[0]!);
  return t;
}

function buildTextureTree(): NodeTree {
  const t = new TextureNodeTree('Tex');
  t.depsgraph.setEvaluator(new TextureEvaluator());
  const noise = t.addNode(TextureNodeNoise, { location: [-200, 100] });
  const checker = t.addNode(TextureNodeChecker, { location: [-200, -100] });
  const out = t.addNode(TextureNodeOutput, { location: [200, 0] });
  t.addLink(checker.outputs[0]!, out.inputs[0]!);
  void noise;
  return t;
}

/**
 * M4 demo: a particle-style Simulation Zone that scatters points on a grid
 * and pushes each one outward by its (Position × 0.05) per frame, producing
 * a slow radial "explosion" effect.
 */
function buildSimulationTree(): NodeTree {
  const t = new GeometryNodeTree('Sim');
  t.depsgraph.setEvaluator(new GeometryEvaluator());
  t.interface.new_socket({ name: 'Geometry', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' });

  // Initial state: distribute points on a grid
  const grid = t.addNode(GeometryNodeMeshGrid, { location: [-900, 0] });
  (grid.inputs[0]!.default_value as unknown) = 6;
  (grid.inputs[1]!.default_value as unknown) = 6;
  (grid.inputs[2]!.default_value as unknown) = 8;
  (grid.inputs[3]!.default_value as unknown) = 8;
  const dist = t.addNode(GeometryNodeDistributePointsOnFaces, { location: [-660, 0] });
  (dist.inputs[4]!.default_value as unknown) = 4;
  t.addLink(grid.outputs[0]!, dist.inputs[0]!);

  // The simulation zone
  const { input: sIn, output: sOut } = t.addZone('SIM');
  sIn.location = [-360, 0]; sOut.location = [380, 0];

  // Interior: offset = Position × 0.05, applied per frame via Set Position
  const pos = t.addNode(GeometryNodeInputPosition, { location: [-260, -180] });
  const scale = t.addNode(VectorMathNode, { location: [-40, -180] });
  scale.operation = 'SCALE';
  (scale.inputs[3]!.default_value as unknown) = 0.05;
  const setp = t.addNode(GeometryNodeSetPosition, { location: [180, -40] });

  // Wire: dist → sIn.in_Geometry (initial). sIn.Geometry → setp.Geometry.
  // pos → scale.A; scale.Vector → setp.Offset. setp → sOut.in_Geometry.
  for (const l of [...t.links]) {
    if (l.from_node === sIn && l.to_node === sOut) t.removeLink(l);
  }
  t.addLink(dist.outputs[0]!, sIn.inputs.find((s) => s.identifier === 'in_Geometry')!);
  t.addLink(sIn.outputs.find((s) => s.identifier === 'Geometry')!, setp.inputs[0]!);
  t.addLink(pos.outputs[0]!, scale.inputs[0]!);
  t.addLink(scale.outputs[0]!, setp.inputs[3]!);
  t.addLink(setp.outputs[0]!, sOut.inputs.find((s) => s.identifier === 'in_Geometry')!);

  // Output the sim's geometry
  const out = t.addNode(NodeGroupOutput, { location: [620, 0] });
  t.addLink(sOut.outputs.find((s) => s.identifier === 'Geometry')!, out.inputs[0]!);

  // suppress unused warnings for nodes we wire dynamically
  void MathNode;

  return t;
}

const TREES: { id: string; label: string; build: (useTSL: boolean) => NodeTree }[] = [
  { id: 'shader',     label: 'Shader',     build: (useTSL) => buildShaderTree(useTSL) },
  { id: 'geometry',   label: 'Geometry',   build: () => buildGeometryTree() },
  { id: 'simulation', label: 'Simulation', build: () => buildSimulationTree() },
  { id: 'compositor', label: 'Compositor', build: () => buildCompositorTree() },
  { id: 'texture',    label: 'Texture',    build: () => buildTextureTree() },
];

// Tracks the last `useTSL` value to detect actual changes for the shader slot.
const _tslRef = { current: false };

export function App() {
  const [activeId, setActiveId] = useState('shader');
  const [useTSL, setUseTSL] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(1);
  const storeSetTree = useTreeStore((s) => s.setTree);
  const storeSwitchTree = useTreeStore((s) => s.switchTree);
  const storeTrees = useTreeStore((s) => s.trees);
  const tree = useTreeStore((s) => s.tree);

  useEffect(() => {
    // Only rebuild the tree for this slot if:
    //  (a) it hasn't been built yet, OR
    //  (b) the TSL toggle changed for the shader tree (it changes the evaluator).
    const existing = storeTrees.get(activeId);
    const needRebuild = !existing || (activeId === 'shader' && useTSL !== _tslRef.current);
    _tslRef.current = useTSL;

    // Stop playback when changing trees.
    setPlaying(false);

    if (needRebuild) {
      const def = TREES.find((t) => t.id === activeId)!.build(useTSL);
      storeSetTree(activeId, def);
      setFrame(1);
      def.depsgraph.resetSimulation();
    } else {
      // Tree already exists — just switch to it (edits preserved).
      storeSwitchTree(activeId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, useTSL]);

  // Animation driver: when `playing`, advance one frame every 1/24s and
  // poke the depsgraph so the simulation zone(s) tick. Resetting clears the
  // sim cache so the next play-through restarts from initial state.
  useEffect(() => {
    if (!playing || !tree) return;
    let raf = 0;
    let last = performance.now();
    const fps = 24;
    const frameMs = 1000 / fps;
    let acc = 0;
    let f = frame;
    const tick = (now: number) => {
      const dt = now - last; last = now; acc += dt;
      while (acc >= frameMs) {
        acc -= frameMs;
        f = f + 1;
        tree.depsgraph.setScene({ frame: f, fps, elapsed: f / fps });
      }
      setFrame(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tree, frame]);

  if (!tree) return null;
  const showTSL = useTSL && activeId === 'shader';
  const isSim = activeId === 'simulation';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#121212', color: '#ddd' }}>
      <Header
        activeId={activeId} setActiveId={setActiveId}
        useTSL={useTSL} setUseTSL={setUseTSL}
        isSim={isSim} playing={playing} setPlaying={setPlaying}
        frame={frame}
        onReset={() => {
          setPlaying(false);
          setFrame(1);
          tree.depsgraph.resetSimulation();
          tree.depsgraph.setScene({ frame: 1, fps: 24, elapsed: 0 });
        }}
        onStep={() => {
          const f = frame + 1;
          setFrame(f);
          tree.depsgraph.setScene({ frame: f, fps: 24, elapsed: f / 24 });
        }}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid #000' }}>
          <NodeEditor />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {showTSL ? <TSLViewport /> : <Viewport />}
        </div>
      </div>
      <Footer />
    </div>
  );
}

function Header({
  activeId, setActiveId, useTSL, setUseTSL,
  isSim, playing, setPlaying, frame, onReset, onStep,
}: {
  activeId: string; setActiveId: (id: string) => void;
  useTSL: boolean; setUseTSL: (b: boolean) => void;
  isSim: boolean; playing: boolean; setPlaying: (b: boolean) => void;
  frame: number; onReset: () => void; onStep: () => void;
}) {
  const tree = useTreeStore((s) => s.tree);
  return (
    <div style={{
      height: 40, display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', background: '#1a1a1a', borderBottom: '1px solid #000',
      fontFamily: 'Inter, system-ui', fontSize: 12,
    }}>
      <strong style={{ color: '#fff' }}>blender-nodes-r3f</strong>
      <span style={{ opacity: 0.5 }}>— Blender node system on three.js / R3F</span>
      <div style={{ flex: 1 }} />
      <span style={{ opacity: 0.7 }}>Tree:</span>
      <select
        value={activeId}
        onChange={(e) => setActiveId(e.target.value)}
        style={selectStyle}
      >
        {TREES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: activeId === 'shader' ? 1 : 0.4 }}>
        <input
          type="checkbox"
          disabled={activeId !== 'shader'}
          checked={useTSL}
          onChange={(e) => setUseTSL(e.target.checked)}
        />
        TSL / WebGPU
      </label>

      {/* Playback controls (Simulation tree) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: isSim ? 1 : 0.35 }}>
        <button disabled={!isSim} onClick={() => setPlaying(!playing)} style={btnStyle}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button disabled={!isSim || playing} onClick={onStep} style={btnStyle}>⏭ Step</button>
        <button disabled={!isSim} onClick={onReset} style={btnStyle}>⏹ Reset</button>
        <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>
          frame {String(frame).padStart(3, '0')}
        </span>
      </div>

      <button onClick={() => tree && tree.depsgraph.invalidateAll()} style={btnStyle}>
        Evaluate
      </button>
      <button
        onClick={() => {
          if (!tree) return;
          const json = JSON.stringify(exportDocument([tree]), null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${tree.name}.bng.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }}
        style={btnStyle}
      >Export JSON</button>
    </div>
  );
}

function Footer() {
  const tree = useTreeStore((s) => s.tree);
  const version = useTreeStore((s) => s.version);
  return (
    <div style={{
      height: 24, padding: '0 12px', background: '#1a1a1a', borderTop: '1px solid #000',
      display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, opacity: 0.7,
      fontFamily: 'Inter, system-ui',
    }}>
      <span>v{version}</span>
      <span>{tree?.nodes.length} nodes</span>
      <span>{tree?.links.length} links</span>
      <div style={{ flex: 1 }} />
      <span>Right-click in the editor for the Add menu</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#2b2b2b', color: '#ddd', border: '1px solid #000',
  padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
};
const selectStyle: React.CSSProperties = {
  background: '#2b2b2b', color: '#ddd', border: '1px solid #000',
  padding: '4px 8px', borderRadius: 4, fontSize: 12,
};
