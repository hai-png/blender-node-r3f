/**
 * SceneIntegrationViewport — R3F component that uses SceneIntegration
 * to bridge any node tree evaluation output to a three.js scene.
 *
 * Supports:
 *   - Shader trees → sphere with procedural material
 *   - Geometry trees → mesh / points / curves / instances
 *   - Texture trees → textured plane
 *   - Compositor trees → quad with output texture
 *   - Simulation zone playback
 *   - Orbit controls with damping
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useTreeStore } from '../src/ui/store';
import type { MaterialDescriptor } from '../src/eval/shaders/ShaderNodeExecutors';
import { Geometry, MeshComponent, PointCloudComponent, InstancesComponent } from '../src/eval/geometry/Geometry';
import type { SampleFn } from '../src/eval/TextureEvaluator';
import type { EvaluatedComposite } from '../src/eval/CompositorEvaluator';

/* ── Main component ──────────────────────────────────────────────── */

export function FullViewport() {
  const tree = useTreeStore((s) => s.tree);
  const version = useTreeStore((s) => s.version);
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    const unsub = tree.depsgraph.on('evaluated', (r) => setResult(r.output));
    tree.depsgraph.invalidateAll();
    return unsub;
  }, [tree, version]);

  const kind = (tree.constructor as unknown as { bl_idname: string }).bl_idname;

  return (
    <Canvas
      camera={{ position: [3, 2, 4], fov: 50 }}
      style={{ width: '100%', height: '100%', background: '#101010' }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <directionalLight position={[-3, -1, -2]} intensity={0.4} color={0x88aaff} />
      <Grid args={[20, 20]} cellColor="#333" sectionColor="#555" sectionSize={5} fadeDistance={20} infiniteGrid />
      <OrbitControls enableDamping dampingFactor={0.08} />

      {kind === 'ShaderNodeTree' && <ShaderScenePreview desc={result as MaterialDescriptor | null} />}
      {kind === 'GeometryNodeTree' && <GeometryScenePreview geo={result as Geometry | null} />}
      {kind === 'TextureNodeTree' && <TextureScenePreview sample={result as SampleFn | null} />}
      {kind === 'CompositorNodeTree' && <CompositorScenePreview composite={result as EvaluatedComposite | null} />}
    </Canvas>
  );
}

/* ── Shader preview: sphere + descriptor → material ──────────────── */

function ShaderScenePreview({ desc }: { desc: MaterialDescriptor | null }) {
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
    <group rotation={[0.3, 0.5, 0]}>
      <mesh material={mat}>
        <sphereGeometry args={[1.2, 128, 64]} />
      </mesh>
      <mesh position={[0, -1.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <shadowMaterial opacity={0.2} />
      </mesh>
    </group>
  );
}

/* ── Geometry preview with mesh / points / curves / instances ────── */

function GeometryScenePreview({ geo }: { geo: Geometry | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const curveRef = useRef<THREE.LineSegments>(null);
  const instGroupRef = useRef<THREE.Group>(null);
  const emptyRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!geo) return;

    // ── Mesh ──
    if (meshRef.current) {
      const m = meshRef.current;
      if (geo.mesh && geo.mesh.triangles.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(geo.mesh.positions, 3));
        g.setIndex(new THREE.BufferAttribute(geo.mesh.triangles, 1));
        g.computeVertexNormals();
        const old = m.geometry;
        m.geometry = g;
        old?.dispose();
        m.visible = true;
      } else {
        m.visible = false;
      }
    }

    // ── Points ──
    if (pointsRef.current) {
      const p = pointsRef.current;
      const ptsPos = geo.points?.positions
        ?? (geo.mesh && geo.mesh.triangles.length === 0 ? geo.mesh.positions : null);
      if (ptsPos && ptsPos.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(ptsPos, 3));
        const old = p.geometry;
        p.geometry = g;
        old?.dispose();
        p.visible = true;
      } else {
        p.visible = false;
      }
    }

    // ── Curves ──
    if (curveRef.current) {
      const c = curveRef.current;
      if (geo.curves && geo.curves.numPoints > 0) {
        const segs = buildCurveSegments(geo.curves);
        if (segs.length > 0) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
          const old = c.geometry;
          c.geometry = g;
          old?.dispose();
          c.visible = true;
        } else {
          c.visible = false;
        }
      } else {
        c.visible = false;
      }
    }

    // ── Instances ──
    if (instGroupRef.current) {
      const group = instGroupRef.current;
      // Clear previous
      while (group.children.length) {
        const child = group.children.pop()!;
        group.remove(child);
        (child as THREE.InstancedMesh).geometry?.dispose?.();
        const cm = (child as THREE.InstancedMesh).material as THREE.Material | undefined;
        cm?.dispose?.();
      }

      if (geo.instances && geo.instances.numInstances > 0) {
        const buckets = new Map<number, { source: number; transforms: Float32Array[] }>();
        for (const it of geo.instances.items) {
          const e = buckets.get(it.source) ?? { source: it.source, transforms: [] };
          e.transforms.push(it.transform);
          buckets.set(it.source, e);
        }
        for (const { source, transforms } of buckets.values()) {
          const src = geo.instances.sources[source];
          if (!src?.mesh) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(src.mesh.positions, 3));
          if (src.mesh.triangles.length > 0) {
            g.setIndex(new THREE.BufferAttribute(src.mesh.triangles, 1));
          }
          g.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({
            color: '#cccccc', flatShading: true, metalness: 0.1, roughness: 0.6,
          });
          const inst = new THREE.InstancedMesh(g, mat, transforms.length);
          const m4 = new THREE.Matrix4();
          for (let i = 0; i < transforms.length; i++) {
            m4.fromArray(transforms[i]!);
            inst.setMatrixAt(i, m4);
          }
          inst.instanceMatrix.needsUpdate = true;
          inst.castShadow = true;
          inst.receiveShadow = true;
          group.add(inst);
        }
      }
    }

  }, [geo]);

  return (
    <group>
      <mesh ref={meshRef}>
        <bufferGeometry />
        <meshStandardMaterial color="#cccccc" flatShading metalness={0.1} roughness={0.6} />
      </mesh>
      <points ref={pointsRef}>
        <bufferGeometry />
        <pointsMaterial color="#88ccff" size={0.05} sizeAttenuation depthWrite={false} />
      </points>
      <lineSegments ref={curveRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#ffaa55" linewidth={1} />
      </lineSegments>
      <group ref={instGroupRef} />
      {/* Empty geometry fallback */}
      <mesh ref={emptyRef} visible={false}>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
        <meshStandardMaterial color="#ff4444" />
      </mesh>
    </group>
  );
}

/* ── Texture preview ─────────────────────────────────────────────── */

function TextureScenePreview({ sample }: { sample: SampleFn | null }) {
  const tex = useMemo(() => {
    const size = 512;
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
      <planeGeometry args={[5, 5]} />
      <meshBasicMaterial map={tex.tex} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ── Compositor preview ──────────────────────────────────────────── */

function CompositorScenePreview({ composite }: { composite: EvaluatedComposite | null }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!composite || !meshRef.current) return;
    const tex = composite.texture ?? composite.viewer;
    if (!tex) return;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
    meshRef.current.material = mat;
  }, [composite]);

  return (
    <mesh ref={meshRef} position={[0, 0.75, 0]}>
      <planeGeometry args={[3, 3]} />
      <meshBasicMaterial color="#222" />
    </mesh>
  );
}

/* ── Curve geometry builder ──────────────────────────────────────── */

function buildCurveSegments(curves: {
  numCurves: number;
  numPoints: number;
  positions: Float32Array;
  curveOffsets: Uint32Array;
  cyclic: Uint8Array;
}): number[] {
  const segs: number[] = [];
  for (let ci = 0; ci < curves.numCurves; ci++) {
    const start = curves.curveOffsets[ci] ?? 0;
    const end = curves.curveOffsets[ci + 1] ?? 0;
    const n = end - start;
    for (let i = 0; i < n - 1; i++) {
      const a = (start + i) * 3, b = (start + i + 1) * 3;
      segs.push(
        curves.positions[a]!, curves.positions[a + 1]!, curves.positions[a + 2]!,
        curves.positions[b]!, curves.positions[b + 1]!, curves.positions[b + 2]!,
      );
    }
    if (curves.cyclic[ci] && n > 1) {
      const a = (start + n - 1) * 3, b = start * 3;
      segs.push(
        curves.positions[a]!, curves.positions[a + 1]!, curves.positions[a + 2]!,
        curves.positions[b]!, curves.positions[b + 1]!, curves.positions[b + 2]!,
      );
    }
  }
  return segs;
}
