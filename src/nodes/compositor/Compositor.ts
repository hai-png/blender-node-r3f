/**
 * Compositor node pack (M5).
 *
 * Each node is just a thin Blender-style declaration: bl_idname, sockets,
 * properties. The compositor evaluator (src/eval/compositor/) knows how
 * to compile each into a `KernelOperation` or a `ShaderOperation` cluster.
 *
 * Pixel-wise nodes carry a static `pixelGLSL(env)` method that returns a
 * fragment of GLSL — the planner uses this to fuse them into one shader
 * pass. Kernel nodes (Blur, Glare, Vignette, distort ops) instead carry a
 * `compileKernel()` method that returns a complete fragment shader.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { BoolProperty, EnumProperty, FloatProperty, StringProperty } from '../../core/Properties';
import type { NodeTreeKind, RGBA } from '../../core/types';
import {
  NodeSocketBool, NodeSocketColor, NodeSocketFloat, NodeSocketFloatFactor, NodeSocketImage,
  NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

/** Marker enum used by the planner's dispatcher. */
export type CompKind = 'INPUT' | 'OUTPUT' | 'PIXEL' | 'KERNEL';

export abstract class CompNode extends Node {
  static override tree_types: NodeTreeKind[] = ['CompositorNodeTree'];
  /**
   * Marker for the evaluator's dispatcher.
   *
   * Typed as `string` so subclasses can override with the specific literal
   * via `static override comp_kind = 'KERNEL' as const;` (or just a string).
   * The runtime planner narrows it back to `CompKind`.
   */
  static comp_kind: string = 'PIXEL';
}

/* ------------------------------------------------------------------ */
/*  Input                                                             */
/* ------------------------------------------------------------------ */

export class CompositorNodeImage extends CompNode {
  static override bl_idname = 'CompositorNodeImage';
  static override bl_label = 'Image';
  static override category = 'Input';
  static override comp_kind = 'INPUT';
  static override properties = {
    image_src: StringProperty({ default: '', name: 'Image URL', subtype: 'FILE_PATH' }),
  };
  declare image_src: string;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketImage, 'Image');
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class CompositorNodeRGB extends CompNode {
  static override bl_idname = 'CompositorNodeRGB';
  static override bl_label = 'RGB';
  static override category = 'Input';
  static override comp_kind = 'INPUT';
  override init(_ctx: NodeInitContext): void {
    const out = this.addOutput(NodeSocketColor, 'RGBA');
    out.default_value = [1, 1, 1, 1];
  }
}

export class CompositorNodeValue extends CompNode {
  static override bl_idname = 'CompositorNodeValue';
  static override bl_label = 'Value';
  static override category = 'Input';
  static override comp_kind = 'INPUT';
  override init(_ctx: NodeInitContext): void {
    const out = this.addOutput(NodeSocketFloat, 'Value');
    out.default_value = 0.5;
  }
}

export class CompositorNodeRLayers extends CompNode {
  static override bl_idname = 'CompositorNodeRLayers';
  static override bl_label = 'Render Layers';
  static override category = 'Input';
  static override comp_kind = 'INPUT';
  override init(_ctx: NodeInitContext): void {
    // In Blender this snapshots the scene render. Our equivalent surfaces
    // an external "render texture" provided by the demo viewport.
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Alpha');
    this.addOutput(NodeSocketFloat, 'Depth');
  }
}

/* ------------------------------------------------------------------ */
/*  Output                                                            */
/* ------------------------------------------------------------------ */

export class CompositorNodeComposite extends CompNode {
  static override bl_idname = 'CompositorNodeComposite';
  static override bl_label = 'Composite';
  static override category = 'Output';
  static override comp_kind = 'OUTPUT';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Alpha', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Z');
  }
}

export class CompositorNodeViewer extends CompNode {
  static override bl_idname = 'CompositorNodeViewer';
  static override bl_label = 'Viewer';
  static override category = 'Output';
  static override comp_kind = 'OUTPUT';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Alpha', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Z');
  }
}

/* ------------------------------------------------------------------ */
/*  Pixel-wise colour ops                                             */
/* ------------------------------------------------------------------ */

const MIX_BLEND_TYPES = [
  ['MIX', 'Mix', ''], ['ADD', 'Add', ''], ['MULTIPLY', 'Multiply', ''],
  ['SUBTRACT', 'Subtract', ''], ['SCREEN', 'Screen', ''], ['OVERLAY', 'Overlay', ''],
  ['DIFFERENCE', 'Difference', ''], ['DIVIDE', 'Divide', ''], ['LIGHTEN', 'Lighten', ''],
  ['DARKEN', 'Darken', ''],
] as const;

export class CompositorNodeMixRGB extends CompNode {
  static override bl_idname = 'CompositorNodeMixRGB';
  static override bl_label = 'Mix';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  static override properties = {
    blend_type: EnumProperty({ items: MIX_BLEND_TYPES, default: 'MIX', name: 'Blend' }),
    use_clamp: BoolProperty({ default: false, name: 'Clamp Result' }),
  };
  declare blend_type: typeof MIX_BLEND_TYPES[number][0];
  declare use_clamp: boolean;

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 0.5 });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1], identifier: 'Image' });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1], identifier: 'Image_001' });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeBrightContrast extends CompNode {
  static override bl_idname = 'CompositorNodeBrightContrast';
  static override bl_label = 'Brightness/Contrast';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Bright', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Contrast', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeInvert extends CompNode {
  static override bl_idname = 'CompositorNodeInvert';
  static override bl_label = 'Invert';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  static override properties = {
    invert_rgb: BoolProperty({ default: true, name: 'RGB' }),
    invert_alpha: BoolProperty({ default: false, name: 'Alpha' }),
  };
  declare invert_rgb: boolean;
  declare invert_alpha: boolean;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Color', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Color');
  }
}

export class CompositorNodeGamma extends CompNode {
  static override bl_idname = 'CompositorNodeGamma';
  static override bl_label = 'Gamma';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Gamma', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeExposure extends CompNode {
  static override bl_idname = 'CompositorNodeExposure';
  static override bl_label = 'Exposure';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Exposure', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeHueSat extends CompNode {
  static override bl_idname = 'CompositorNodeHueSat';
  static override bl_label = 'Hue Saturation Value';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Hue', { default_value: 0.5 });
    this.addInput(NodeSocketFloatFactor, 'Saturation', { default_value: 1 });
    this.addInput(NodeSocketFloatFactor, 'Value', { default_value: 1 });
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeAlphaOver extends CompNode {
  static override bl_idname = 'CompositorNodeAlphaOver';
  static override bl_label = 'Alpha Over';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1], identifier: 'Image' });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1], identifier: 'Image_001' });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeSetAlpha extends CompNode {
  static override bl_idname = 'CompositorNodeSetAlpha';
  static override bl_label = 'Set Alpha';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [1, 1, 1, 1] });
    this.addInput(NodeSocketFloatFactor, 'Alpha', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeRGBToBW extends CompNode {
  static override bl_idname = 'CompositorNodeRGBToBW';
  static override bl_label = 'RGB to BW';
  static override category = 'Converter';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketFloat, 'Val');
  }
}

export class CompositorNodeMath extends CompNode {
  static override bl_idname = 'CompositorNodeMath';
  static override bl_label = 'Math';
  static override category = 'Converter';
  static override comp_kind = 'PIXEL';
  static override properties = {
    operation: EnumProperty({
      items: [
        ['ADD', 'Add', ''], ['SUBTRACT', 'Subtract', ''], ['MULTIPLY', 'Multiply', ''],
        ['DIVIDE', 'Divide', ''], ['POWER', 'Power', ''], ['MINIMUM', 'Minimum', ''],
        ['MAXIMUM', 'Maximum', ''], ['ABSOLUTE', 'Absolute', ''], ['LESS_THAN', 'Less Than', ''],
        ['GREATER_THAN', 'Greater Than', ''], ['SINE', 'Sine', ''], ['COSINE', 'Cosine', ''],
        ['SQRT', 'Square Root', ''],
      ] as const,
      default: 'ADD', name: 'Operation',
    }),
    use_clamp: BoolProperty({ default: false, name: 'Clamp' }),
  };
  declare operation: string;
  declare use_clamp: boolean;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0, identifier: 'Value' });
    this.addInput(NodeSocketFloat, 'Value', { default_value: 0, identifier: 'Value_001' });
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

/* ------------------------------------------------------------------ */
/*  Filter / Kernel ops                                               */
/* ------------------------------------------------------------------ */

export class CompositorNodeBlur extends CompNode {
  static override bl_idname = 'CompositorNodeBlur';
  static override bl_label = 'Blur';
  static override category = 'Filter';
  static override comp_kind = 'KERNEL';
  static override properties = {
    size_x: FloatProperty({ default: 8, min: 0, name: 'Size X' }),
    size_y: FloatProperty({ default: 8, min: 0, name: 'Size Y' }),
    filter_type: EnumProperty({
      items: [
        ['GAUSS', 'Gaussian', 'Gaussian (separable)'],
        ['FAST_GAUSS', 'Fast Gaussian', 'Box-style fast approximation'],
        ['BOX', 'Box', 'Box filter'],
      ] as const,
      default: 'GAUSS', name: 'Filter Type',
    }),
  };
  declare size_x: number;
  declare size_y: number;
  declare filter_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloatFactor, 'Size', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeGlare extends CompNode {
  static override bl_idname = 'CompositorNodeGlare';
  static override bl_label = 'Glare';
  static override category = 'Filter';
  static override comp_kind = 'KERNEL';
  static override properties = {
    glare_type: EnumProperty({
      items: [['FOG_GLOW', 'Fog Glow', ''], ['SIMPLE_STAR', 'Simple Star', '']] as const,
      default: 'FOG_GLOW', name: 'Type',
    }),
    threshold: FloatProperty({ default: 1, min: 0, name: 'Threshold' }),
    mix: FloatProperty({ default: 0, min: -1, max: 1, name: 'Mix' }),
    size: FloatProperty({ default: 8, min: 1, max: 64, name: 'Size' }),
  };
  declare glare_type: string;
  declare threshold: number;
  declare mix: number;
  declare size: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeVignette extends CompNode {
  static override bl_idname = 'CompositorNodeVignette';
  static override bl_label = 'Vignette';
  static override category = 'Filter';
  static override comp_kind = 'KERNEL';
  static override properties = {
    radius: FloatProperty({ default: 0.75, min: 0, max: 2, name: 'Radius' }),
    softness: FloatProperty({ default: 0.5, min: 0, max: 2, name: 'Softness' }),
  };
  declare radius: number;
  declare softness: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodePixelate extends CompNode {
  static override bl_idname = 'CompositorNodePixelate';
  static override bl_label = 'Pixelate';
  static override category = 'Filter';
  static override comp_kind = 'KERNEL';
  static override properties = {
    pixel_size: FloatProperty({ default: 8, min: 1, max: 256, name: 'Pixel Size' }),
  };
  declare pixel_size: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

/* ------------------------------------------------------------------ */
/*  Distort                                                           */
/* ------------------------------------------------------------------ */

export class CompositorNodeTranslate extends CompNode {
  static override bl_idname = 'CompositorNodeTranslate';
  static override bl_label = 'Translate';
  static override category = 'Distort';
  static override comp_kind = 'KERNEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'X', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Y', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeScale extends CompNode {
  static override bl_idname = 'CompositorNodeScale';
  static override bl_label = 'Scale';
  static override category = 'Distort';
  static override comp_kind = 'KERNEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'X', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'Y', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeRotate extends CompNode {
  static override bl_idname = 'CompositorNodeRotate';
  static override bl_label = 'Rotate';
  static override category = 'Distort';
  static override comp_kind = 'KERNEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Degr', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeFlip extends CompNode {
  static override bl_idname = 'CompositorNodeFlip';
  static override bl_label = 'Flip';
  static override category = 'Distort';
  static override comp_kind = 'KERNEL';
  static override properties = {
    axis: EnumProperty({
      items: [['X', 'Flip X', ''], ['Y', 'Flip Y', ''], ['XY', 'Flip X & Y', '']] as const,
      default: 'X', name: 'Axis',
    }),
  };
  declare axis: 'X' | 'Y' | 'XY';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeCrop extends CompNode {
  static override bl_idname = 'CompositorNodeCrop';
  static override bl_label = 'Crop';
  static override category = 'Distort';
  static override comp_kind = 'KERNEL';
  static override properties = {
    min_x: FloatProperty({ default: 0, min: 0, max: 1, name: 'Min X' }),
    min_y: FloatProperty({ default: 0, min: 0, max: 1, name: 'Min Y' }),
    max_x: FloatProperty({ default: 1, min: 0, max: 1, name: 'Max X' }),
    max_y: FloatProperty({ default: 1, min: 0, max: 1, name: 'Max Y' }),
  };
  declare min_x: number; declare min_y: number;
  declare max_x: number; declare max_y: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

/* ------------------------------------------------------------------ */
/*  Suppress unused warnings                                          */
/* ------------------------------------------------------------------ */
void NodeSocketBool;
void NodeSocketVector;

export class CompositorNodePosterize extends CompNode {
  static override bl_idname = 'CompositorNodePosterize';
  static override bl_label = 'Posterize';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Steps', { default_value: 8 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeZcombine extends CompNode {
  static override bl_idname = 'CompositorNodeZcombine';
  static override bl_label = 'Z Combine';
  static override category = 'Color';
  static override comp_kind = 'PIXEL';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Z', { default_value: 0 });
    this.addInput(NodeSocketColor, 'Image_001', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketFloat, 'Z_001', { default_value: 0 });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Z');
  }
}

export class CompositorNodeMapRange extends CompNode {
  static override bl_idname = 'CompositorNodeMapRange';
  static override bl_label = 'Map Range';
  static override category = 'Vector';
  static override comp_kind = 'PIXEL';
  static override properties = {
    use_clamp: BoolProperty({ default: true, name: 'Clamp' }),
  };
  declare use_clamp: boolean;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Value', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'From Min', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'From Max', { default_value: 1 });
    this.addInput(NodeSocketFloat, 'To Min', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'To Max', { default_value: 1 });
    this.addOutput(NodeSocketFloat, 'Value');
  }
}

export class CompositorNodeCombineColor extends CompNode {
  static override bl_idname = 'CompositorNodeCombineColor';
  static override bl_label = 'Combine Color';
  static override category = 'Converter';
  static override comp_kind = 'PIXEL';
  static override properties = {
    mode: EnumProperty({ items: [['RGB','RGB',''],['HSV','HSV',''],['HSL','HSL','']], default: 'RGB' }),
  };
  declare mode: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'Red', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Green', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Blue', { default_value: 0 });
    this.addInput(NodeSocketFloatFactor, 'Alpha', { default_value: 1 });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeSeparateColor extends CompNode {
  static override bl_idname = 'CompositorNodeSeparateColor';
  static override bl_label = 'Separate Color';
  static override category = 'Converter';
  static override comp_kind = 'PIXEL';
  static override properties = {
    mode: EnumProperty({ items: [['RGB','RGB',''],['HSV','HSV',''],['HSL','HSL','']], default: 'RGB' }),
  };
  declare mode: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketFloat, 'Red');
    this.addOutput(NodeSocketFloat, 'Green');
    this.addOutput(NodeSocketFloat, 'Blue');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export interface CompositorColorRampStop {
  position: number;
  color: RGBA;
}

export class CompositorNodeValToRGB extends CompNode {
  static override bl_idname = 'CompositorNodeValToRGB';
  static override bl_label = 'Color Ramp';
  static override category = 'Converter';
  static override comp_kind = 'PIXEL';
  static override properties = {
    color_mode: EnumProperty({ items: [['RGB','RGB',''],['HSV','HSV','']], default: 'RGB' }),
    interpolation: EnumProperty({
      items: [['LINEAR','Linear',''],['CONSTANT','Constant',''],['EASE','Ease','']],
      default: 'LINEAR', name: 'Interpolation',
    }),
  };
  declare color_mode: string;
  declare interpolation: 'LINEAR' | 'CONSTANT' | 'EASE';
  /** Editable ramp stops. Defaults mirror Blender's black→white ramp. */
  stops: CompositorColorRampStop[] = [
    { position: 0, color: [0, 0, 0, 1] },
    { position: 1, color: [1, 1, 1, 1] },
  ];
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 0.5 });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Alpha');
  }
}

export class CompositorNodeSplitViewer extends CompNode {
  static override bl_idname = 'CompositorNodeSplitViewer';
  static override bl_label = 'Split Viewer';
  static override category = 'Output';
  static override comp_kind = 'OUTPUT';
  static override properties = {
    factor: FloatProperty({ default: 50, min: 0, max: 100, name: 'Factor' }),
    axis: EnumProperty({ items: [['X','X',''],['Y','Y','']], default: 'X' }),
  };
  declare factor: number;
  declare axis: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketColor, 'Image_001', { default_value: [0, 0, 0, 1] });
  }
}

// -----------------------------------------------------------------------
//  ColorBalance, HueCorrect, Tonemap — now properly declared as node classes
//  (previously handled only via bl_idname dispatch in the evaluator)
// -----------------------------------------------------------------------
export class CompositorNodeColorBalance extends CompNode {
  static override bl_idname = 'CompositorNodeColorBalance';
  static override bl_label = 'Color Balance';
  static override category = 'Color';
  static override properties = {
    lift_r: FloatProperty({ default: 0, min: -1, max: 1, name: 'Lift R' }),
    lift_g: FloatProperty({ default: 0, min: -1, max: 1, name: 'Lift G' }),
    lift_b: FloatProperty({ default: 0, min: -1, max: 1, name: 'Lift B' }),
    gain_r: FloatProperty({ default: 1, min: 0, max: 4, name: 'Gain R' }),
    gain_g: FloatProperty({ default: 1, min: 0, max: 4, name: 'Gain G' }),
    gain_b: FloatProperty({ default: 1, min: 0, max: 4, name: 'Gain B' }),
    gamma_r: FloatProperty({ default: 1, min: 0.01, max: 4, name: 'Gamma R' }),
    gamma_g: FloatProperty({ default: 1, min: 0.01, max: 4, name: 'Gamma G' }),
    gamma_b: FloatProperty({ default: 1, min: 0.01, max: 4, name: 'Gamma B' }),
  };
  declare lift_r: number; declare lift_g: number; declare lift_b: number;
  declare gain_r: number; declare gain_g: number; declare gain_b: number;
  declare gamma_r: number; declare gamma_g: number; declare gamma_b: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeHueCorrect extends CompNode {
  static override bl_idname = 'CompositorNodeHueCorrect';
  static override bl_label = 'Hue Correct';
  static override category = 'Color';
  static override properties = {
    saturation: FloatProperty({ default: 1, min: 0, max: 4, name: 'Saturation' }),
  };
  declare saturation: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloatFactor, 'Fac', { default_value: 1 });
    this.addInput(NodeSocketColor, 'Image', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

export class CompositorNodeTonemap extends CompNode {
  static override bl_idname = 'CompositorNodeTonemap';
  static override bl_label = 'Tonemap';
  static override category = 'Color';
  static override properties = {
    tonemap_type: EnumProperty({
      items: [['RD_PHOTORECEPTOR','Reinhard',''], ['RH_SIMPLE','Filmic','']],
      default: 'RD_PHOTORECEPTOR',
    }),
  };
  declare tonemap_type: string;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0.8, 0.8, 0.8, 1] });
    this.addOutput(NodeSocketColor, 'Image');
  }
}

/* ------------------------------------------------------------------ */
/*  Matte / Keying (Phase 2C — see RESEARCH.md §4.4)                  */
/* ------------------------------------------------------------------ */

/**
 * Luminance Key — alpha = smoothstep(limit_min, limit_max, luma(rgb)).
 * Used as a quick alpha-from-luma extractor. Single Image input, single
 * Image+Alpha output (Image preserves rgb, alpha is the matte).
 */
export class CompositorNodeLumaMatte extends CompNode {
  static override bl_idname = 'CompositorNodeLumaMatte';
  static override bl_label = 'Luminance Key';
  static override category = 'Matte';
  static override comp_kind = 'PIXEL';
  static override properties = {
    limit_min: FloatProperty({ default: 0, min: 0, max: 1, name: 'Low' }),
    limit_max: FloatProperty({ default: 1, min: 0, max: 1, name: 'High' }),
  };
  declare limit_min: number;
  declare limit_max: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Matte');
  }
}

/**
 * Color Matte — alpha = 0 inside a HSV tolerance box around the Key Color,
 * 1 outside (Blender semantics: pass = matched pixels are *removed*).
 */
export class CompositorNodeColorMatte extends CompNode {
  static override bl_idname = 'CompositorNodeColorMatte';
  static override bl_label = 'Color Key';
  static override category = 'Matte';
  static override comp_kind = 'PIXEL';
  static override properties = {
    color_hue: FloatProperty({ default: 0.01, min: 0, max: 1, name: 'H' }),
    color_saturation: FloatProperty({ default: 0.1, min: 0, max: 1, name: 'S' }),
    color_value: FloatProperty({ default: 0.1, min: 0, max: 1, name: 'V' }),
  };
  declare color_hue: number;
  declare color_saturation: number;
  declare color_value: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketColor, 'Key Color', { default_value: [0, 1, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Matte');
  }
}

/**
 * Distance Matte — Euclidean RGB distance between Image and Key, with a
 * tolerance + falloff range. Inside `tolerance`: keyed out (alpha=0).
 * Beyond `tolerance + falloff`: kept (alpha=1). Smooth in between.
 */
export class CompositorNodeDistanceMatte extends CompNode {
  static override bl_idname = 'CompositorNodeDistanceMatte';
  static override bl_label = 'Distance Key';
  static override category = 'Matte';
  static override comp_kind = 'PIXEL';
  static override properties = {
    tolerance: FloatProperty({ default: 0.1, min: 0, max: 1, name: 'Tolerance' }),
    falloff: FloatProperty({ default: 0.1, min: 0, max: 1, name: 'Falloff' }),
  };
  declare tolerance: number;
  declare falloff: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketColor, 'Key Color', { default_value: [0, 1, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Matte');
  }
}

/**
 * Chroma Matte — Hue+Saturation distance keying (value-agnostic).
 * `acceptance` is the outer disc radius, `cutoff` the inner.
 */
export class CompositorNodeChromaMatte extends CompNode {
  static override bl_idname = 'CompositorNodeChromaMatte';
  static override bl_label = 'Chroma Key';
  static override category = 'Matte';
  static override comp_kind = 'PIXEL';
  static override properties = {
    acceptance: FloatProperty({ default: 0.4, min: 0, max: 1, name: 'Acceptance' }),
    cutoff: FloatProperty({ default: 0.1, min: 0, max: 1, name: 'Cutoff' }),
  };
  declare acceptance: number;
  declare cutoff: number;
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketColor, 'Image', { default_value: [0, 0, 0, 1] });
    this.addInput(NodeSocketColor, 'Key Color', { default_value: [0, 1, 0, 1] });
    this.addOutput(NodeSocketColor, 'Image');
    this.addOutput(NodeSocketFloat, 'Matte');
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                      */
/* ------------------------------------------------------------------ */
let _registered = false;
export function registerCompositorNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    CompositorNodeImage, CompositorNodeRGB, CompositorNodeValue, CompositorNodeRLayers,
    CompositorNodeComposite, CompositorNodeViewer,
    CompositorNodeMixRGB, CompositorNodeBrightContrast, CompositorNodeInvert,
    CompositorNodeGamma, CompositorNodeExposure, CompositorNodeHueSat,
    CompositorNodeAlphaOver, CompositorNodeSetAlpha, CompositorNodeRGBToBW, CompositorNodeMath,
    CompositorNodeBlur, CompositorNodeGlare, CompositorNodeVignette, CompositorNodePixelate,
    CompositorNodeTranslate, CompositorNodeScale, CompositorNodeRotate, CompositorNodeFlip,
    CompositorNodeCrop,
    CompositorNodePosterize, CompositorNodeZcombine, CompositorNodeMapRange,
    CompositorNodeCombineColor, CompositorNodeSeparateColor, CompositorNodeValToRGB,
    CompositorNodeSplitViewer,
    CompositorNodeColorBalance, CompositorNodeHueCorrect, CompositorNodeTonemap,
    // Phase 2C matte/keying pack:
    CompositorNodeLumaMatte, CompositorNodeColorMatte, CompositorNodeDistanceMatte,
    CompositorNodeChromaMatte,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}

// CompNode is already exported at its declaration site (Phase-3 audit
// made it `export abstract class CompNode` so MoreCompositor.ts can extend
// the same shared base — required for the planner's `instanceof CompNode`
// check to match the additional nodes).
