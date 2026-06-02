/**
 * MoreCompositor.ts — additional Compositor nodes registered for parity.
 *
 * These are declared as recognized Blender bl_idnames so .blend imports
 * map to real classes. Most are passed through (identity) by the
 * compositor evaluator's unknown-kernel branch unless and until a kernel
 * implementation is wired up; the CRITICAL_ANALYSIS documents which.
 */
import { type NodeInitContext } from '../../core/Node';
import { EnumProperty, FloatProperty, StringProperty, BoolProperty } from '../../core/Properties';
import {
  NodeSocketBool, NodeSocketColor, NodeSocketFloat, NodeSocketImage,
  NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';
// Extend the SHARED CompNode from Compositor.ts so the planner's
// `instanceof CompNode` check recognises these nodes (otherwise they'd be
// treated as foreign and emit a constant-black input).
import { CompNode } from './Compositor';

// ── Filters / Blurs ───────────────────────────────────────────────────

export class CompositorNodeDefocus extends CompNode {
  static override bl_idname = 'CompositorNodeDefocus';
  static override bl_label = 'Defocus';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter / Blur';
  static override properties = {
    bokeh: EnumProperty({
      items: [
        ['OCTAGON', 'Octagonal', ''], ['HEPTAGON', 'Heptagonal', ''],
        ['HEXAGON', 'Hexagonal', ''], ['PENTAGON', 'Pentagonal', ''],
        ['SQUARE', 'Square', ''], ['TRIANGLE', 'Triangular', ''],
        ['CIRCLE', 'Circular', ''],
      ],
      default: 'CIRCLE', name: 'Bokeh Type',
    }),
    angle: FloatProperty({ default: 0, name: 'Rotation' }),
    f_stop: FloatProperty({ default: 128, name: 'F-stop' }),
    blur_max: FloatProperty({ default: 16, name: 'Max Blur' }),
    threshold: FloatProperty({ default: 1, name: 'Threshold' }),
    use_gamma_correction: BoolProperty({ default: false, name: 'Gamma Correction' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketFloat, 'Z');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeBokehBlur extends CompNode {
  static override bl_idname = 'CompositorNodeBokehBlur';
  static override bl_label = 'Bokeh Blur';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter / Blur';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketColor, 'Bokeh');
    this.addInput(NodeSocketFloat, 'Size', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Bounding box', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeBokehImage extends CompNode {
  static override bl_idname = 'CompositorNodeBokehImage';
  static override bl_label = 'Bokeh Image';
  static override comp_kind = 'KERNEL';
  static override category = 'Input';
  static override properties = {
    flaps: FloatProperty({ default: 5, name: 'Flaps' }),
    angle: FloatProperty({ default: 0, name: 'Angle' }),
    rounding: FloatProperty({ default: 0, name: 'Rounding' }),
    catadioptric: FloatProperty({ default: 0, name: 'Catadioptric' }),
    shift: FloatProperty({ default: 0, name: 'Lens shift' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeBilateralBlur extends CompNode {
  static override bl_idname = 'CompositorNodeBilateralblur';
  static override bl_label = 'Bilateral Blur';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter / Blur';
  static override properties = {
    iterations: FloatProperty({ default: 1, name: 'Iterations' }),
    sigma_color: FloatProperty({ default: 0.3, name: 'Color Sigma' }),
    sigma_space: FloatProperty({ default: 5, name: 'Space Sigma' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketColor, 'Determinator');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeDirectionalBlur extends CompNode {
  static override bl_idname = 'CompositorNodeDBlur';
  static override bl_label = 'Directional Blur';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter / Blur';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeDenoise extends CompNode {
  static override bl_idname = 'CompositorNodeDenoise';
  static override bl_label = 'Denoise';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter';
  static override properties = {
    use_hdr: BoolProperty({ default: true, name: 'HDR' }),
    prefilter: EnumProperty({
      items: [['NONE', 'None', ''], ['FAST', 'Fast', ''], ['ACCURATE', 'Accurate', '']],
      default: 'ACCURATE', name: 'Prefilter',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketColor, 'Normal');
    this.addInput(NodeSocketColor, 'Albedo');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeFilter extends CompNode {
  static override bl_idname = 'CompositorNodeFilter';
  static override bl_label = 'Filter';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter';
  static override properties = {
    filter_type: EnumProperty({
      items: [
        ['SOFTEN', 'Soften', ''], ['SHARPEN', 'Sharpen', ''], ['LAPLACE', 'Laplace', ''],
        ['SOBEL', 'Sobel', ''], ['PREWITT', 'Prewitt', ''], ['KIRSCH', 'Kirsch', ''],
        ['SHADOW', 'Shadow', ''],
      ],
      default: 'SOFTEN', name: 'Filter Type',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeDilateErode extends CompNode {
  static override bl_idname = 'CompositorNodeDilateErode';
  static override bl_label = 'Dilate/Erode';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter';
  static override properties = {
    mode: EnumProperty({
      items: [['STEP', 'Step', ''], ['THRESHOLD', 'Threshold', ''], ['DISTANCE', 'Distance', ''], ['FEATHER', 'Feather', '']],
      default: 'STEP', name: 'Mode',
    }),
    distance: FloatProperty({ default: 1, name: 'Distance' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Mask');
    this.addOutput(NodeSocketFloat, 'Mask');
  }
}

export class CompositorNodeInpaint extends CompNode {
  static override bl_idname = 'CompositorNodeInpaint';
  static override bl_label = 'Inpaint';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter';
  static override properties = { distance: FloatProperty({ default: 0, name: 'Distance' }) };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeDespeckle extends CompNode {
  static override bl_idname = 'CompositorNodeDespeckle';
  static override bl_label = 'Despeckle';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Fac', { default_value: 0.5 });
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeSunBeams extends CompNode {
  static override bl_idname = 'CompositorNodeSunBeams';
  static override bl_label = 'Sun Beams';
  static override comp_kind = 'KERNEL';
  static override category = 'Filter';
  static override properties = {
    source: FloatProperty({ default: 0.5, name: 'Source' }),
    ray_length: FloatProperty({ default: 0.2, name: 'Ray Length' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

// ── Distortion ───────────────────────────────────────────────────────

export class CompositorNodeLensDistortion extends CompNode {
  static override bl_idname = 'CompositorNodeLensdist';
  static override bl_label = 'Lens Distortion';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  static override properties = {
    use_projector: BoolProperty({ default: false, name: 'Projector' }),
    use_jitter: BoolProperty({ default: false, name: 'Jitter' }),
    use_fit: BoolProperty({ default: false, name: 'Fit' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketFloat, 'Distortion', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Dispersion', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeMovieDistortion extends CompNode {
  static override bl_idname = 'CompositorNodeMovieDistortion';
  static override bl_label = 'Movie Distortion';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeMapUV extends CompNode {
  static override bl_idname = 'CompositorNodeMapUV';
  static override bl_label = 'Map UV';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  static override properties = { alpha: FloatProperty({ default: 0, name: 'Alpha' }) };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketVector, 'UV');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeDisplace extends CompNode {
  static override bl_idname = 'CompositorNodeDisplace';
  static override bl_label = 'Displace';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketVector, 'Vector');
    this.addInput(NodeSocketFloat, 'X Scale', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Y Scale', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeStabilize2D extends CompNode {
  static override bl_idname = 'CompositorNodeStabilize';
  static override bl_label = 'Stabilize 2D';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeCornerPin extends CompNode {
  static override bl_idname = 'CompositorNodeCornerPin';
  static override bl_label = 'Corner Pin';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketVector, 'Upper Left', { default_value: [0, 1, 0] });
    this.addInput(NodeSocketVector, 'Upper Right', { default_value: [1, 1, 0] });
    this.addInput(NodeSocketVector, 'Lower Left', { default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Lower Right', { default_value: [1, 0, 0] });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Plane');
  }
}

export class CompositorNodePlaneTrackDeform extends CompNode {
  static override bl_idname = 'CompositorNodePlaneTrackDeform';
  static override bl_label = 'Plane Track Deform';
  static override comp_kind = 'KERNEL';
  static override category = 'Distort';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Plane');
  }
}

// ── Mattes & Keying ──────────────────────────────────────────────────

export class CompositorNodeKeying extends CompNode {
  static override bl_idname = 'CompositorNodeKeying';
  static override bl_label = 'Keying';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketColor, 'Key Color');
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Matte');
    this.addOutput(NodeSocketFloat, 'Edges');
  }
}

export class CompositorNodeKeyingScreen extends CompNode {
  static override bl_idname = 'CompositorNodeKeyingScreen';
  static override bl_label = 'Keying Screen';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Screen');
  }
}

export class CompositorNodeColorSpill extends CompNode {
  static override bl_idname = 'CompositorNodeColorSpill';
  static override bl_label = 'Color Spill';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  static override properties = {
    channel: EnumProperty({
      items: [['R', 'R', ''], ['G', 'G', ''], ['B', 'B', '']],
      default: 'G', name: 'Despill Channel',
    }),
    limit_method: EnumProperty({
      items: [['SIMPLE', 'Simple', ''], ['AVERAGE', 'Average', '']],
      default: 'AVERAGE', name: 'Limit Method',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addInput(NodeSocketFloat, 'Fac', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeDoubleEdgeMask extends CompNode {
  static override bl_idname = 'CompositorNodeDoubleEdgeMask';
  static override bl_label = 'Double Edge Mask';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Inner Mask');
    this.addInput(NodeSocketFloat, 'Outer Mask');
    this.addOutput(NodeSocketFloat, 'Mask');
  }
}

export class CompositorNodeIDMask extends CompNode {
  static override bl_idname = 'CompositorNodeIDMask';
  static override bl_label = 'ID Mask';
  static override comp_kind = 'KERNEL';
  static override category = 'Converter';
  static override properties = {
    index: FloatProperty({ default: 0, name: 'Index' }),
    use_antialiasing: BoolProperty({ default: false, name: 'Anti-Aliasing' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'ID value');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class CompositorNodeCryptomatte extends CompNode {
  static override bl_idname = 'CompositorNodeCryptomatteV2';
  static override bl_label = 'Cryptomatte';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Matte');
    this.addOutput(NodeSocketColor, 'Pick');
  }
}

// ── Masks (shape) ────────────────────────────────────────────────────

export class CompositorNodeBoxMask extends CompNode {
  static override bl_idname = 'CompositorNodeBoxMask';
  static override bl_label = 'Box Mask';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  static override properties = {
    mask_type: EnumProperty({
      items: [['ADD', 'Add', ''], ['SUBTRACT', 'Subtract', ''], ['MULTIPLY', 'Multiply', ''], ['NOT', 'Not', '']],
      default: 'ADD', name: 'Operation',
    }),
    x: FloatProperty({ default: 0.5, name: 'X' }),
    y: FloatProperty({ default: 0.5, name: 'Y' }),
    width: FloatProperty({ default: 0.3, name: 'Width' }),
    height: FloatProperty({ default: 0.2, name: 'Height' }),
    rotation: FloatProperty({ default: 0, name: 'Rotation' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Mask');
    this.addInput(NodeSocketFloat, 'Value');
    this.addOutput(NodeSocketFloat, 'Mask');
  }
}

export class CompositorNodeEllipseMask extends CompNode {
  static override bl_idname = 'CompositorNodeEllipseMask';
  static override bl_label = 'Ellipse Mask';
  static override comp_kind = 'KERNEL';
  static override category = 'Matte';
  static override properties = {
    mask_type: EnumProperty({
      items: [['ADD', 'Add', ''], ['SUBTRACT', 'Subtract', ''], ['MULTIPLY', 'Multiply', ''], ['NOT', 'Not', '']],
      default: 'ADD', name: 'Operation',
    }),
    x: FloatProperty({ default: 0.5, name: 'X' }),
    y: FloatProperty({ default: 0.5, name: 'Y' }),
    width: FloatProperty({ default: 0.2, name: 'Width' }),
    height: FloatProperty({ default: 0.2, name: 'Height' }),
    rotation: FloatProperty({ default: 0, name: 'Rotation' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Mask');
    this.addInput(NodeSocketFloat, 'Value');
    this.addOutput(NodeSocketFloat, 'Mask');
  }
}

// ── Color management ─────────────────────────────────────────────────

export class CompositorNodeLevels extends CompNode {
  static override bl_idname = 'CompositorNodeLevels';
  static override bl_label = 'Levels';
  static override comp_kind = 'KERNEL';
  static override category = 'Color';
  static override properties = {
    channel: EnumProperty({
      items: [
        ['COMBINED_RGB', 'C', ''], ['RED', 'R', ''], ['GREEN', 'G', ''],
        ['BLUE', 'B', ''], ['LUMINANCE', 'L', ''],
      ],
      default: 'COMBINED_RGB', name: 'Channel',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Mean');
    this.addOutput(NodeSocketFloat, 'Std Dev');
  }
}

export class CompositorNodeNormal extends CompNode {
  static override bl_idname = 'CompositorNodeNormal';
  static override bl_label = 'Normal';
  static override comp_kind = 'KERNEL';
  static override category = 'Vector';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketVector, 'Normal');
    this.addOutput(NodeSocketFloat, 'Dot');
  }
}

export class CompositorNodeNormalize extends CompNode {
  static override bl_idname = 'CompositorNodeNormalize';
  static override bl_label = 'Normalize';
  static override comp_kind = 'KERNEL';
  static override category = 'Vector';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value');
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

export class CompositorNodeSwitch extends CompNode {
  static override bl_idname = 'CompositorNodeSwitch';
  static override bl_label = 'Switch';
  static override comp_kind = 'KERNEL';
  static override category = 'Layout';
  static override properties = { check: BoolProperty({ default: false, name: 'Switch' }) };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Off');
    this.addInput(NodeSocketColor, 'On');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeSwitchView extends CompNode {
  static override bl_idname = 'CompositorNodeSwitchView';
  static override bl_label = 'Switch View';
  static override comp_kind = 'KERNEL';
  static override category = 'Layout';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Left');
    this.addInput(NodeSocketColor, 'Right');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

// ── File output ──────────────────────────────────────────────────────

export class CompositorNodeOutputFile extends CompNode {
  static override bl_idname = 'CompositorNodeOutputFile';
  static override bl_label = 'File Output';
  static override comp_kind = 'KERNEL';
  static override category = 'Output';
  static override properties = {
    base_path: StringProperty({ default: '', name: 'Base Path', subtype: 'DIR_PATH' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
  }
}

// ── Convert nodes ────────────────────────────────────────────────────

export class CompositorNodePremulKey extends CompNode {
  static override bl_idname = 'CompositorNodePremulKey';
  static override bl_label = 'Alpha Convert';
  static override comp_kind = 'KERNEL';
  static override category = 'Converter';
  static override properties = {
    mapping: EnumProperty({
      items: [['STRAIGHT_TO_PREMUL', 'To Premultiplied', ''], ['PREMUL_TO_STRAIGHT', 'To Straight', '']],
      default: 'STRAIGHT_TO_PREMUL', name: 'Mapping',
    }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeConvertColorSpace extends CompNode {
  static override bl_idname = 'CompositorNodeConvertColorSpace';
  static override bl_label = 'Convert Colorspace';
  static override comp_kind = 'KERNEL';
  static override category = 'Converter';
  static override properties = {
    from_color_space: StringProperty({ default: 'sRGB', name: 'From' }),
    to_color_space: StringProperty({ default: 'Linear', name: 'To' }),
  };
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
  }
}

void NodeSocketImage;
void NodeSocketBool;

let _registered = false;
export function registerMoreCompositorNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    CompositorNodeDefocus, CompositorNodeBokehBlur, CompositorNodeBokehImage,
    CompositorNodeBilateralBlur, CompositorNodeDirectionalBlur, CompositorNodeDenoise,
    CompositorNodeFilter, CompositorNodeDilateErode, CompositorNodeInpaint,
    CompositorNodeDespeckle, CompositorNodeSunBeams,
    CompositorNodeLensDistortion, CompositorNodeMovieDistortion, CompositorNodeMapUV,
    CompositorNodeDisplace, CompositorNodeStabilize2D, CompositorNodeCornerPin,
    CompositorNodePlaneTrackDeform,
    CompositorNodeKeying, CompositorNodeKeyingScreen, CompositorNodeColorSpill,
    CompositorNodeDoubleEdgeMask, CompositorNodeIDMask, CompositorNodeCryptomatte,
    CompositorNodeBoxMask, CompositorNodeEllipseMask,
    CompositorNodeLevels, CompositorNodeNormal, CompositorNodeNormalize,
    CompositorNodeSwitch, CompositorNodeSwitchView,
    CompositorNodeOutputFile, CompositorNodePremulKey, CompositorNodeConvertColorSpace,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
