/**
 * CompositorEvaluator — full WebGL render-target pipeline.
 *
 * Implements Blender's GPU compositor design at small scale:
 *   - `Result` = either an image (WebGLRenderTarget) or a value/colour/vector
 *   - `Operation` = one node, with `compile()` → fullscreen shader pass
 *   - **ShaderOperation fusion**: pixel-wise nodes are coalesced into a
 *     single fragment shader by the planner.
 *
 * The renderer is allocated lazily; if WebGL isn't available (Node, SSR),
 * a `headless: true` fallback EvaluatedComposite is returned so consumers
 * keep working.
 *
 * Public shape:
 *   const ev = new CompositorEvaluator({ width: 1024, height: 1024 });
 *   tree.depsgraph.setEvaluator(ev);
 *   ...tree edits...
 *   const { texture, width, height } = (await tree.depsgraph.evaluate()).output;
 */
import * as THREE from 'three';
import type { NodeTree } from '../../core/NodeTree';
import type { Node } from '../../core/Node';
import type { NodeSocket } from '../../core/NodeSocket';
import type { SystemEvaluator, EvaluationResult } from '../Depsgraph';
import {
  CompNode, CompositorNodeBlur, CompositorNodeGlare, CompositorNodeVignette,
  CompositorNodePixelate, CompositorNodeTranslate, CompositorNodeScale,
  CompositorNodeRotate, CompositorNodeFlip, CompositorNodeCrop,
  CompositorNodeImage, CompositorNodeRGB, CompositorNodeValue, CompositorNodeRLayers,
  CompositorNodeComposite, CompositorNodeViewer,
} from '../../nodes/compositor/Compositor';
import { flattenTree, flatTopoOrder, type FlatLink } from '../flatten';
import { cpuComposite } from './CpuComposite';
import { TexturePool } from './TexturePool';
import { FullScreenQuad } from './Quad';
import {
  type Result, type EvaluatedComposite, valueResult, colorResult,
} from './types';
import { PIXEL_EMITTERS, GLSL_PRELUDE, type PixelEnv } from './PixelGLSL';
import {
  FULLSCREEN_VS, BlurProgram, GlareThresholdProgram, GlareAddProgram,
  VignetteProgram, PixelateProgram, TranslateProgram, ScaleProgram,
  RotateProgram, FlipProgram, CropProgram, type KernelProgram,
} from './KernelShaders';

interface PlannerOp {
  id: string;
  label: string;
  /** PIXEL_FUSED: one fused fragment shader for a chain of pixel-wise nodes. */
  kind: 'INPUT_IMAGE' | 'INPUT_CONST' | 'PIXEL_FUSED' | 'KERNEL' | 'OUTPUT';
  /** Source node(s). For PIXEL_FUSED this is the chain in order. */
  nodes: Node[];
  /** Inputs the operation reads, keyed by socket identifier on the *last* node. */
  bindings: { localId: string; from: { opId: string; outId: string } | null; defaultResult: Result }[];
  /** Output identifiers the operation produces. */
  outputs: string[];
}

export interface CompositorEvaluatorOptions {
  /** Output canvas width (default 512). */
  width?: number;
  /** Output canvas height (default 512). */
  height?: number;
  /** Bring your own renderer. Otherwise constructed lazily. */
  renderer?: THREE.WebGLRenderer;
  /**
   * Optional accessor for external texture sources used by Image / Render
   * Layers nodes. Looked up by `node.image_src` (Image) or by `node.id`
   * (Render Layers). If omitted, those nodes emit a black image.
   */
  resolveTexture?: (key: string) => THREE.Texture | null;
}

export class CompositorEvaluator implements SystemEvaluator {
  width: number;
  height: number;
  private renderer: THREE.WebGLRenderer | null = null;
  private ownsRenderer = false;
  private pool: TexturePool | null = null;
  private fsQuad: FullScreenQuad | null = null;
  private resolveTexture?: (key: string) => THREE.Texture | null;
  /** Cache of compiled shader materials, keyed by fragment source. */
  private materialCache = new Map<string, THREE.ShaderMaterial>();
  /** Effective link map for the current evaluate()/plan() pass (flattened). */
  private _srcMap: Map<NodeSocket, FlatLink> = new Map();
  /** Final / viewer targets kept alive between evaluations. */
  private finalTarget: THREE.WebGLRenderTarget | null = null;
  private viewerTarget: THREE.WebGLRenderTarget | null = null;

  constructor(opts: CompositorEvaluatorOptions = {}) {
    this.width = opts.width ?? 512;
    this.height = opts.height ?? 512;
    this.renderer = opts.renderer ?? null;
    this.ownsRenderer = !opts.renderer;
    if (opts.resolveTexture) this.resolveTexture = opts.resolveTexture;
  }

  /** Wipe GPU state. Safe to call multiple times. */
  dispose(): void {
    for (const m of this.materialCache.values()) m.dispose();
    this.materialCache.clear();
    this.pool?.dispose(); this.pool = null;
    this.fsQuad?.dispose(); this.fsQuad = null;
    this.finalTarget?.dispose(); this.finalTarget = null;
    this.viewerTarget?.dispose(); this.viewerTarget = null;
    if (this.ownsRenderer) this.renderer?.dispose();
    this.renderer = null;
  }

  /**
   * Public planner — returns the operation list the next `evaluate()` will
   * run. Useful for tests and inspection panels; does no GPU work.
   */
  planTree(tree: NodeTree): { id: string; label: string; kind: string; nodeCount: number }[] {
    const errors = new Map<string, string>();
    return this.plan(tree, errors).map((p) => ({
      id: p.id, label: p.label, kind: p.kind, nodeCount: p.nodes.length,
    }));
  }

  evaluate(tree: NodeTree, _dirty: ReadonlySet<Node>): EvaluationResult {
    const start = performance.now();
    const timings = new Map<string, number>();
    const errors = new Map<string, string>();

    // Lazy renderer initialisation. If no WebGL is available (Node/SSR),
    // return a stub EvaluatedComposite — consumers (e.g. the demo) check
    // `headless` and render a placeholder.
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: false });
        this.renderer.setSize(this.width, this.height, false);
        this.ownsRenderer = true;
      } catch (e) {
        // No WebGL: fall back to the CPU evaluator. We can at least resolve
        // a constant (solid-colour) composite for inspection + tests.
        const rgba = cpuComposite(tree);
        const headless: EvaluatedComposite = {
          texture: null, width: this.width, height: this.height,
          viewer: null, operations: [], headless: true,
          cpuColor: rgba ?? null,
        };
        errors.set('__init__', (e as Error).message);
        return { output: headless, duration_ms: performance.now() - start, node_timings: timings, errors };
      }
    }
    if (!this.pool) this.pool = new TexturePool();
    if (!this.fsQuad) this.fsQuad = new FullScreenQuad(new THREE.MeshBasicMaterial());

    const plan = this.plan(tree, errors);

    // Run.
    const resultByOp = new Map<string, Map<string, Result>>();
    const usedTargets: THREE.WebGLRenderTarget[] = [];
    const refRelease = (target: THREE.WebGLRenderTarget): void => {
      // We hold onto every intermediate target until all consumers have
      // executed. Simpler than reference-counting and still cheap; pool
      // automatically reuses across evals.
      usedTargets.push(target);
    };

    let finalImage: THREE.Texture | null = null;
    let viewerImage: THREE.Texture | null = null;
    const opTimings: { id: string; label: string; ms: number }[] = [];

    for (const op of plan) {
      const t0 = performance.now();
      try {
        const inputs = new Map<string, Result>();
        for (const b of op.bindings) {
          if (b.from) {
            const m = resultByOp.get(b.from.opId);
            inputs.set(b.localId, m?.get(b.from.outId) ?? b.defaultResult);
          } else {
            inputs.set(b.localId, b.defaultResult);
          }
        }
        const outs = this.runOperation(op, inputs, refRelease);
        if (outs.size) resultByOp.set(op.id, outs);

        // Capture Composite / Viewer outputs to their dedicated targets.
        if (op.kind === 'OUTPUT') {
          const incoming = inputs.get('Image');
          if (incoming && incoming.kind === 'IMAGE') {
            if (op.nodes[0] instanceof CompositorNodeComposite) {
              finalImage = this.captureToOwnedTarget(incoming, 'final');
            } else if (op.nodes[0] instanceof CompositorNodeViewer) {
              viewerImage = this.captureToOwnedTarget(incoming, 'viewer');
            }
          }
        }
      } catch (e) {
        errors.set(op.id, (e as Error).message);
      }
      opTimings.push({ id: op.id, label: op.label, ms: performance.now() - t0 });
    }

    // Release transient targets back to the pool.
    for (const t of usedTargets) this.pool.release(t);

    const output: EvaluatedComposite = {
      texture: finalImage ?? viewerImage,
      width: this.width,
      height: this.height,
      viewer: viewerImage,
      operations: opTimings,
      headless: false,
    };
    return {
      output,
      duration_ms: performance.now() - start,
      node_timings: timings,
      errors,
    };
  }

  // ============================================================
  //  Planning
  // ============================================================

  private plan(tree: NodeTree, errors: Map<string, string>): PlannerOp[] {
    // Flatten groups + bypass reroutes so the planner sees a plain graph.
    const flat = flattenTree(tree);
    const srcMap = new Map<NodeSocket, FlatLink>();
    for (const l of flat.links) srcMap.set(l.to_socket, l);
    this._srcMap = srcMap;
    const order = flatTopoOrder(flat);
    // Local helpers mirroring socket.is_linked / socket.links[0] but over
    // the flattened topology.
    const srcLink = (sock: NodeSocket): FlatLink | undefined => srcMap.get(sock);
    const plan: PlannerOp[] = [];

    // Track which node produced which `PlannerOp`. For fused units, multiple
    // nodes share the same op id; we map each node to (opId, outputId).
    const nodeToOp = new Map<string, { opId: string; outId: string }>();

    // Walk the topo order. Pixel-wise nodes get bundled greedily into a
    // chain as long as each consecutive node has at most ONE pixel-wise
    // upstream feeding its main image input (so the fused shader stays
    // linear). Branching breaks the chain (we materialise the unit and
    // start a new one).
    let currentChain: Node[] = [];
    let currentChainHead: { opId: string; outId: string } | null = null;

    const flushChain = (): void => {
      if (!currentChain.length) return;
      const last = currentChain[currentChain.length - 1]!;
      const opId = `pixel:${currentChain[0]!.id}->${last.id}`;
      const bindings: PlannerOp['bindings'] = [];
      // External inputs are the "free" inputs of the chain — the union of
      // every node's input sockets, *minus* sockets fed by another node in
      // the chain. For simplicity we register one binding per (node,input).
      for (const n of currentChain) {
        for (const s of n.inputs) {
          // Skip if the link's source is also in the chain.
          const sl = srcLink(s);
          if (sl) {
            const link = sl;
            const fromInChain = currentChain.includes(link.from_node);
            if (fromInChain) continue;
            const src = nodeToOp.get(link.from_node.id);
            bindings.push({
              localId: `${n.id}::${s.identifier}`,
              from: src ? { opId: src.opId, outId: src.outId } : null,
              defaultResult: defaultResultForSocket(s),
            });
          } else {
            bindings.push({
              localId: `${n.id}::${s.identifier}`,
              from: null,
              defaultResult: defaultResultForSocket(s),
            });
          }
        }
      }
      const outId = `${last.id}::Image`;
      plan.push({
        id: opId, label: `${currentChain.map((n) => n.bl_label).join(' → ')}`,
        kind: 'PIXEL_FUSED',
        nodes: [...currentChain],
        bindings,
        outputs: [outId],
      });
      // Each node's primary output points at the fused op's single image out.
      for (const n of currentChain) nodeToOp.set(n.id, { opId, outId });
      currentChain = [];
      currentChainHead = null;
    };

    for (const node of order) {
      if (!(node instanceof CompNode)) {
        // Foreign node — emit a degenerate constant black input op so the
        // graph still resolves.
        flushChain();
        const opId = `unknown:${node.id}`;
        plan.push({
          id: opId, label: node.bl_label || node.bl_idname,
          kind: 'INPUT_CONST', nodes: [node], bindings: [],
          outputs: node.outputs.map((s) => `${node.id}::${s.identifier}`),
        });
        for (const s of node.outputs) nodeToOp.set(node.id, { opId, outId: `${node.id}::${s.identifier}` });
        continue;
      }
      const kind = (node.constructor as typeof CompNode).comp_kind;
      if (kind === 'INPUT') {
        flushChain();
        const opId = `input:${node.id}`;
        const isImage = node instanceof CompositorNodeImage || node instanceof CompositorNodeRLayers;
        plan.push({
          id: opId, label: node.bl_label,
          kind: isImage ? 'INPUT_IMAGE' : 'INPUT_CONST',
          nodes: [node], bindings: [],
          outputs: node.outputs.map((s) => `${node.id}::${s.identifier}`),
        });
        for (const s of node.outputs) nodeToOp.set(node.id, { opId, outId: `${node.id}::${s.identifier}` });
      } else if (kind === 'OUTPUT') {
        flushChain();
        const opId = `output:${node.id}`;
        const bindings: PlannerOp['bindings'] = [];
        for (const s of node.inputs) {
          const sl = srcLink(s);
          const src = sl ? nodeToOp.get(sl.from_node.id) : undefined;
          bindings.push({
            localId: s.identifier,
            from: src ? { opId: src.opId, outId: src.outId } : null,
            defaultResult: defaultResultForSocket(s),
          });
        }
        plan.push({
          id: opId, label: node.bl_label,
          kind: 'OUTPUT', nodes: [node], bindings, outputs: [],
        });
      } else if (kind === 'PIXEL') {
        // Try to extend the current chain. A pixel-wise node can join the
        // current chain iff its primary image input is linked to any node
        // already in the chain (so the fused fragment can chain them in one
        // shader). If its image input comes from outside the chain, start a
        // new chain.
        const canExtend = currentChain.length > 0 && this.linksToChainMemberFlat(node, currentChain, srcMap);
        if (!canExtend) flushChain();
        currentChain.push(node);
        currentChainHead = { opId: '', outId: '' }; // sentinel — real id assigned at flushChain
      } else if (kind === 'KERNEL') {
        flushChain();
        const opId = `kernel:${node.id}`;
        const bindings: PlannerOp['bindings'] = [];
        for (const s of node.inputs) {
          const sl = srcLink(s);
          const src = sl ? nodeToOp.get(sl.from_node.id) : undefined;
          bindings.push({
            localId: s.identifier,
            from: src ? { opId: src.opId, outId: src.outId } : null,
            defaultResult: defaultResultForSocket(s),
          });
        }
        plan.push({
          id: opId, label: node.bl_label,
          kind: 'KERNEL', nodes: [node], bindings,
          outputs: node.outputs.map((s) => `${node.id}::${s.identifier}`),
        });
        for (const s of node.outputs) nodeToOp.set(node.id, { opId, outId: `${node.id}::${s.identifier}` });
      }
    }
    flushChain();
    void errors;
    return plan;
  }

  /** Does `node`'s primary image input link to any node already in the chain? */
  private linksToChainMemberFlat(node: Node, chain: Node[], srcMap: Map<NodeSocket, FlatLink>): boolean {
    const imgInput = node.inputs.find((s) => s.kind === 'RGBA' && srcMap.has(s));
    if (!imgInput) return false;
    const link = srcMap.get(imgInput);
    if (!link) return false;
    return chain.includes(link.from_node);
  }

  // ============================================================
  //  Execution
  // ============================================================

  private runOperation(
    op: PlannerOp,
    inputs: Map<string, Result>,
    keepAlive: (t: THREE.WebGLRenderTarget) => void,
  ): Map<string, Result> {
    const outs = new Map<string, Result>();
    switch (op.kind) {
      case 'INPUT_IMAGE':  return this.execInputImage(op, outs, keepAlive);
      case 'INPUT_CONST':  return this.execInputConst(op, outs);
      case 'PIXEL_FUSED':  return this.execPixelFused(op, inputs, outs, keepAlive);
      case 'KERNEL':       return this.execKernel(op, inputs, outs, keepAlive);
      case 'OUTPUT':       return outs;
    }
  }

  /** Builds (or returns cached) an image Result for an Image / Render Layers node. */
  private execInputImage(
    op: PlannerOp, outs: Map<string, Result>, keepAlive: (t: THREE.WebGLRenderTarget) => void,
  ): Map<string, Result> {
    const node = op.nodes[0]!;
    const key = node instanceof CompositorNodeImage ? (node.image_src || node.id) : node.id;
    const ext = this.resolveTexture?.(key) ?? null;
    const t = this.pool!.acquire(this.width, this.height);
    keepAlive(t);
    if (ext) {
      // Blit the external texture into our pooled target.
      const mat = this.cachedMaterial(`__blit_${ext.uuid}`, FULLSCREEN_VS, BLIT_FS, () => ({ tDiffuse: { value: ext } }));
      this.renderToTarget(mat, t);
    } else {
      // Default to a neutral grey image so the chain still produces something.
      this.clearTarget(t, new THREE.Color(0.1, 0.1, 0.1));
    }
    const imgId = `${node.id}::Image`;
    outs.set(imgId, { kind: 'IMAGE', target: t, width: this.width, height: this.height });
    // Companion outputs (Alpha, Depth) collapse to constants.
    if (node.outputs.find((s) => s.identifier === 'Alpha')) outs.set(`${node.id}::Alpha`, valueResult(1));
    if (node.outputs.find((s) => s.identifier === 'Depth')) outs.set(`${node.id}::Depth`, valueResult(0));
    return outs;
  }

  private execInputConst(op: PlannerOp, outs: Map<string, Result>): Map<string, Result> {
    const node = op.nodes[0]!;
    for (const s of node.outputs) {
      const r = defaultResultForSocket(s);
      outs.set(`${node.id}::${s.identifier}`, r);
    }
    return outs;
  }

  private execPixelFused(
    op: PlannerOp, inputs: Map<string, Result>, outs: Map<string, Result>,
    keepAlive: (t: THREE.WebGLRenderTarget) => void,
  ): Map<string, Result> {
    // Build the fused fragment shader.
    const { fragment, uniformSetters } = this.buildPixelFusedShader(op, inputs);
    const mat = this.cachedMaterial(`pixel:${fragment}`, FULLSCREEN_VS, fragment, () => {
      const u: Record<string, THREE.IUniform> = {};
      for (const [name, setter] of uniformSetters) {
        u[name] = { value: setter.makeInitial() };
      }
      return u;
    });
    // Refresh uniform values with this evaluation's inputs.
    for (const [name, setter] of uniformSetters) {
      mat.uniforms[name]!.value = setter.read();
    }
    const t = this.pool!.acquire(this.width, this.height);
    keepAlive(t);
    this.renderToTarget(mat, t);
    outs.set(op.outputs[0]!, { kind: 'IMAGE', target: t, width: this.width, height: this.height });
    return outs;
  }

  private execKernel(
    op: PlannerOp, inputs: Map<string, Result>, outs: Map<string, Result>,
    keepAlive: (t: THREE.WebGLRenderTarget) => void,
  ): Map<string, Result> {
    const node = op.nodes[0]!;
    const imgIn = inputs.get('Image') ?? defaultResultForSocket(node.inputs[0]!);
    const inTex = this.imageTextureOf(imgIn);
    const tOut = this.pool!.acquire(this.width, this.height);
    keepAlive(tOut);

    if (node instanceof CompositorNodeBlur) {
      const sizeMul = (inputs.get('Size') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Size') as { value: number }).value : 1;
      const radius = Math.max(0, node.size_x * sizeMul);
      const prog = BlurProgram(radius);
      const matH = this.cachedMaterial(`blur-h:${radius}`, prog.vertex, prog.fragment, prog.makeUniforms);
      matH.uniforms.tDiffuse!.value = inTex;
      matH.uniforms.u_direction!.value.set(1, 0);
      matH.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      matH.uniforms.u_radius!.value = radius;
      const tH = this.pool!.acquire(this.width, this.height); keepAlive(tH);
      this.renderToTarget(matH, tH);
      const matV = this.cachedMaterial(`blur-v:${radius}`, prog.vertex, prog.fragment, prog.makeUniforms);
      matV.uniforms.tDiffuse!.value = tH.texture;
      matV.uniforms.u_direction!.value.set(0, 1);
      matV.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      matV.uniforms.u_radius!.value = radius;
      this.renderToTarget(matV, tOut);
    } else if (node instanceof CompositorNodeGlare) {
      // 3 passes: threshold → blur (separable) → add
      const t1 = this.pool!.acquire(this.width, this.height); keepAlive(t1);
      const matT = this.cachedMaterial(`glare-th`, GlareThresholdProgram.vertex, GlareThresholdProgram.fragment, GlareThresholdProgram.makeUniforms);
      matT.uniforms.tDiffuse!.value = inTex;
      matT.uniforms.u_threshold!.value = node.threshold;
      this.renderToTarget(matT, t1);
      // blur t1
      const prog = BlurProgram(node.size);
      const matH = this.cachedMaterial(`blur-h:${node.size}`, prog.vertex, prog.fragment, prog.makeUniforms);
      matH.uniforms.tDiffuse!.value = t1.texture;
      matH.uniforms.u_direction!.value.set(1, 0);
      matH.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      matH.uniforms.u_radius!.value = node.size;
      const tH = this.pool!.acquire(this.width, this.height); keepAlive(tH);
      this.renderToTarget(matH, tH);
      const matV = this.cachedMaterial(`blur-v:${node.size}`, prog.vertex, prog.fragment, prog.makeUniforms);
      matV.uniforms.tDiffuse!.value = tH.texture;
      matV.uniforms.u_direction!.value.set(0, 1);
      matV.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      matV.uniforms.u_radius!.value = node.size;
      const tG = this.pool!.acquire(this.width, this.height); keepAlive(tG);
      this.renderToTarget(matV, tG);
      // Add base + glow.
      const matA = this.cachedMaterial(`glare-add`, GlareAddProgram.vertex, GlareAddProgram.fragment, GlareAddProgram.makeUniforms);
      matA.uniforms.tDiffuse!.value = inTex;
      matA.uniforms.tGlow!.value = tG.texture;
      matA.uniforms.u_mix!.value = node.mix;
      this.renderToTarget(matA, tOut);
    } else if (node instanceof CompositorNodeVignette) {
      const prog = VignetteProgram(node.radius, node.softness);
      const mat = this.cachedMaterial(`vig:${node.radius}:${node.softness}`, prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_radius!.value = node.radius;
      mat.uniforms.u_softness!.value = node.softness;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodePixelate) {
      const prog = PixelateProgram(node.pixel_size);
      const mat = this.cachedMaterial(`px:${node.pixel_size}`, prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      mat.uniforms.u_pixelSize!.value = node.pixel_size;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeTranslate) {
      const x = (inputs.get('X') as Result | undefined)?.kind === 'VALUE' ? (inputs.get('X') as { value: number }).value : 0;
      const y = (inputs.get('Y') as Result | undefined)?.kind === 'VALUE' ? (inputs.get('Y') as { value: number }).value : 0;
      const mat = this.cachedMaterial(`tr`, TranslateProgram.vertex, TranslateProgram.fragment, TranslateProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_offset!.value.set(x / this.width, y / this.height);
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeScale) {
      const x = (inputs.get('X') as Result | undefined)?.kind === 'VALUE' ? (inputs.get('X') as { value: number }).value : 1;
      const y = (inputs.get('Y') as Result | undefined)?.kind === 'VALUE' ? (inputs.get('Y') as { value: number }).value : 1;
      const mat = this.cachedMaterial(`sc`, ScaleProgram.vertex, ScaleProgram.fragment, ScaleProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_scale!.value.set(Math.max(x, 0.0001), Math.max(y, 0.0001));
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeRotate) {
      const deg = (inputs.get('Degr') as Result | undefined)?.kind === 'VALUE' ? (inputs.get('Degr') as { value: number }).value : 0;
      const mat = this.cachedMaterial(`rot`, RotateProgram.vertex, RotateProgram.fragment, RotateProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_angle!.value = (deg * Math.PI) / 180;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeFlip) {
      const mat = this.cachedMaterial(`flip:${node.axis}`, FlipProgram.vertex, FlipProgram.fragment, FlipProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_axis!.value.set(node.axis === 'Y' ? 0 : 1, node.axis === 'X' ? 0 : 1);
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeCrop) {
      const mat = this.cachedMaterial(`crop`, CropProgram.vertex, CropProgram.fragment, CropProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_crop!.value.set(node.min_x, node.min_y, node.max_x, node.max_y);
      this.renderToTarget(mat, tOut);
    } else {
      // unknown kernel — just blit
      const mat = this.cachedMaterial('__blit__', FULLSCREEN_VS, BLIT_FS, () => ({ tDiffuse: { value: null } }));
      mat.uniforms.tDiffuse!.value = inTex;
      this.renderToTarget(mat, tOut);
    }
    outs.set(`${node.id}::Image`, { kind: 'IMAGE', target: tOut, width: this.width, height: this.height });
    return outs;
  }

  // ============================================================
  //  Fused shader builder
  // ============================================================

  /**
   * Builds the fragment shader and uniform setters for a fused chain of
   * pixel-wise operations. Each chain node references its inputs via
   * `n.id::socketId`. Inputs that map to images become sampler2D uniforms;
   * scalar/colour inputs become float/vec4 uniforms.
   */
  private buildPixelFusedShader(
    op: PlannerOp, inputs: Map<string, Result>,
  ): { fragment: string; uniformSetters: Map<string, UniformSetter> } {
    const lines: string[] = [];
    const declarations: string[] = [];
    const uniformSetters = new Map<string, UniformSetter>();
    // Map from `${nodeId}::${socketId}` to the GLSL expression that yields its value.
    const exprByLocal = new Map<string, string>();

    // First pass: gather each external input, create a uniform for it.
    let uniformCounter = 0;
    const internalNodeIds = new Set(op.nodes.map((n) => n.id));
    for (const b of op.bindings) {
      const r = inputs.get(b.localId) ?? b.defaultResult;
      const idx = uniformCounter++;
      if (r.kind === 'IMAGE') {
        const uName = `u_tex_${idx}`;
        declarations.push(`uniform sampler2D ${uName};`);
        exprByLocal.set(b.localId, `texture2D(${uName}, vUv)`);
        uniformSetters.set(uName, makeSetter(() => imageTexOf(r)));
      } else if (r.kind === 'VALUE') {
        const uName = `u_val_${idx}`;
        declarations.push(`uniform float ${uName};`);
        exprByLocal.set(b.localId, `vec4(vec3(${uName}), 1.0)`);
        uniformSetters.set(uName, makeSetter(() => (r as { value: number }).value));
      } else if (r.kind === 'COLOR') {
        const uName = `u_col_${idx}`;
        declarations.push(`uniform vec4 ${uName};`);
        exprByLocal.set(b.localId, uName);
        uniformSetters.set(uName, makeSetter(() => new THREE.Vector4(...(r as { value: number[] }).value as [number, number, number, number])));
      } else {
        const uName = `u_vec_${idx}`;
        declarations.push(`uniform vec3 ${uName};`);
        exprByLocal.set(b.localId, `vec4(${uName}, 1.0)`);
        uniformSetters.set(uName, makeSetter(() => new THREE.Vector3(...(r as { value: number[] }).value as [number, number, number])));
      }
    }

    // Second pass: walk the chain, emit one `vec4 nXX = …;` per node.
    const tempByNode = new Map<string, string>();
    let tempCounter = 0;
    for (const n of op.nodes) {
      const emitter = PIXEL_EMITTERS[n.bl_idname];
      if (!emitter) continue;
      const env: PixelEnv = {
        input: (id: string) => {
          // Is this input linked to another node in the chain? If so,
          // emit a reference to its temp variable.
          const s = n.inputs.find((x) => x.identifier === id);
          const link = s ? this._srcMap.get(s) : undefined;
          if (s && link) {
            if (internalNodeIds.has(link.from_node.id)) {
              const t = tempByNode.get(link.from_node.id);
              if (t) return t;
            }
          }
          // Otherwise it's an external binding — use its uniform expression.
          return exprByLocal.get(`${n.id}::${id}`) ?? `vec4(0.0)`;
        },
        uniformFloat: (name, def) => { void name; void def; return '0.0'; }, // unused in M5
        unique: (prefix) => `${prefix}_${tempCounter++}`,
      };
      const expr = emitter(n, env);
      const tempName = `n_${tempCounter++}`;
      lines.push(`vec4 ${tempName} = ${expr};`);
      tempByNode.set(n.id, tempName);
    }

    const lastTemp = tempByNode.get(op.nodes[op.nodes.length - 1]!.id) ?? 'vec4(0.0)';
    const fragment = /* glsl */ `
precision mediump float;
varying vec2 vUv;
${declarations.join('\n')}
${GLSL_PRELUDE}
void main() {
  ${lines.join('\n  ')}
  gl_FragColor = ${lastTemp};
}`;
    return { fragment, uniformSetters };
  }

  // ============================================================
  //  Low-level renderer helpers
  // ============================================================

  private cachedMaterial(
    key: string,
    vertex: string,
    fragment: string,
    uniformsFactory: () => Record<string, THREE.IUniform>,
  ): THREE.ShaderMaterial {
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: uniformsFactory(),
      depthTest: false,
      depthWrite: false,
    });
    this.materialCache.set(key, m);
    return m;
  }

  private renderToTarget(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    const r = this.renderer!;
    this.fsQuad!.setMaterial(mat);
    const prev = r.getRenderTarget();
    r.setRenderTarget(target);
    this.fsQuad!.render(r);
    r.setRenderTarget(prev);
  }

  private clearTarget(target: THREE.WebGLRenderTarget, color: THREE.Color): void {
    const r = this.renderer!;
    const prev = r.getRenderTarget();
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(target);
    r.setClearColor(color, 1);
    r.clear(true, false, false);
    r.setClearColor(prevClear, prevAlpha);
    r.setRenderTarget(prev);
  }

  private imageTextureOf(r: Result): THREE.Texture | null {
    if (r.kind === 'IMAGE') return r.target.texture;
    return null;
  }

  /**
   * Copies `src` into a long-lived owned target (`final` or `viewer`) so
   * the consumer can hold a stable Texture reference between evaluations.
   */
  private captureToOwnedTarget(src: Result, slot: 'final' | 'viewer'): THREE.Texture | null {
    if (src.kind !== 'IMAGE') return null;
    let target = slot === 'final' ? this.finalTarget : this.viewerTarget;
    if (!target || target.width !== this.width || target.height !== this.height) {
      target?.dispose();
      target = new THREE.WebGLRenderTarget(this.width, this.height, {
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false,
      });
      if (slot === 'final') this.finalTarget = target; else this.viewerTarget = target;
    }
    const mat = this.cachedMaterial('__capture__', FULLSCREEN_VS, BLIT_FS, () => ({ tDiffuse: { value: null } }));
    mat.uniforms.tDiffuse!.value = src.target.texture;
    this.renderToTarget(mat, target);
    return target.texture;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** A tiny indirection that lets us refresh a uniform's value per eval. */
interface UniformSetter {
  makeInitial(): unknown;
  read(): unknown;
}
function makeSetter(read: () => unknown): UniformSetter {
  return { makeInitial: read, read };
}

function imageTexOf(r: Result): THREE.Texture | null {
  if (r.kind === 'IMAGE') return r.target.texture;
  return null;
}

function defaultResultForSocket(s: NodeSocket): Result {
  switch (s.kind) {
    case 'RGBA': {
      const v = s.default_value as number[] | undefined;
      return colorResult([v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0, v?.[3] ?? 1]);
    }
    case 'VALUE':
    case 'INT':
    case 'BOOLEAN': {
      const v = s.default_value;
      return valueResult(typeof v === 'number' ? v : v ? 1 : 0);
    }
    case 'VECTOR': {
      const v = s.default_value as number[] | undefined;
      return { kind: 'VECTOR', value: [v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0] };
    }
    default:
      return colorResult([0, 0, 0, 1]);
  }
}

/** Pass-through blit shader. */
const BLIT_FS = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`;

/** Re-exported for the demo / external consumers. */
export type { EvaluatedComposite } from './types';

// Suppress unused warning when nothing in this module references the type.
void (BLIT_FS);
