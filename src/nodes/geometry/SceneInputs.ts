/**
 * Geometry-Node Scene/Input nodes (Phase 2C pack).
 *
 * Adds the "Input → Scene" and "Input → Constant" families from
 * RESEARCH §4.3 that were missing from the M0–M8 baseline:
 *
 *   Input → Scene
 *     GeometryNodeInputSceneTime          (seconds + frame)
 *     GeometryNodeIsViewport              (bool: viewport vs render)
 *     GeometryNodeSelfObject              (Object reference of host)
 *     GeometryNodeInputActiveCamera       (Object reference)
 *     GeometryNodeObjectInfo              (Object → Location/Rot/Scale/Geometry)
 *     GeometryNodeImageInfo               (Image → Width/Height/Has Alpha/Frame Count/FPS)
 *
 *   Input → Constant
 *     FunctionNodeInputBool / Int / Color / String / Rotation
 *     GeometryNodeInputMaterial / Image / Object / Collection
 *     (Float, Vector are already shipped as ValueNode / VectorNode.)
 *
 * These mirror Blender 4.x bl_idname strings exactly so that BNG documents
 * round-trip without renaming. They are field-input nodes (`node_kind:
 * 'FIELD'` where appropriate) and their behaviour is wired in
 * GeometryEvaluator's executeNode dispatch.
 */
import { Node, type NodeInitContext } from '../../core/Node';
import {
  BoolProperty, ColorProperty, EnumProperty, FloatVectorProperty, IntProperty,
  StringProperty,
} from '../../core/Properties';
import type { NodeTreeKind, RGBA, Vec3 } from '../../core/types';
import {
  NodeSocketBool, NodeSocketCollection, NodeSocketColor, NodeSocketFloat,
  NodeSocketGeometry, NodeSocketImage, NodeSocketInt, NodeSocketMaterial,
  NodeSocketObject, NodeSocketRotation, NodeSocketString, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

/* ------------------------------------------------------------------ */
/*  Base                                                              */
/* ------------------------------------------------------------------ */

abstract class GeoSceneInput extends Node {
  static override category = 'Input / Scene';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'FIELD' = 'FIELD';
}

abstract class GeoConstantInput extends Node {
  static override category = 'Input / Constant';
  static override tree_types: NodeTreeKind[] = ['GeometryNodeTree'];
  static node_kind: 'FIELD' = 'FIELD';
}

/* ------------------------------------------------------------------ */
/*  Scene                                                              */
/* ------------------------------------------------------------------ */

/**
 * Scene Time — outputs current scene time in seconds and as an integer frame.
 *
 * Pulls from `tree.depsgraph.scene` at evaluate-time, so this node responds
 * to `setScene({ frame, fps, elapsed })` calls (used by the demo's playback
 * controls and by Simulation Zones).
 */
export class GeometryNodeInputSceneTime extends GeoSceneInput {
  static override bl_idname = 'GeometryNodeInputSceneTime';
  static override bl_label = 'Scene Time';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketFloat, 'Seconds');
    this.addOutput(NodeSocketFloat, 'Frame');
  }
}

/**
 * Is Viewport — true when evaluated in viewport mode, false when rendering.
 *
 * Hosts can flip the depsgraph's `is_viewport` flag (see GeometryEvaluator
 * options) to drive LOD switching graphs. Defaults to `true`.
 */
export class GeometryNodeIsViewport extends GeoSceneInput {
  static override bl_idname = 'GeometryNodeIsViewport';
  static override bl_label = 'Is Viewport';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketBool, 'Is Viewport');
  }
}

/**
 * Self Object — the Object reference of the host owning this node tree
 * (typically a `Modifier` host in Blender). Resolved through the
 * evaluator's `resolveSelfObject?` option.
 */
export class GeometryNodeSelfObject extends GeoSceneInput {
  static override bl_idname = 'GeometryNodeSelfObject';
  static override bl_label = 'Self Object';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketObject, 'Self Object');
  }
}

/** Active Camera — Object reference of the scene's active camera. */
export class GeometryNodeInputActiveCamera extends GeoSceneInput {
  static override bl_idname = 'GeometryNodeInputActiveCamera';
  static override bl_label = 'Active Camera';
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketObject, 'Active Camera');
  }
}

/**
 * Object Info — given an Object reference (or null), expose its Location,
 * Rotation, Scale, instance Geometry, and a stable Random hash.
 *
 * Resolved through `resolveObject(key) → ObjectInfoLike | null` on the
 * evaluator. Defaults to identity when unresolved.
 */
export class GeometryNodeObjectInfo extends GeoSceneInput {
  static override bl_idname = 'GeometryNodeObjectInfo';
  static override bl_label = 'Object Info';
  static override properties = {
    transform_space: EnumProperty({
      items: [
        ['ORIGINAL', 'Original', 'Object transform in scene space'],
        ['RELATIVE', 'Relative', 'Object transform relative to host'],
      ],
      default: 'ORIGINAL',
      name: 'Transform Space',
    }),
  };
  declare transform_space: 'ORIGINAL' | 'RELATIVE';

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketObject, 'Object');
    this.addInput(NodeSocketBool, 'As Instance', { default_value: false });
    this.addOutput(NodeSocketVector, 'Location');
    this.addOutput(NodeSocketRotation, 'Rotation');
    this.addOutput(NodeSocketVector, 'Scale');
    this.addOutput(NodeSocketGeometry, 'Geometry');
    this.addOutput(NodeSocketFloat, 'Random');
  }
}

/**
 * Image Info — metadata on an Image reference. Resolved through
 * `resolveImageInfo(key)` on the evaluator. Defaults to zeros when
 * unresolved (matches Blender's behaviour when the image is purple-flagged).
 */
export class GeometryNodeImageInfo extends GeoSceneInput {
  static override bl_idname = 'GeometryNodeImageInfo';
  static override bl_label = 'Image Info';
  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketImage, 'Image');
    this.addInput(NodeSocketInt, 'Frame', { default_value: 1 });
    this.addOutput(NodeSocketInt, 'Width');
    this.addOutput(NodeSocketInt, 'Height');
    this.addOutput(NodeSocketBool, 'Has Alpha');
    this.addOutput(NodeSocketInt, 'Frame Count');
    this.addOutput(NodeSocketFloat, 'FPS');
  }
}

/* ------------------------------------------------------------------ */
/*  Input → Constant                                                  */
/* ------------------------------------------------------------------ */

/** Boolean constant. */
export class FunctionNodeInputBool extends GeoConstantInput {
  static override bl_idname = 'FunctionNodeInputBool';
  static override bl_label = 'Boolean';
  static override properties = {
    boolean: BoolProperty({ default: false, name: 'Boolean' }),
  };
  declare boolean: boolean;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketBool, 'Boolean');
  }
}

/** Integer constant. */
export class FunctionNodeInputInt extends GeoConstantInput {
  static override bl_idname = 'FunctionNodeInputInt';
  static override bl_label = 'Integer';
  static override properties = {
    integer: IntProperty({ default: 0, name: 'Integer' }),
  };
  declare integer: number;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketInt, 'Integer');
  }
}

/**
 * Color constant. The Blender Python attribute is `value`; we follow the
 * same name (mirroring `bpy.types.FunctionNodeInputColor.value`). Note this
 * is **not** the same `color` field as the Node header colour on
 * `bpy.types.Node` — that one lives at `node.color`.
 */
export class FunctionNodeInputColor extends GeoConstantInput {
  static override bl_idname = 'FunctionNodeInputColor';
  static override bl_label = 'Color';
  static override properties = {
    value: ColorProperty({ default: [1, 1, 1, 1] as const, name: 'Color' }),
  };
  declare value: RGBA;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketColor, 'Color');
  }
}

/** String constant. */
export class FunctionNodeInputString extends GeoConstantInput {
  static override bl_idname = 'FunctionNodeInputString';
  static override bl_label = 'String';
  static override properties = {
    string: StringProperty({ default: '', name: 'String' }),
  };
  declare string: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketString, 'String');
  }
}

/** Euler-rotation constant. */
export class FunctionNodeInputRotation extends GeoConstantInput {
  static override bl_idname = 'FunctionNodeInputRotation';
  static override bl_label = 'Rotation';
  static override properties = {
    rotation_euler: FloatVectorProperty({
      default: [0, 0, 0], size: 3, subtype: 'EULER', name: 'Rotation',
    }),
  };
  declare rotation_euler: Vec3;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketRotation, 'Rotation');
  }
}

/** Material reference constant (Blender stores a Material datablock id). */
export class GeometryNodeInputMaterial extends GeoConstantInput {
  static override bl_idname = 'GeometryNodeInputMaterial';
  static override bl_label = 'Material';
  static override properties = {
    material: StringProperty({ default: '', name: 'Material' }),
  };
  declare material: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketMaterial, 'Material');
  }
}

/** Image reference constant. */
export class GeometryNodeInputImage extends GeoConstantInput {
  static override bl_idname = 'GeometryNodeInputImage';
  static override bl_label = 'Image';
  static override properties = {
    image: StringProperty({ default: '', name: 'Image' }),
  };
  declare image: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketImage, 'Image');
  }
}

/** Object reference constant. */
export class GeometryNodeInputObject extends GeoConstantInput {
  static override bl_idname = 'GeometryNodeInputObject';
  static override bl_label = 'Object';
  static override properties = {
    object: StringProperty({ default: '', name: 'Object' }),
  };
  declare object: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketObject, 'Object');
  }
}

/** Collection reference constant. */
export class GeometryNodeInputCollection extends GeoConstantInput {
  static override bl_idname = 'GeometryNodeInputCollection';
  static override bl_label = 'Collection';
  static override properties = {
    collection: StringProperty({ default: '', name: 'Collection' }),
  };
  declare collection: string;
  override init(_ctx: NodeInitContext): void {
    this.addOutput(NodeSocketCollection, 'Collection');
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */
let _registered = false;
export function registerSceneInputNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [
    GeometryNodeInputSceneTime,
    GeometryNodeIsViewport,
    GeometryNodeSelfObject,
    GeometryNodeInputActiveCamera,
    GeometryNodeObjectInfo,
    GeometryNodeImageInfo,
    FunctionNodeInputBool,
    FunctionNodeInputInt,
    FunctionNodeInputColor,
    FunctionNodeInputString,
    FunctionNodeInputRotation,
    GeometryNodeInputMaterial,
    GeometryNodeInputImage,
    GeometryNodeInputObject,
    GeometryNodeInputCollection,
  ]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
