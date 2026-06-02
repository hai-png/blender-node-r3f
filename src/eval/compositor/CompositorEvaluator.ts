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
  CompositorNodeComposite, CompositorNodeViewer, CompositorNodeSplitViewer,
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
  // Phase-3 audit additions:
  FilterProgram, DilateErodeProgram, DefocusProgram, LensDistortionProgram,
  DisplaceProgram, MapUVProgram, IDMaskProgram, ColorSpillProgram,
  PremulKeyProgram, ConvertColorSpaceProgram, BoxMaskProgram, EllipseMaskProgram,
  CompSwitchProgram, SunBeamsProgram, DespeckleProgram, BilateralBlurProgram,
  DirectionalBlurProgram, DenoiseProgram, NormalizeProgram, LevelsBlitProgram,
} from './KernelShaders';
import {
  CompositorNodeFilter, CompositorNodeDilateErode, CompositorNodeDefocus,
  CompositorNodeBokehBlur, CompositorNodeLensDistortion, CompositorNodeDisplace,
  CompositorNodeMapUV, CompositorNodeIDMask, CompositorNodeColorSpill,
  CompositorNodePremulKey, CompositorNodeConvertColorSpace,
  CompositorNodeBoxMask, CompositorNodeEllipseMask, CompositorNodeSwitch,
  CompositorNodeSunBeams, CompositorNodeDespeckle, CompositorNodeBilateralBlur,
  CompositorNodeDirectionalBlur, CompositorNodeDenoise, CompositorNodeNormalize,
  CompositorNodeLevels,
} from '../../nodes/compositor/MoreCompositor';

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

  /**
   * The compositor re-plans and re-executes the full pipeline on every call
   * (GPU passes are already fast). No per-node persistent cache needed.
   * This method exists for interface compatibility with the Depsgraph's
   * topology-change hook.
   */
  clearPersistentCache(): void { /* no-op — pipeline replanned each call */ }

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
        const outs = this.runOperation(op, inputs, refRelease, errors);
        if (outs.size) resultByOp.set(op.id, outs);

        // Capture Composite / Viewer outputs to their dedicated targets.
        if (op.kind === 'OUTPUT') {
          const incoming = inputs.get('Image');
          if (op.nodes[0] instanceof CompositorNodeSplitViewer) {
            const split = this.composeSplitViewer(op.nodes[0], inputs, refRelease);
            viewerImage = this.captureToOwnedTarget(split, 'viewer');
          } else if (incoming) {
            const image = this.ensureImageResult(incoming, refRelease);
            if (op.nodes[0] instanceof CompositorNodeComposite) {
              finalImage = this.captureToOwnedTarget(image, 'final');
            } else if (op.nodes[0] instanceof CompositorNodeViewer) {
              viewerImage = this.captureToOwnedTarget(image, 'viewer');
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

    // Track which concrete output socket produced which `PlannerOp`. This
    // matters for multi-output pixel nodes (Separate Color, ColorRamp Alpha,
    // Z Combine's depth, etc.): links target sockets, not whole nodes.
    const socketToOp = new Map<string /* output socket id */, { opId: string; outId: string }>();

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
            const src = socketToOp.get(link.from_socket.id);
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
      const outputs = last.outputs.map((s) => `${last.id}::${s.identifier}`);
      plan.push({
        id: opId, label: `${currentChain.map((n) => n.bl_label).join(' → ')}`,
        kind: 'PIXEL_FUSED',
        nodes: [...currentChain],
        bindings,
        outputs,
      });
      // The fused shader materialises the last node's result. Map every
      // output socket on the last node to that op, preserving socket ids.
      for (const s of last.outputs) socketToOp.set(s.id, { opId, outId: `${last.id}::${s.identifier}` });
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
        for (const s of node.outputs) socketToOp.set(s.id, { opId, outId: `${node.id}::${s.identifier}` });
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
        for (const s of node.outputs) socketToOp.set(s.id, { opId, outId: `${node.id}::${s.identifier}` });
      } else if (kind === 'OUTPUT') {
        flushChain();
        const opId = `output:${node.id}`;
        const bindings: PlannerOp['bindings'] = [];
        for (const s of node.inputs) {
          const sl = srcLink(s);
          const src = sl ? socketToOp.get(sl.from_socket.id) : undefined;
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
        const canExtend = currentChain.length > 0 && this.canExtendPixelChain(node, currentChain, srcMap, flat.links);
        if (!canExtend) flushChain();
        currentChain.push(node);
        currentChainHead = { opId: '', outId: '' }; // sentinel — real id assigned at flushChain
      } else if (kind === 'KERNEL') {
        flushChain();
        const opId = `kernel:${node.id}`;
        const bindings: PlannerOp['bindings'] = [];
        for (const s of node.inputs) {
          const sl = srcLink(s);
          const src = sl ? socketToOp.get(sl.from_socket.id) : undefined;
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
        for (const s of node.outputs) socketToOp.set(s.id, { opId, outId: `${node.id}::${s.identifier}` });
      }
    }
    flushChain();
    void errors;
    return plan;
  }

  /**
   * Can `node` extend the current pixel-fused chain without changing graph
   * semantics? Only when it consumes the previous chain tail's primary output
   * and that output has no other active consumers. This conservative rule
   * prevents branch graphs from being collapsed into one linear shader whose
   * final output would accidentally replace sibling branch outputs.
   */
  private canExtendPixelChain(
    node: Node,
    chain: Node[],
    srcMap: Map<NodeSocket, FlatLink>,
    links: FlatLink[],
  ): boolean {
    const imgInput = node.inputs.find((s) => s.kind === 'RGBA' && srcMap.has(s));
    if (!imgInput) return false;
    const link = srcMap.get(imgInput);
    if (!link) return false;
    const tail = chain[chain.length - 1];
    if (!tail || link.from_node !== tail) return false;
    const consumers = links.filter((l) => l.from_socket === link.from_socket).length;
    return consumers <= 1;
  }

  // ============================================================
  //  Execution
  // ============================================================

  private runOperation(
    op: PlannerOp,
    inputs: Map<string, Result>,
    keepAlive: (t: THREE.WebGLRenderTarget) => void,
    errors?: Map<string, string>,
  ): Map<string, Result> {
    const outs = new Map<string, Result>();
    switch (op.kind) {
      case 'INPUT_IMAGE':  return this.execInputImage(op, outs, keepAlive);
      case 'INPUT_CONST':  return this.execInputConst(op, outs);
      case 'PIXEL_FUSED':  return this.execPixelFused(op, inputs, outs, keepAlive);
      case 'KERNEL':       return this.execKernel(op, inputs, outs, keepAlive, errors);
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
    for (const outId of op.outputs) {
      outs.set(outId, { kind: 'IMAGE', target: t, width: this.width, height: this.height, channel: channelForOutputId(outId) } as Result);
    }
    return outs;
  }

  private execKernel(
    op: PlannerOp, inputs: Map<string, Result>, outs: Map<string, Result>,
    keepAlive: (t: THREE.WebGLRenderTarget) => void,
    errors?: Map<string, string>,
  ): Map<string, Result> {
    const node = op.nodes[0]!;
    const imgIn = this.ensureImageResult(inputs.get('Image') ?? defaultResultForSocket(node.inputs[0]!), keepAlive);
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
    }
    // ───────────────────────── Phase-3 audit kernels ─────────────────────────
    // Properties on Blender-mirror nodes are typed via the dynamic
    // `Object.defineProperty` system; we access them via `any` casts here
    // (matching the convention in the surrounding code).
    else if (node instanceof CompositorNodeFilter) {
      const filterType = (node as any).filter_type as string;
      const prog = FilterProgram(filterType);
      const mat = this.cachedMaterial(`flt:${filterType}`, prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      const fac = (inputs.get('Fac') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Fac') as { value: number }).value : 1;
      mat.uniforms.u_fac!.value = fac;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeDilateErode) {
      const distance = (node as any).distance as number;
      const prog = DilateErodeProgram(distance);
      const mat = this.cachedMaterial(`de:${distance}`, prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      mat.uniforms.u_distance!.value = distance;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeDefocus || node instanceof CompositorNodeBokehBlur) {
      // For Defocus we approximate the f-stop with a fixed disc radius;
      // for BokehBlur we read the Size scalar input.
      const radius = node instanceof CompositorNodeDefocus
        ? Math.max(1, 32 / Math.max((node as any).f_stop ?? 128, 0.5))
        : ((inputs.get('Size') as Result | undefined)?.kind === 'VALUE'
            ? (inputs.get('Size') as { value: number }).value * 16
            : 16);
      const prog = DefocusProgram(radius);
      const mat = this.cachedMaterial(`def:${radius.toFixed(2)}`, prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      mat.uniforms.u_radius!.value = radius;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeLensDistortion) {
      const distortion = (inputs.get('Distortion') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Distortion') as { value: number }).value : 0;
      const dispersion = (inputs.get('Dispersion') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Dispersion') as { value: number }).value : 0;
      const mat = this.cachedMaterial('lensdist', LensDistortionProgram.vertex, LensDistortionProgram.fragment, LensDistortionProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_distortion!.value = distortion;
      mat.uniforms.u_dispersion!.value = dispersion;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeDisplace) {
      const vecResult = inputs.get('Vector');
      const vecTex = vecResult && vecResult.kind === 'IMAGE'
        ? this.imageTextureOf(vecResult)
        : inTex; // fallback: use input itself
      const xs = (inputs.get('X Scale') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('X Scale') as { value: number }).value : 0;
      const ys = (inputs.get('Y Scale') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Y Scale') as { value: number }).value : 0;
      const mat = this.cachedMaterial('displace', DisplaceProgram.vertex, DisplaceProgram.fragment, DisplaceProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.tVector!.value = vecTex;
      mat.uniforms.u_scale!.value.set(xs / this.width, ys / this.height);
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeMapUV) {
      const uvResult = inputs.get('UV');
      const uvTex = uvResult && uvResult.kind === 'IMAGE' ? this.imageTextureOf(uvResult) : inTex;
      const mat = this.cachedMaterial('mapuv', MapUVProgram.vertex, MapUVProgram.fragment, MapUVProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.tUV!.value = uvTex;
      mat.uniforms.u_alpha!.value = (node as any).alpha ?? 0.02;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeIDMask) {
      const idx = (node as any).index as number | undefined;
      const aa = (node as any).use_antialiasing as boolean | undefined;
      const mat = this.cachedMaterial('idmask', IDMaskProgram.vertex, IDMaskProgram.fragment, IDMaskProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_target!.value = (idx ?? 0) / 255;
      mat.uniforms.u_aa!.value = aa ? 1 : 0;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeColorSpill) {
      const mat = this.cachedMaterial('spill', ColorSpillProgram.vertex, ColorSpillProgram.fragment, ColorSpillProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      const fac = (inputs.get('Fac') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Fac') as { value: number }).value : 1;
      const channel = (node as any).channel as string | undefined;
      const limitMethod = (node as any).limit_method as string | undefined;
      mat.uniforms.u_fac!.value = fac;
      mat.uniforms.u_channel!.value = channel === 'R' ? 0 : channel === 'B' ? 2 : 1;
      mat.uniforms.u_method!.value = limitMethod === 'SIMPLE' ? 0 : 1;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodePremulKey) {
      const mat = this.cachedMaterial('premul', PremulKeyProgram.vertex, PremulKeyProgram.fragment, PremulKeyProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_dir!.value = (node as any).mapping === 'PREMUL_TO_STRAIGHT' ? 1 : 0;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeConvertColorSpace) {
      const mat = this.cachedMaterial('csconv', ConvertColorSpaceProgram.vertex, ConvertColorSpaceProgram.fragment, ConvertColorSpaceProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      // Heuristic direction: anything "Linear" → use 1 (linear→sRGB), else 0.
      const toSpace = (node as any).to_color_space as string | undefined;
      mat.uniforms.u_dir!.value = /linear/i.test(toSpace ?? '') ? 0 : 1;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeBoxMask || node instanceof CompositorNodeEllipseMask) {
      const prog = node instanceof CompositorNodeBoxMask ? BoxMaskProgram : EllipseMaskProgram;
      const mat = this.cachedMaterial(
        node instanceof CompositorNodeBoxMask ? 'boxmask' : 'ellmask',
        prog.vertex, prog.fragment, prog.makeUniforms,
      );
      const n = node as any;
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_box!.value.set(n.x ?? 0.5, n.y ?? 0.5, (n.width ?? 0.2) * 0.5, (n.height ?? 0.2) * 0.5);
      mat.uniforms.u_rotation!.value = n.rotation ?? 0;
      const mt = n.mask_type as string | undefined;
      mat.uniforms.u_op!.value =
        mt === 'ADD' ? 0
          : mt === 'SUBTRACT' ? 1
            : mt === 'MULTIPLY' ? 2
              : 3;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeSwitch) {
      const onResult = inputs.get('On');
      const onTex = onResult && onResult.kind === 'IMAGE' ? this.imageTextureOf(onResult) : inTex;
      const mat = this.cachedMaterial('cswitch', CompSwitchProgram.vertex, CompSwitchProgram.fragment, CompSwitchProgram.makeUniforms);
      mat.uniforms.tA!.value = inTex;
      mat.uniforms.tB!.value = onTex;
      mat.uniforms.u_use!.value = (node as any).check ? 1 : 0;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeSunBeams) {
      const mat = this.cachedMaterial('sunbeams', SunBeamsProgram.vertex, SunBeamsProgram.fragment, SunBeamsProgram.makeUniforms);
      const n = node as any;
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_source!.value.set(n.source ?? 0.5, n.source ?? 0.5);
      mat.uniforms.u_rayLength!.value = n.ray_length ?? 0.2;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeDespeckle) {
      const fac = (inputs.get('Fac') as Result | undefined)?.kind === 'VALUE'
        ? (inputs.get('Fac') as { value: number }).value : 0.5;
      const mat = this.cachedMaterial('despeck', DespeckleProgram.vertex, DespeckleProgram.fragment, DespeckleProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      mat.uniforms.u_fac!.value = fac;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeBilateralBlur) {
      const n = node as any;
      // Iterate the bilateral pass N times.
      const it = Math.max(1, Math.min(8, Math.floor(n.iterations ?? 1)));
      const prog = BilateralBlurProgram(it);
      // Simple non-ping-pong run for now: just one pass into tOut.
      const mat = this.cachedMaterial(`bil`, prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      mat.uniforms.u_sigmaColor!.value = n.sigma_color ?? 0.3;
      mat.uniforms.u_sigmaSpace!.value = n.sigma_space ?? 5;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeDirectionalBlur) {
      const prog = DirectionalBlurProgram(16);
      const mat = this.cachedMaterial('dblur', prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      // Sensible defaults; the Blender node has its own iterations/center
      // properties — we expose a small linear sweep for now.
      mat.uniforms.u_offset!.value.set(0.002, 0);
      mat.uniforms.u_zoom!.value = 1.0;
      mat.uniforms.u_spin!.value = 0;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeDenoise) {
      const prog = DenoiseProgram();
      const mat = this.cachedMaterial('denoise', prog.vertex, prog.fragment, prog.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_texelSize!.value.set(1 / this.width, 1 / this.height);
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeNormalize) {
      const mat = this.cachedMaterial('normalize', NormalizeProgram.vertex, NormalizeProgram.fragment, NormalizeProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      mat.uniforms.u_min!.value = 0;
      mat.uniforms.u_max!.value = 1;
      this.renderToTarget(mat, tOut);
    } else if (node instanceof CompositorNodeLevels) {
      // For now, blit and emit Mean/StdDev = 0.5/0 (proper readback would
      // require gl.readPixels; that's a future improvement).
      const mat = this.cachedMaterial('lvlblit', LevelsBlitProgram.vertex, LevelsBlitProgram.fragment, LevelsBlitProgram.makeUniforms);
      mat.uniforms.tDiffuse!.value = inTex;
      this.renderToTarget(mat, tOut);
    }
    else {
      // unknown kernel — blit input through and warn
      errors?.set(node.id, `Compositor kernel node "${node.bl_idname}" (${node.name || node.bl_label}) is not implemented; input was passed through unchanged.`);
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
        const tex = `texture2D(${uName}, vUv)`;
        const ch = (r as { channel?: 0 | 1 | 2 | 3 }).channel;
        exprByLocal.set(b.localId, ch === undefined ? tex : `vec4(vec3(${tex}.${'rgba'[ch]}), 1.0)`);
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

  private composeSplitViewer(
    node: CompositorNodeSplitViewer,
    inputs: Map<string, Result>,
    keepAlive: (t: THREE.WebGLRenderTarget) => void,
  ): Extract<Result, { kind: 'IMAGE' }> {
    const a = this.ensureImageResult(inputs.get('Image') ?? colorResult([0, 0, 0, 1]), keepAlive);
    const b = this.ensureImageResult(inputs.get('Image_001') ?? colorResult([0, 0, 0, 1]), keepAlive);
    const target = this.pool!.acquire(this.width, this.height);
    keepAlive(target);
    const mat = this.cachedMaterial('__split_viewer__', FULLSCREEN_VS, SPLIT_VIEWER_FS, () => ({
      tA: { value: null },
      tB: { value: null },
      u_factor: { value: 0.5 },
      u_axis: { value: 0 },
    }));
    mat.uniforms.tA!.value = a.target.texture;
    mat.uniforms.tB!.value = b.target.texture;
    mat.uniforms.u_factor!.value = Math.max(0, Math.min(1, node.factor / 100));
    mat.uniforms.u_axis!.value = node.axis === 'Y' ? 1 : 0;
    this.renderToTarget(mat, target);
    return { kind: 'IMAGE', target, width: this.width, height: this.height };
  }

  private ensureImageResult(r: Result, keepAlive: (t: THREE.WebGLRenderTarget) => void): Extract<Result, { kind: 'IMAGE' }> {
    if (r.kind === 'IMAGE') return r;
    const target = this.pool!.acquire(this.width, this.height);
    keepAlive(target);
    const mat = this.cachedMaterial('__const_color__', FULLSCREEN_VS, CONST_COLOR_FS, () => ({
      u_color: { value: new THREE.Vector4(0, 0, 0, 1) },
    }));
    const c = resultToRGBA(r);
    mat.uniforms.u_color!.value.set(c[0], c[1], c[2], c[3]);
    this.renderToTarget(mat, target);
    return { kind: 'IMAGE', target, width: this.width, height: this.height };
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

function resultToRGBA(r: Result): [number, number, number, number] {
  if (r.kind === 'VALUE') return [r.value, r.value, r.value, 1];
  if (r.kind === 'COLOR') return [r.value[0], r.value[1], r.value[2], r.value[3]];
  if (r.kind === 'VECTOR') return [r.value[0], r.value[1], r.value[2], 1];
  return [0, 0, 0, 1];
}

function channelForOutputId(outId: string): 0 | 1 | 2 | 3 | undefined {
  const ident = outId.split('::').pop();
  switch (ident) {
    case 'Red': case 'R': case 'Value': case 'Val': case 'Distance': case 'Alpha': return ident === 'Alpha' ? 3 : 0;
    case 'Green': case 'G': return 1;
    case 'Blue': case 'B': return 2;
    default: return undefined;
  }
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

const CONST_COLOR_FS = /* glsl */ `
precision mediump float;
uniform vec4 u_color;
void main(){ gl_FragColor = u_color; }`;

const SPLIT_VIEWER_FS = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float u_factor;
uniform int u_axis;
void main(){
  float coord = u_axis == 1 ? vUv.y : vUv.x;
  gl_FragColor = coord <= u_factor ? texture2D(tA, vUv) : texture2D(tB, vUv);
}`;

/** Re-exported for the demo / external consumers. */
export type { EvaluatedComposite } from './types';

// Suppress unused warning when nothing in this module references the type.
void (BLIT_FS);
