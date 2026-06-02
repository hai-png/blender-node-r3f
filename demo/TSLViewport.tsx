/**
 * TSLViewport — a WebGPU-backed R3F canvas that consumes the TSL evaluator's
 * `MeshStandardNodeMaterial` output. Falls back gracefully to a message if
 * the browser does not support WebGPU.
 *
 * The key trick: we pass a `gl` factory to <Canvas> that constructs Three's
 * WebGPURenderer (`WebGPURenderer` from 'three/webgpu'). R3F will use it
 * instead of WebGLRenderer.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { useTreeStore } from '../src/ui/store';

interface TSLEvalOut {
  descriptor: unknown;
  material: THREE.Material | null;
}

export function TSLViewport() {
  const tree = useTreeStore((s) => s.tree);
  const [material, setMaterial] = useState<THREE.Material | null>(null);
  const [webgpuOk, setWebgpuOk] = useState<boolean | null>(null);

  useEffect(() => {
    // Probe WebGPU once.
    const nav = navigator as Navigator & { gpu?: unknown };
    setWebgpuOk(typeof nav.gpu !== 'undefined');
  }, []);

  useEffect(() => {
    return tree.depsgraph.on('evaluated', (r) => {
      const out = r.output as TSLEvalOut | undefined;
      if (out && out.material) setMaterial(out.material);
    });
  }, [tree]);

  useEffect(() => { tree.depsgraph.invalidateAll(); }, [tree]);

  if (webgpuOk === false) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#101010', color: '#aaa', padding: 24, textAlign: 'center', fontSize: 12 }}>
        <div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>WebGPU not available</div>
          The TSL viewport needs WebGPU. Use the standard viewport tab,
          or open this app in Chrome/Edge ≥ 113 on a desktop machine.
        </div>
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: [3, 2, 4], fov: 50 }}
      style={{ width: '100%', height: '100%', background: '#101010' }}
      // R3F's `gl` slot accepts a factory: it receives an HTMLCanvasElement.
      gl={(canvas) => {
        const renderer = new WebGPURenderer({ canvas: canvas as HTMLCanvasElement, antialias: true });
        // R3F expects a sync-or-async return; WebGPURenderer needs an init().
        // We piggyback on the async init by returning the renderer and
        // calling init() — R3F's setSize will then succeed.
        renderer.init();
        return renderer as unknown as THREE.WebGLRenderer;
      }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <directionalLight position={[-3, -1, -2]} intensity={0.4} color={0x88aaff} />
      <Grid args={[20, 20]} cellColor="#333" sectionColor="#555" sectionSize={5} fadeDistance={20} infiniteGrid />
      <OrbitControls enableDamping />
      <TSLPreview material={material} />
    </Canvas>
  );
}

function TSLPreview({ material }: { material: THREE.Material | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!meshRef.current || !material) return;
    const old = meshRef.current.material;
    meshRef.current.material = material;
    if (old && !Array.isArray(old) && old !== material) old.dispose?.();
  }, [material]);
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 64, 32]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  );
}
