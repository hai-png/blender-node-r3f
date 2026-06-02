/**
 * Built-in NodeSocket subclasses.
 *
 * Covers every socket kind shipped with Blender 4.x / 5.x:
 *   NodeSocketFloat (+ subtypes), NodeSocketInt, NodeSocketBool,
 *   NodeSocketVector (+ subtypes), NodeSocketRotation, NodeSocketMatrix,
 *   NodeSocketColor, NodeSocketString, NodeSocketShader, NodeSocketGeometry,
 *   NodeSocketObject, NodeSocketCollection, NodeSocketMaterial,
 *   NodeSocketImage, NodeSocketTexture, NodeSocketMenu.
 *
 * Colors approximate Blender's defaults (RGBA, 0-1 linear).
 */
import type { RGBA, SocketKind, Vec3, Vec4 } from '../core/types';
import { NodeSocket } from '../core/NodeSocket';
import { NodeRegistry } from '../registry/NodeRegistry';

/* ------------------------------------------------------------------ */
/*  Float                                                             */
/* ------------------------------------------------------------------ */
const FLOAT_COLOR: RGBA = [0.63, 0.63, 0.63, 1];

export class NodeSocketFloat extends NodeSocket<number> {
  static override bl_idname = 'NodeSocketFloat';
  static override bl_label = 'Float';
  static override kind: SocketKind = 'VALUE';
  static override color: RGBA = FLOAT_COLOR;
  override default_value = 0;
  override coerceFrom(other: NodeSocket): number {
    const v = other.value;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (Array.isArray(v)) return ((v[0] as number) + (v[1] as number) + (v[2] as number)) / 3;
    return Number(v ?? 0);
  }
}
export class NodeSocketFloatFactor extends NodeSocketFloat {
  static override bl_idname = 'NodeSocketFloatFactor';
}
export class NodeSocketFloatAngle extends NodeSocketFloat {
  static override bl_idname = 'NodeSocketFloatAngle';
}
export class NodeSocketFloatPercentage extends NodeSocketFloat {
  static override bl_idname = 'NodeSocketFloatPercentage';
}
export class NodeSocketFloatTime extends NodeSocketFloat {
  static override bl_idname = 'NodeSocketFloatTime';
}
export class NodeSocketFloatDistance extends NodeSocketFloat {
  static override bl_idname = 'NodeSocketFloatDistance';
}
export class NodeSocketFloatUnsigned extends NodeSocketFloat {
  static override bl_idname = 'NodeSocketFloatUnsigned';
}

/* ------------------------------------------------------------------ */
/*  Int                                                               */
/* ------------------------------------------------------------------ */
const INT_COLOR: RGBA = [0.06, 0.52, 0.15, 1];
export class NodeSocketInt extends NodeSocket<number> {
  static override bl_idname = 'NodeSocketInt';
  static override bl_label = 'Integer';
  static override kind: SocketKind = 'INT';
  static override color: RGBA = INT_COLOR;
  override default_value = 0;
  override coerceFrom(other: NodeSocket): number {
    if (typeof other.value === 'number') return Math.trunc(other.value);
    if (typeof other.value === 'boolean') return other.value ? 1 : 0;
    return 0;
  }
}
export class NodeSocketIntUnsigned extends NodeSocketInt {
  static override bl_idname = 'NodeSocketIntUnsigned';
}

/* ------------------------------------------------------------------ */
/*  Bool                                                              */
/* ------------------------------------------------------------------ */
const BOOL_COLOR: RGBA = [0.85, 0.27, 0.5, 1];
export class NodeSocketBool extends NodeSocket<boolean> {
  static override bl_idname = 'NodeSocketBool';
  static override bl_label = 'Boolean';
  static override kind: SocketKind = 'BOOLEAN';
  static override color: RGBA = BOOL_COLOR;
  override default_value = false;
  override coerceFrom(other: NodeSocket): boolean {
    const v = other.value;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return Boolean(v);
  }
}

/* ------------------------------------------------------------------ */
/*  Vector                                                            */
/* ------------------------------------------------------------------ */
const VEC_COLOR: RGBA = [0.39, 0.39, 0.78, 1];
export class NodeSocketVector extends NodeSocket<Vec3> {
  static override bl_idname = 'NodeSocketVector';
  static override bl_label = 'Vector';
  static override kind: SocketKind = 'VECTOR';
  static override color: RGBA = VEC_COLOR;
  override default_value: Vec3 = [0, 0, 0];
  override coerceFrom(other: NodeSocket): Vec3 {
    const v = other.value;
    if (Array.isArray(v) && v.length >= 3) return [v[0]!, v[1]!, v[2]!] as Vec3;
    if (typeof v === 'number') return [v, v, v];
    if (typeof v === 'boolean') return v ? [1, 1, 1] : [0, 0, 0];
    return [0, 0, 0];
  }
}
export class NodeSocketVectorXYZ extends NodeSocketVector {
  static override bl_idname = 'NodeSocketVectorXYZ';
}
export class NodeSocketVectorDirection extends NodeSocketVector {
  static override bl_idname = 'NodeSocketVectorDirection';
}
export class NodeSocketVectorEuler extends NodeSocketVector {
  static override bl_idname = 'NodeSocketVectorEuler';
}
export class NodeSocketVectorTranslation extends NodeSocketVector {
  static override bl_idname = 'NodeSocketVectorTranslation';
}
export class NodeSocketVectorVelocity extends NodeSocketVector {
  static override bl_idname = 'NodeSocketVectorVelocity';
}
export class NodeSocketVectorAcceleration extends NodeSocketVector {
  static override bl_idname = 'NodeSocketVectorAcceleration';
}

/* ------------------------------------------------------------------ */
/*  Rotation (quaternion + euler dual storage)                        */
/* ------------------------------------------------------------------ */
const ROT_COLOR: RGBA = [0.65, 0.39, 0.78, 1];
export type Rotation = { quat: Vec4; euler: Vec3 };
export class NodeSocketRotation extends NodeSocket<Rotation> {
  static override bl_idname = 'NodeSocketRotation';
  static override bl_label = 'Rotation';
  static override kind: SocketKind = 'ROTATION';
  static override color: RGBA = ROT_COLOR;
  override default_value: Rotation = { quat: [0, 0, 0, 1], euler: [0, 0, 0] };
  override coerceFrom(other: NodeSocket): Rotation {
    const v = other.value;
    if (v && typeof v === 'object' && 'euler' in (v as object) && Array.isArray((v as Rotation).euler)) {
      return v as Rotation;
    }
    if (Array.isArray(v) && v.length >= 3) {
      return { quat: [0, 0, 0, 1], euler: [Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 0)] };
    }
    if (typeof v === 'number') return { quat: [0, 0, 0, 1], euler: [v, v, v] };
    return { quat: [0, 0, 0, 1], euler: [0, 0, 0] };
  }
}

/* ------------------------------------------------------------------ */
/*  Matrix                                                            */
/* ------------------------------------------------------------------ */
const MAT_COLOR: RGBA = [0.5, 0.5, 1, 1];
export type Mat4 = readonly number[]; // length 16, column-major
export class NodeSocketMatrix extends NodeSocket<Mat4> {
  static override bl_idname = 'NodeSocketMatrix';
  static override bl_label = 'Matrix';
  static override kind: SocketKind = 'MATRIX';
  static override color: RGBA = MAT_COLOR;
  override default_value: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/* ------------------------------------------------------------------ */
/*  Color (RGBA, linear)                                              */
/* ------------------------------------------------------------------ */
const COLOR_COLOR: RGBA = [0.78, 0.78, 0.16, 1];
export class NodeSocketColor extends NodeSocket<RGBA> {
  static override bl_idname = 'NodeSocketColor';
  static override bl_label = 'Color';
  static override kind: SocketKind = 'RGBA';
  static override color: RGBA = COLOR_COLOR;
  override default_value: RGBA = [1, 1, 1, 1];
  override coerceFrom(other: NodeSocket): RGBA {
    const v = other.value;
    if (Array.isArray(v)) {
      if (v.length >= 4) return [v[0]!, v[1]!, v[2]!, v[3]!] as RGBA;
      if (v.length >= 3) return [v[0]!, v[1]!, v[2]!, 1] as RGBA;
    }
    if (typeof v === 'number') return [v, v, v, 1];
    return [0, 0, 0, 1];
  }
}

/* ------------------------------------------------------------------ */
/*  String                                                            */
/* ------------------------------------------------------------------ */
const STR_COLOR: RGBA = [0.27, 0.59, 0.78, 1];
export class NodeSocketString extends NodeSocket<string> {
  static override bl_idname = 'NodeSocketString';
  static override bl_label = 'String';
  static override kind: SocketKind = 'STRING';
  static override color: RGBA = STR_COLOR;
  override default_value = '';
}
export class NodeSocketStringFilepath extends NodeSocketString {
  static override bl_idname = 'NodeSocketStringFilepath';
}

/* ------------------------------------------------------------------ */
/*  Shader (BSDF closure handle)                                      */
/* ------------------------------------------------------------------ */
const SHADER_COLOR: RGBA = [0.39, 0.78, 0.39, 1];
/**
 * Opaque structured handle representing a closure (color contribution +
 * possible per-component channels). The ShaderEvaluator interprets these
 * during TSL emission. We keep the runtime payload flexible.
 */
export type ShaderClosure = unknown;
export class NodeSocketShader extends NodeSocket<ShaderClosure> {
  static override bl_idname = 'NodeSocketShader';
  static override bl_label = 'Shader';
  static override kind: SocketKind = 'SHADER';
  static override color: RGBA = SHADER_COLOR;
  override default_value: ShaderClosure = null;
}

/* ------------------------------------------------------------------ */
/*  Geometry                                                          */
/* ------------------------------------------------------------------ */
const GEO_COLOR: RGBA = [0, 0.66, 0.85, 1];
export type GeometryBlob = unknown; // typed in src/eval/geometry/Geometry.ts
export class NodeSocketGeometry extends NodeSocket<GeometryBlob> {
  static override bl_idname = 'NodeSocketGeometry';
  static override bl_label = 'Geometry';
  static override kind: SocketKind = 'GEOMETRY';
  static override color: RGBA = GEO_COLOR;
  override default_value: GeometryBlob = null;
}

/* ------------------------------------------------------------------ */
/*  Object / Collection / Material / Image / Texture (data refs)      */
/* ------------------------------------------------------------------ */
const REF_COLOR: RGBA = [1, 0.55, 0.2, 1];
export class NodeSocketObject extends NodeSocket<string | null> {
  static override bl_idname = 'NodeSocketObject';
  static override bl_label = 'Object';
  static override kind: SocketKind = 'OBJECT';
  static override color: RGBA = REF_COLOR;
  override default_value: string | null = null;
}
export class NodeSocketCollection extends NodeSocket<string | null> {
  static override bl_idname = 'NodeSocketCollection';
  static override bl_label = 'Collection';
  static override kind: SocketKind = 'COLLECTION';
  static override color: RGBA = REF_COLOR;
  override default_value: string | null = null;
}
export class NodeSocketMaterial extends NodeSocket<string | null> {
  static override bl_idname = 'NodeSocketMaterial';
  static override bl_label = 'Material';
  static override kind: SocketKind = 'MATERIAL';
  static override color: RGBA = REF_COLOR;
  override default_value: string | null = null;
}
export class NodeSocketImage extends NodeSocket<string | null> {
  static override bl_idname = 'NodeSocketImage';
  static override bl_label = 'Image';
  static override kind: SocketKind = 'IMAGE';
  static override color: RGBA = REF_COLOR;
  override default_value: string | null = null;
}
export class NodeSocketTexture extends NodeSocket<string | null> {
  static override bl_idname = 'NodeSocketTexture';
  static override bl_label = 'Texture';
  static override kind: SocketKind = 'TEXTURE';
  static override color: RGBA = REF_COLOR;
  override default_value: string | null = null;
}

/* ------------------------------------------------------------------ */
/*  Menu (enum)                                                       */
/* ------------------------------------------------------------------ */
const MENU_COLOR: RGBA = [0.55, 0.55, 0.55, 1];
export class NodeSocketMenu extends NodeSocket<string> {
  static override bl_idname = 'NodeSocketMenu';
  static override bl_label = 'Menu';
  static override kind: SocketKind = 'MENU';
  static override color: RGBA = MENU_COLOR;
  override default_value = '';
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */
const ALL = [
  NodeSocketFloat,
  NodeSocketFloatFactor,
  NodeSocketFloatAngle,
  NodeSocketFloatPercentage,
  NodeSocketFloatTime,
  NodeSocketFloatDistance,
  NodeSocketFloatUnsigned,
  NodeSocketInt,
  NodeSocketIntUnsigned,
  NodeSocketBool,
  NodeSocketVector,
  NodeSocketVectorXYZ,
  NodeSocketVectorDirection,
  NodeSocketVectorEuler,
  NodeSocketVectorTranslation,
  NodeSocketVectorVelocity,
  NodeSocketVectorAcceleration,
  NodeSocketRotation,
  NodeSocketMatrix,
  NodeSocketColor,
  NodeSocketString,
  NodeSocketStringFilepath,
  NodeSocketShader,
  NodeSocketGeometry,
  NodeSocketObject,
  NodeSocketCollection,
  NodeSocketMaterial,
  NodeSocketImage,
  NodeSocketTexture,
  NodeSocketMenu,
] as const;

let _registered = false;
export function registerBuiltinSockets(): void {
  if (_registered) return;
  _registered = true;
  for (const Cls of ALL) NodeRegistry.registerSocket(Cls as unknown as Parameters<typeof NodeRegistry.registerSocket>[0]);
}
