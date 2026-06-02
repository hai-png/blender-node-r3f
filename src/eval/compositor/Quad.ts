/**
 * Shared fullscreen quad used to drive every Operation pass. Mirrors
 * three/examples/jsm/postprocessing/Pass.js's FullScreenQuad, reimplemented
 * here to keep the compositor self-contained (no examples/jsm dependency).
 */
import * as THREE from 'three';

export class FullScreenQuad {
  /** Shared single-triangle covering the NDC space. */
  static readonly geometry: THREE.BufferGeometry = (() => {
    const g = new THREE.BufferGeometry();
    // A single triangle is enough to cover the screen and avoids a seam
    // through the middle that a 2-triangle quad would have.
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    return g;
  })();
  /** Shared orthographic camera positioned to render the full triangle. */
  static readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private mesh: THREE.Mesh;

  constructor(public material: THREE.Material) {
    this.mesh = new THREE.Mesh(FullScreenQuad.geometry, material);
    this.mesh.frustumCulled = false;
  }

  setMaterial(m: THREE.Material): void {
    this.material = m;
    this.mesh.material = m;
  }

  /** Render to the currently-bound render target (renderer.setRenderTarget). */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.mesh, FullScreenQuad.camera);
  }

  dispose(): void {
    // The geometry + camera are shared statics; don't dispose them.
    // The material is owned by the Operation.
  }
}
