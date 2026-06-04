/**
 * SceneIntegration — bridges the blender-nodes-r3f evaluation pipeline to a
 * live three.js scene.
 *
 * Usage:
 *   const scene = new SceneIntegration(renderer, canvas);
 *   scene.setTree(shaderTree);   // or geometryTree, textureTree, compositorTree
 *
 *   function animate() {
 *     scene.update(performance.now());
 *     requestAnimationFrame(animate);
 *   }
 *
 * Handles:
 *   - Shader trees → MeshStandardMaterial / MeshPhysicalMaterial
 *   - Geometry trees → BufferGeometry (mesh, points, curves, instances)
 *   - Texture trees → DataTexture
 *   - Compositor trees → Quad with output texture
 *   - Simulation zone → per-frame depsgraph.setScene()
 *   - Incremental updates → only rebuilds dirty geometry/material
 */

import * as THREE from 'three';
import type { NodeTree } from '../core/NodeTree';
import { ShaderNodeTree, GeometryNodeTree, CompositorNodeTree, TextureNodeTree } from '../core/trees';
import type { MaterialDescriptor } from '../eval/shaders/ShaderNodeExecutors';
import { Geometry, MeshComponent, PointCloudComponent, InstancesComponent } from '../eval/geometry/Geometry';
import type { SampleFn } from '../eval/TextureEvaluator';
import type { EvaluatedComposite } from '../eval/CompositorEvaluator';

/* ── Options ─────────────────────────────────────────────────────── */

export interface SceneIntegrationOptions {
  /** Canvas element (used to size the renderer if autoResize is true). */
  canvas: HTMLCanvasElement;
  /** Pre-existing renderer; one is created if not provided. */
  renderer?: THREE.WebGLRenderer;
  /** Camera initial position. */
  cameraPosition?: [number, number, number];
  /** Orbit controls. */
  orbitControls?: boolean;
  /** Auto-resize to canvas on window resize. */
  autoResize?: boolean;
  /** Background colour. */
  background?: THREE.ColorRepresentation;
  /** Lighting preset. */
  lighting?: 'studio' | 'outdoor' | 'minimal' | 'none';
  /** Show grid. */
  showGrid?: boolean;
  /** Show axes helper. */
  showAxes?: boolean;
}

/* ── Default scene setup ──────────────────────────────────────────── */

const LIGHTING_PRESETS: Record<string, (s: THREE.Scene) => void> = {
  studio(scene) {
    const amb = new THREE.AmbientLight(0x404060, 0.8);
    amb.name = '__ambient__';
    scene.add(amb);
    const key = new THREE.DirectionalLight(0xffeedd, 2.5);
    key.position.set(3, 5, 2);
    key.name = '__key__';
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8899cc, 1.2);
    rim.position.set(-3, -1, -2);
    rim.name = '__rim__';
    scene.add(rim);
    const hemi = new THREE.HemisphereLight(0x8899cc, 0x443322, 0.6);
    hemi.name = '__hemi__';
    scene.add(hemi);
  },
  outdoor(scene) {
    const amb = new THREE.AmbientLight(0x8899cc, 0.5);
    amb.name = '__ambient__';
    scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffffcc, 1.5);
    sun.position.set(10, 15, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.name = '__sun__';
    scene.add(sun);
    const hemi = new THREE.HemisphereLight(0x8899cc, 0x665544, 0.4);
    hemi.name = '__hemi__';
    scene.add(hemi);
  },
  minimal(scene) {
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    amb.name = '__ambient__';
    scene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(2, 3, 4);
    key.name = '__key__';
    scene.add(key);
  },
  none() {},
};

/* ── SceneIntegration class ───────────────────────────────────────── */

export class SceneIntegration {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;

  private _tree: NodeTree | null = null;
  private _treeKind: string = '';
  private _mainMesh: THREE.Mesh | null = null;
  private _mainPoints: THREE.Points | null = null;
  private _mainLines: THREE.LineSegments | null = null;
  private _instGroup: THREE.Group | null = null;
  private _texturePlane: THREE.Mesh | null = null;
  private _compQuad: THREE.Mesh | null = null;
  private _grid: THREE.GridHelper | null = null;
  private _axes: THREE.AxesHelper | null = null;

  private _lastEvalVersion = -1;
  private _frame = 1;
  private _playing = false;
  private _fps = 24;
  private _lastFrameTime = 0;
  private _accumulator = 0;

  private _options: Required<SceneIntegrationOptions>;

  constructor(options: SceneIntegrationOptions) {
    this._options = {
      renderer: options.renderer ?? new THREE.WebGLRenderer({ canvas: options.canvas, antialias: true }),
      canvas: options.canvas,
      cameraPosition: options.cameraPosition ?? [3, 2, 4],
      orbitControls: options.orbitControls ?? true,
      autoResize: options.autoResize ?? true,
      background: options.background ?? '#101010',
      lighting: options.lighting ?? 'studio',
      showGrid: options.showGrid ?? true,
      showAxes: options.showAxes ?? false,
    };

    this.renderer = this._options.renderer;
    this.canvas = options.canvas;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this._options.background);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight),
      0.1,
      100,
    );
    this.camera.position.set(...this._options.cameraPosition);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const lightingFn = LIGHTING_PRESETS[this._options.lighting];
    if (lightingFn) lightingFn(this.scene);

    // Grid
    if (this._options.showGrid) {
      this._grid = new THREE.GridHelper(20, 20, 0x333333, 0x555555);
      this._grid.name = '__grid__';
      this.scene.add(this._grid);
    }

    // Axes
    if (this._options.showAxes) {
      this._axes = new THREE.AxesHelper(2);
      this._axes.name = '__axes__';
      this.scene.add(this._axes);
    }

    // Auto resize
    if (this._options.autoResize) {
      const onResize = () => {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w === 0 || h === 0) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', onResize);
      onResize();
    } else {
      this.renderer.setSize(this.canvas.width, this.canvas.height, false);
    }

    // Initial render
    this.renderer.render(this.scene, this.camera);
  }

  /* ── Tree management ──────────────────────────────────────────── */

  /** Replace the active node tree and rebuild the scene accordingly. */
  setTree(tree: NodeTree): void {
    // Unsubscribe old listener
    if (this._tree) {
      const r = (this._tree as unknown as { _sceneListener?: () => void })._sceneListener;
      if (r) r();
    }

    this._tree = tree;
    this._treeKind = (tree.constructor as unknown as { bl_idname: string }).bl_idname;
    this._lastEvalVersion = -1;
    this._frame = 1;

    // Subscribe to evaluation results
    const unsub = tree.depsgraph.on('evaluated', (result) => {
      this._onEvaluated(result.output);
    });
    (tree as unknown as { _sceneListener?: () => void })._sceneListener = unsub;

    // Trigger initial eval
    tree.depsgraph.invalidateAll();
  }

  /** Remove the current tree and clean up scene objects. */
  clearTree(): void {
    if (this._tree) {
      const r = (this._tree as unknown as { _sceneListener?: () => void })._sceneListener;
      if (r) r();
    }
    this._tree = null;
    this._treeKind = '';
    this._lastEvalVersion = -1;

    this._disposeDisplayObjects();
  }

  /* ── Playback control ──────────────────────────────────────────── */

  play(): void { this._playing = true; this._lastFrameTime = 0; }
  pause(): void { this._playing = false; }
  get playing(): boolean { return this._playing; }

  step(): void {
    if (!this._tree) return;
    this._frame++;
    this._tree.depsgraph.setScene({ frame: this._frame, fps: this._fps, elapsed: this._frame / this._fps });
  }

  reset(): void {
    if (!this._tree) return;
    this._frame = 1;
    this._playing = false;
    this._lastFrameTime = 0;
    this._accumulator = 0;
    this._tree.depsgraph.resetSimulation();
    this._tree.depsgraph.setScene({ frame: 1, fps: this._fps, elapsed: 0 });
  }

  get frame(): number { return this._frame; }

  /* ── Main update loop ──────────────────────────────────────────── */

  update(nowMs: number): void {
    // Animation
    if (this._playing && this._tree) {
      if (this._lastFrameTime === 0) this._lastFrameTime = nowMs;
      const dt = nowMs - this._lastFrameTime;
      this._lastFrameTime = nowMs;
      this._accumulator += dt;

      const frameMs = 1000 / this._fps;
      while (this._accumulator >= frameMs) {
        this._accumulator -= frameMs;
        this._frame++;
        this._tree.depsgraph.setScene({
          frame: this._frame,
          fps: this._fps,
          elapsed: this._frame / this._fps,
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  /* ── Render a single frame (non-animated) ──────────────────────── */

  renderFrame(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /* ── Dispose ───────────────────────────────────────────────────── */

  dispose(): void {
    this.clearTree();
    this.renderer.dispose();

    // Remove listeners
    const resizeListeners = (window as unknown as Record<string, unknown>);
    // Auto-resize cleanup handled naturally by component lifecycle

    // Dispose shared objects
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
  }

  /* ── Internal: handle evaluation results ───────────────────────── */

  private _onEvaluated(output: unknown): void {
    switch (this._treeKind) {
      case 'ShaderNodeTree':
        this._buildShaderMesh(output as MaterialDescriptor | null);
        break;
      case 'GeometryNodeTree':
        this._buildGeometryDisplay(output as Geometry | null);
        break;
      case 'TextureNodeTree':
        this._buildTextureDisplay(output as SampleFn | null);
        break;
      case 'CompositorNodeTree':
        this._buildCompositorDisplay(output as EvaluatedComposite | null);
        break;
    }
  }

  /* ── Shader display ────────────────────────────────────────────── */

  private _buildShaderMesh(desc: MaterialDescriptor | null): void {
    if (!this._mainMesh) {
      const g = new THREE.SphereGeometry(1, 64, 32);
      this._mainMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
      this._mainMesh.name = '__shader_preview__';
      this._clearDisplay();
      this.scene.add(this._mainMesh);
    }

    if (!desc) return;

    const mat = this._mainMesh.material as THREE.MeshStandardMaterial;
    mat.color.setRGB(desc.color[0], desc.color[1], desc.color[2]);
    mat.metalness = desc.metalness;
    mat.roughness = desc.roughness;
    mat.emissive.setRGB(desc.emissive[0], desc.emissive[1], desc.emissive[2]);
    mat.emissiveIntensity = desc.emissive_strength;
    mat.opacity = desc.opacity;
    mat.transparent = desc.opacity < 1;
    mat.needsUpdate = true;
  }

  /* ── Geometry display ──────────────────────────────────────────── */

  private _buildGeometryDisplay(geo: Geometry | null): void {
    this._clearDisplay();

    if (!geo || !(geo.mesh || geo.points || geo.curves || geo.instances)) {
      // Show a placeholder cube so the viewport doesn't look empty
      const g = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      const m = new THREE.MeshStandardMaterial({ color: '#ff4444', emissive: '#440000', emissiveIntensity: 0.5 });
      this._mainMesh = new THREE.Mesh(g, m);
      this._mainMesh.name = '__geo_empty__';
      this.scene.add(this._mainMesh);
      return;
    }

    // ── Mesh ──
    if (geo.mesh && geo.mesh.triangles.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(geo.mesh.positions, 3));
      g.setIndex(new THREE.BufferAttribute(geo.mesh.triangles, 1));
      g.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: '#cccccc',
        flatShading: true,
        metalness: 0.1,
        roughness: 0.6,
      });

      this._mainMesh = new THREE.Mesh(g, mat);
      this._mainMesh.name = '__geo_mesh__';
      this._mainMesh.castShadow = true;
      this._mainMesh.receiveShadow = true;
      this.scene.add(this._mainMesh);
    }

    // ── Points ──
    const ptsPos = geo.points?.positions
      ?? (geo.mesh && geo.mesh.triangles.length === 0 ? geo.mesh.positions : null);
    if (ptsPos && ptsPos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(ptsPos, 3));
      const mat = new THREE.PointsMaterial({
        color: '#88ccff',
        size: 0.05,
        sizeAttenuation: true,
        depthWrite: false,
      });
      this._mainPoints = new THREE.Points(g, mat);
      this._mainPoints.name = '__geo_points__';
      this.scene.add(this._mainPoints);
    }

    // ── Curves ──
    if (geo.curves && geo.curves.numPoints > 0) {
      const c = geo.curves;
      const segs: number[] = [];
      for (let ci = 0; ci < c.numCurves; ci++) {
        const start = c.curveOffsets[ci] ?? 0;
        const end = c.curveOffsets[ci + 1] ?? 0;
        const n = end - start;
        for (let i = 0; i < n - 1; i++) {
          const a = (start + i) * 3, b = (start + i + 1) * 3;
          segs.push(c.positions[a]!, c.positions[a + 1]!, c.positions[a + 2]!,
                   c.positions[b]!, c.positions[b + 1]!, c.positions[b + 2]!);
        }
        if (c.cyclic[ci] && n > 1) {
          const a = (start + n - 1) * 3, b = start * 3;
          segs.push(c.positions[a]!, c.positions[a + 1]!, c.positions[a + 2]!,
                   c.positions[b]!, c.positions[b + 1]!, c.positions[b + 2]!);
        }
      }
      if (segs.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
        const mat = new THREE.LineBasicMaterial({ color: '#ffaa55', linewidth: 1 });
        this._mainLines = new THREE.LineSegments(g, mat);
        this._mainLines.name = '__geo_curves__';
        this.scene.add(this._mainLines);
      }
    }

    // ── Instances ──
    if (geo.instances && geo.instances.numInstances > 0) {
      this._instGroup = new THREE.Group();
      this._instGroup.name = '__geo_instances__';

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
          color: '#cccccc',
          flatShading: true,
          metalness: 0.1,
          roughness: 0.6,
        });

        const inst = new THREE.InstancedMesh(g, mat, transforms.length);
        const m = new THREE.Matrix4();
        for (let i = 0; i < transforms.length; i++) {
          m.fromArray(transforms[i]!);
          inst.setMatrixAt(i, m);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true;
        inst.receiveShadow = true;
        this._instGroup.add(inst);
      }
      this.scene.add(this._instGroup);
    }
  }

  /* ── Texture display ───────────────────────────────────────────── */

  private _buildTextureDisplay(sample: SampleFn | null): void {
    this._clearDisplay();

    const size = 256;
    const data = new Uint8Array(size * size * 4);

    if (sample) {
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
    } else {
      // Checkerboard fallback
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = ((x >> 4) + (y >> 4)) % 2 === 0 ? 200 : 60;
          const i = (y * size + x) * 4;
          data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
        }
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const g = new THREE.PlaneGeometry(4, 4);
    this._texturePlane = new THREE.Mesh(g, mat);
    this._texturePlane.rotation.x = -Math.PI / 2;
    this._texturePlane.name = '__texture_preview__';
    this.scene.add(this._texturePlane);
  }

  /* ── Compositor display ────────────────────────────────────────── */

  private _buildCompositorDisplay(composite: EvaluatedComposite | null): void {
    this._clearDisplay();

    if (!composite) return;

    const tex = composite.texture ?? composite.viewer;
    if (!tex) return;

    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
    const g = new THREE.PlaneGeometry(3, 3);
    this._compQuad = new THREE.Mesh(g, mat);
    this._compQuad.position.y = 0.75;
    this._compQuad.name = '__comp_preview__';
    this.scene.add(this._compQuad);
  }

  /* ── Helpers ────────────────────────────────────────────────────── */

  private _disposeDisplayObjects(): void {
    for (const obj of [this._mainMesh, this._mainPoints, this._mainLines,
                       this._texturePlane, this._compQuad]) {
      if (obj) {
        this.scene.remove(obj);
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          (obj.material as THREE.Material | undefined)?.dispose();
        }
        obj as THREE.Object3D | null;
      }
    }
    if (this._instGroup) {
      this._instGroup.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry?.dispose();
          if (!Array.isArray(c.material)) (c.material as THREE.Material)?.dispose();
        }
      });
      this.scene.remove(this._instGroup);
    }
    this._mainMesh = null;
    this._mainPoints = null;
    this._mainLines = null;
    this._instGroup = null;
    this._texturePlane = null;
    this._compQuad = null;
  }

  private _clearDisplay(): void {
    this._disposeDisplayObjects();
  }
}