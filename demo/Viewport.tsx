/**
 * R3F viewport — renders whatever the active tree's evaluator produced.
 *
 *  - ShaderNodeTree     -> material on a sphere
 *  - GeometryNodeTree   -> mesh built from the produced Geometry
 *  - TextureNodeTree    -> textured plane
 *  - CompositorNodeTree -> just shows the plan (M0)
 */
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useTreeStore } from '../src/ui/store';
import type { MaterialDescriptor } from '../src/eval/ShaderEvaluator';
import { Geometry as GeoData } from '../src/eval/geometry/Geometry';
import type { SampleFn } from '../src/eval/TextureEvaluator';
import type { EvaluatedComposite } from '../src/eval/CompositorEvaluator';

export function Viewport() {
  const tree = useTreeStore((s) => s.tree);
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    return tree.depsgraph.on('evaluated', (r) => setResult(r.output));
  }, [tree]);

  // Force an initial evaluation
  useEffect(() => { tree.depsgraph.invalidateAll(); }, [tree]);

  const kind = (tree.constructor as unknown as { bl_idname: string }).bl_idname;

  return (
    <Canvas camera={{ position: [3, 2, 4], fov: 50 }} style={{ width: '100%', height: '100%', background: '#101010' }}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <directionalLight position={[-3, -1, -2]} intensity={0.4} color={0x88aaff} />
      <Grid args={[20, 20]} cellColor="#333" sectionColor="#555" sectionSize={5} fadeDistance={20} infiniteGrid />
      <OrbitControls enableDamping />

      {kind === 'ShaderNodeTree' && <ShaderPreview desc={result as MaterialDescriptor | null} />}
      {kind === 'GeometryNodeTree' && <GeometryPreview geo={result as GeoData | null} />}
      {kind === 'TextureNodeTree' && <TexturePreview sample={result as SampleFn | null} />}
      {kind === 'CompositorNodeTree' && <CompositorPreview composite={result as EvaluatedComposite | null} />}
    </Canvas>
  );
}

function ShaderPreview({ desc }: { desc: MaterialDescriptor | null }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial(), []);
  useEffect(() => {
    if (!desc) return;
    mat.color.setRGB(desc.color[0], desc.color[1], desc.color[2]);
    mat.metalness = desc.metalness;
    mat.roughness = desc.roughness;
    mat.emissive.setRGB(desc.emissive[0], desc.emissive[1], desc.emissive[2]);
    mat.emissiveIntensity = desc.emissive_strength;
    mat.opacity = desc.opacity;
    mat.transparent = desc.opacity < 1;
    mat.needsUpdate = true;
  }, [desc, mat]);
  return (
    <mesh material={mat}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}

function GeometryPreview({ geo }: { geo: GeoData | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const curveRef = useRef<THREE.LineSegments>(null);
  const instGroupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!geo) return;
    // -------------------- Mesh --------------------
    if (meshRef.current) {
      const g = new THREE.BufferGeometry();
      if (geo.mesh && geo.mesh.triangles.length > 0) {
        g.setAttribute('position', new THREE.BufferAttribute(geo.mesh.positions, 3));
        g.setIndex(new THREE.BufferAttribute(geo.mesh.triangles, 1));
        g.computeVertexNormals();
      }
      const old = meshRef.current.geometry;
      meshRef.current.geometry = g;
      old?.dispose();
      meshRef.current.visible = !!(geo.mesh && geo.mesh.triangles.length > 0);
    }
    // -------------------- Points --------------------
    if (pointsRef.current) {
      const g = new THREE.BufferGeometry();
      const pos = geo.points?.positions
        ?? (geo.mesh && geo.mesh.triangles.length === 0 ? geo.mesh.positions : null);
      if (pos && pos.length > 0) {
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      }
      const old = pointsRef.current.geometry;
      pointsRef.current.geometry = g;
      old?.dispose();
      pointsRef.current.visible = !!(pos && pos.length > 0);
    }
    // -------------------- Curve (as line segments) --------------------
    if (curveRef.current) {
      const g = new THREE.BufferGeometry();
      if (geo.curves && geo.curves.numPoints > 0) {
        const c = geo.curves;
        const segs: number[] = [];
        for (let ci = 0; ci < c.numCurves; ci++) {
          const start = c.curveOffsets[ci] ?? 0;
          const end = c.curveOffsets[ci + 1] ?? 0;
          const n = end - start;
          for (let i = 0; i < n - 1; i++) {
            const a = (start + i) * 3, b = (start + i + 1) * 3;
            segs.push(
              c.positions[a]!, c.positions[a + 1]!, c.positions[a + 2]!,
              c.positions[b]!, c.positions[b + 1]!, c.positions[b + 2]!,
            );
          }
          if (c.cyclic[ci] && n > 1) {
            const a = (start + n - 1) * 3, b = start * 3;
            segs.push(
              c.positions[a]!, c.positions[a + 1]!, c.positions[a + 2]!,
              c.positions[b]!, c.positions[b + 1]!, c.positions[b + 2]!,
            );
          }
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      }
      const old = curveRef.current.geometry;
      curveRef.current.geometry = g;
      old?.dispose();
      curveRef.current.visible = !!geo.curves && geo.curves.numPoints > 0;
    }
    // -------------------- Instances --------------------
    if (instGroupRef.current) {
      // wipe previous children
      while (instGroupRef.current.children.length) {
        const c = instGroupRef.current.children.pop()!;
        c.parent?.remove(c);
        (c as THREE.InstancedMesh).geometry?.dispose?.();
        const mat = (c as THREE.InstancedMesh).material as THREE.Material | undefined;
        mat?.dispose?.();
      }
      if (geo.instances && geo.instances.numInstances > 0) {
        // Group instances by source index.
        const buckets = new Map<number, { source: number; transforms: Float32Array[] }>();
        for (const it of geo.instances.items) {
          const e = buckets.get(it.source) ?? { source: it.source, transforms: [] };
          e.transforms.push(it.transform);
          buckets.set(it.source, e);
        }
        for (const { source, transforms } of buckets.values()) {
          const src = geo.instances.sources[source];
          if (!src || !src.mesh) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(src.mesh.positions, 3));
          if (src.mesh.triangles.length > 0) g.setIndex(new THREE.BufferAttribute(src.mesh.triangles, 1));
          g.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: '#cccccc', flatShading: true, metalness: 0.1, roughness: 0.6 });
          const inst = new THREE.InstancedMesh(g, mat, transforms.length);
          const m = new THREE.Matrix4();
          for (let i = 0; i < transforms.length; i++) {
            m.fromArray(transforms[i]!);
            inst.setMatrixAt(i, m);
          }
          inst.instanceMatrix.needsUpdate = true;
          instGroupRef.current.add(inst);
        }
      }
    }
  }, [geo]);

  return (
    <>
      <mesh ref={meshRef}>
        <bufferGeometry />
        <meshStandardMaterial color="#cccccc" flatShading metalness={0.1} roughness={0.6} />
      </mesh>
      <points ref={pointsRef}>
        <bufferGeometry />
        <pointsMaterial color="#88ccff" size={0.05} sizeAttenuation />
      </points>
      <lineSegments ref={curveRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#ffaa55" linewidth={2} />
      </lineSegments>
      <group ref={instGroupRef} />
    </>
  );
}

function TexturePreview({ sample }: { sample: SampleFn | null }) {
  const tex = useMemo(() => {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    return { tex: new THREE.DataTexture(data, size, size, THREE.RGBAFormat), size, data };
  }, []);
  useEffect(() => {
    if (!sample) return;
    const { data, size } = tex;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = sample(x / size, y / size);
        const i = (y * size + x) * 4;
        data[i] = Math.round(c[0] * 255);
        data[i + 1] = Math.round(c[1] * 255);
        data[i + 2] = Math.round(c[2] * 255);
        data[i + 3] = Math.round(c[3] * 255);
      }
    }
    tex.tex.needsUpdate = true;
  }, [sample, tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[4, 4]} />
      <meshBasicMaterial map={tex.tex} />
    </mesh>
  );
}

function CompositorPreview({ composite }: { composite: EvaluatedComposite | null }) {
  useFrame(() => {});
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useEffect(() => {
    if (!composite) return;
    if (!matRef.current) {
      matRef.current = new THREE.MeshBasicMaterial({
        map: composite.texture ?? composite.viewer ?? null,
        side: THREE.DoubleSide,
        transparent: true,
      });
      if (meshRef.current) meshRef.current.material = matRef.current;
    }
    matRef.current.map = composite.texture ?? composite.viewer ?? null;
    matRef.current.needsUpdate = true;
  }, [composite]);

  return (
    <>
      {/* Display the final composite on a billboarded plane facing the camera. */}
      <mesh ref={meshRef} position={[0, 0.75, 0]}>
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial color="#222" />
      </mesh>
      {composite && composite.headless && (
        <mesh position={[0, 0.75, 0.01]}>
          <planeGeometry args={[3, 0.4]} />
          <meshBasicMaterial color="#552222" />
        </mesh>
      )}
    </>
  );
}
