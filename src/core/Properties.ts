/**
 * Mirror of bpy.props.* — declarative property descriptors.
 *
 * In Blender:
 *   class MyNode(bpy.types.Node):
 *       my_float: bpy.props.FloatProperty(default=1.0)
 *
 * In our system:
 *   class MyNode extends Node {
 *     static properties = {
 *       my_float: FloatProperty({ default: 1.0 }),
 *     };
 *     declare my_float: number;
 *   }
 *
 * The base Node constructor reads `static properties` and installs
 * matching instance fields, complete with `update` callbacks for
 * triggering re-evaluation.
 */

import type { Node } from './Node';

export type PropertyKind =
  | 'FLOAT'
  | 'INT'
  | 'BOOL'
  | 'STRING'
  | 'ENUM'
  | 'VECTOR'
  | 'COLOR'
  | 'POINTER';

export interface BaseProperty<T> {
  kind: PropertyKind;
  default: T;
  name?: string;
  description?: string;
  /** Called after the property changes; typically marks the depsgraph dirty. */
  update?: (node: Node) => void;
}

export interface FloatPropertyOpts {
  default?: number;
  min?: number;
  max?: number;
  soft_min?: number;
  soft_max?: number;
  step?: number;
  precision?: number;
  /** 'NONE'|'FACTOR'|'ANGLE'|'PERCENTAGE'|'TIME'|'DISTANCE'|'UNSIGNED' */
  subtype?: 'NONE' | 'FACTOR' | 'ANGLE' | 'PERCENTAGE' | 'TIME' | 'DISTANCE' | 'UNSIGNED';
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface FloatProperty extends BaseProperty<number> {
  kind: 'FLOAT';
  min?: number;
  max?: number;
  soft_min?: number;
  soft_max?: number;
  step?: number;
  precision?: number;
  subtype?: FloatPropertyOpts['subtype'];
}

export function FloatProperty(opts: FloatPropertyOpts = {}): FloatProperty {
  return {
    kind: 'FLOAT',
    default: opts.default ?? 0,
    min: opts.min,
    max: opts.max,
    soft_min: opts.soft_min,
    soft_max: opts.soft_max,
    step: opts.step,
    precision: opts.precision,
    subtype: opts.subtype ?? 'NONE',
    name: opts.name,
    description: opts.description,
    update: opts.update,
  };
}

export interface IntPropertyOpts {
  default?: number;
  min?: number;
  max?: number;
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface IntProperty extends BaseProperty<number> {
  kind: 'INT';
  min?: number;
  max?: number;
}
export function IntProperty(opts: IntPropertyOpts = {}): IntProperty {
  return { kind: 'INT', default: opts.default ?? 0, min: opts.min, max: opts.max, name: opts.name, description: opts.description, update: opts.update };
}

export interface BoolPropertyOpts {
  default?: boolean;
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface BoolProperty extends BaseProperty<boolean> {
  kind: 'BOOL';
}
export function BoolProperty(opts: BoolPropertyOpts = {}): BoolProperty {
  return { kind: 'BOOL', default: opts.default ?? false, name: opts.name, description: opts.description, update: opts.update };
}

export interface StringPropertyOpts {
  default?: string;
  /** 'NONE'|'FILE_PATH'|'DIR_PATH'|'FILE_NAME' */
  subtype?: 'NONE' | 'FILE_PATH' | 'DIR_PATH' | 'FILE_NAME';
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface StringProperty extends BaseProperty<string> {
  kind: 'STRING';
  subtype?: StringPropertyOpts['subtype'];
}
export function StringProperty(opts: StringPropertyOpts = {}): StringProperty {
  return { kind: 'STRING', default: opts.default ?? '', subtype: opts.subtype ?? 'NONE', name: opts.name, description: opts.description, update: opts.update };
}

export type EnumItem = readonly [identifier: string, name: string, description: string];
export interface EnumPropertyOpts {
  items: readonly EnumItem[];
  default?: string;
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface EnumProperty extends BaseProperty<string> {
  kind: 'ENUM';
  items: readonly EnumItem[];
}
export function EnumProperty(opts: EnumPropertyOpts): EnumProperty {
  const def = opts.default ?? opts.items[0]?.[0] ?? '';
  return { kind: 'ENUM', default: def, items: opts.items, name: opts.name, description: opts.description, update: opts.update };
}

export interface VectorPropertyOpts {
  default?: readonly number[];
  size?: 2 | 3 | 4;
  min?: number;
  max?: number;
  subtype?: 'NONE' | 'XYZ' | 'DIRECTION' | 'EULER' | 'TRANSLATION' | 'VELOCITY' | 'ACCELERATION';
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface VectorProperty extends BaseProperty<number[]> {
  kind: 'VECTOR';
  size: 2 | 3 | 4;
  min?: number;
  max?: number;
  subtype?: VectorPropertyOpts['subtype'];
}
export function FloatVectorProperty(opts: VectorPropertyOpts = {}): VectorProperty {
  const size = opts.size ?? 3;
  const def =
    (opts.default as number[]) ??
    (Array(size).fill(0) as number[]);
  return {
    kind: 'VECTOR',
    size,
    default: def,
    min: opts.min,
    max: opts.max,
    subtype: opts.subtype ?? 'NONE',
    name: opts.name,
    description: opts.description,
    update: opts.update,
  };
}

export interface ColorPropertyOpts {
  default?: readonly [number, number, number, number];
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface ColorProperty extends BaseProperty<number[]> {
  kind: 'COLOR';
}
export function ColorProperty(opts: ColorPropertyOpts = {}): ColorProperty {
  const def = opts.default ? ([...opts.default] as number[]) : [1, 1, 1, 1];
  return { kind: 'COLOR', default: def, name: opts.name, description: opts.description, update: opts.update };
}

export interface PointerPropertyOpts {
  type: unknown;
  name?: string;
  description?: string;
  update?: (node: Node) => void;
}
export interface PointerProperty extends BaseProperty<unknown> {
  kind: 'POINTER';
  type: unknown;
}
export function PointerProperty(opts: PointerPropertyOpts): PointerProperty {
  return { kind: 'POINTER', default: null, type: opts.type, name: opts.name, description: opts.description, update: opts.update };
}

export type PropertyDescriptor =
  | FloatProperty
  | IntProperty
  | BoolProperty
  | StringProperty
  | EnumProperty
  | VectorProperty
  | ColorProperty
  | PointerProperty;

export type PropertyMap = Record<string, PropertyDescriptor>;
