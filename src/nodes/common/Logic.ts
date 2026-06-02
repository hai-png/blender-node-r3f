/**
 * Boolean Math, Compare, Switch, Random Value.
 * Mirrors FunctionNodeBooleanMath, FunctionNodeCompare, GeometryNodeSwitch,
 * FunctionNodeRandomValue (all available in all systems since 4.x).
 */
import { Node, type NodeInitContext } from '../../core/Node';
import { EnumProperty } from '../../core/Properties';
import type { NodeTreeKind, Vec3, RGBA } from '../../core/types';
import {
  NodeSocketBool, NodeSocketColor, NodeSocketFloat, NodeSocketInt, NodeSocketVector,
} from '../../sockets';
import { NodeRegistry } from '../../registry/NodeRegistry';

const BOOL_OPS = [
  ['AND', 'And', ''], ['OR', 'Or', ''], ['NOT', 'Not', ''],
  ['NAND', 'Not And', ''], ['NOR', 'Not Or', ''], ['XNOR', 'Equal', ''],
  ['XOR', 'Not Equal', ''], ['IMPLY', 'Imply', ''], ['NIMPLY', 'Subtract', ''],
] as const;

export class BooleanMathNode extends Node {
  static override bl_idname = 'FunctionNodeBooleanMath';
  static override bl_label = 'Boolean Math';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = { operation: EnumProperty({ items: BOOL_OPS, default: 'AND', name: 'Operation' }) };
  declare operation: typeof BOOL_OPS[number][0];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketBool, 'Boolean', { identifier: 'Boolean' });
    this.addInput(NodeSocketBool, 'Boolean', { identifier: 'Boolean_001' });
    this.addOutput(NodeSocketBool, 'Boolean');
  }

  static compute(op: BooleanMathNode['operation'], a: boolean, b: boolean): boolean {
    switch (op) {
      case 'AND': return a && b;
      case 'OR': return a || b;
      case 'NOT': return !a;
      case 'NAND': return !(a && b);
      case 'NOR': return !(a || b);
      case 'XNOR': return a === b;
      case 'XOR': return a !== b;
      case 'IMPLY': return !a || b;
      case 'NIMPLY': return a && !b;
    }
  }
}

const COMPARE_OPS = [
  ['LESS_THAN', 'Less Than', ''],
  ['LESS_EQUAL', 'Less Than or Equal', ''],
  ['GREATER_THAN', 'Greater Than', ''],
  ['GREATER_EQUAL', 'Greater Than or Equal', ''],
  ['EQUAL', 'Equal', ''],
  ['NOT_EQUAL', 'Not Equal', ''],
] as const;
const COMPARE_TYPES = [
  ['FLOAT', 'Float', ''], ['INT', 'Integer', ''], ['VECTOR', 'Vector', ''],
  ['STRING', 'String', ''], ['RGBA', 'Color', ''],
] as const;

export class CompareNode extends Node {
  static override bl_idname = 'FunctionNodeCompare';
  static override bl_label = 'Compare';
  static override category = 'Converter';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = {
    operation: EnumProperty({ items: COMPARE_OPS, default: 'GREATER_THAN', name: 'Operation' }),
    data_type: EnumProperty({ items: COMPARE_TYPES, default: 'FLOAT', name: 'Type' }),
  };
  declare operation: typeof COMPARE_OPS[number][0];
  declare data_type: typeof COMPARE_TYPES[number][0];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketFloat, 'A', { identifier: 'A' });
    this.addInput(NodeSocketFloat, 'B', { identifier: 'B' });
    this.addInput(NodeSocketFloat, 'Epsilon', { default_value: 0.001 });
    this.addOutput(NodeSocketBool, 'Result');
  }

  static compute(op: CompareNode['operation'], a: number, b: number, eps = 0): boolean {
    switch (op) {
      case 'LESS_THAN': return a < b;
      case 'LESS_EQUAL': return a <= b;
      case 'GREATER_THAN': return a > b;
      case 'GREATER_EQUAL': return a >= b;
      case 'EQUAL': return Math.abs(a - b) <= eps;
      case 'NOT_EQUAL': return Math.abs(a - b) > eps;
    }
  }

  /** Vector comparison: compares component-wise, returns true if ALL components satisfy. */
  static computeVec(
    op: CompareNode['operation'],
    a: Vec3, b: Vec3, eps = 0,
  ): boolean {
    for (let i = 0; i < 3; i++) {
      if (!CompareNode.compute(op, a[i] ?? 0, b[i] ?? 0, eps)) return false;
    }
    return true;
  }

  /** Color comparison: compares RGBA channels with epsilon tolerance. */
  static computeColor(
    op: CompareNode['operation'],
    a: RGBA, b: RGBA, eps = 0,
  ): boolean {
    for (let i = 0; i < 4; i++) {
      if (!CompareNode.compute(op, a[i] ?? 0, b[i] ?? 0, eps)) return false;
    }
    return true;
  }
}

const SWITCH_TYPES = [
  ['FLOAT', 'Float', ''], ['INT', 'Integer', ''], ['BOOLEAN', 'Boolean', ''],
  ['VECTOR', 'Vector', ''], ['RGBA', 'Color', ''], ['STRING', 'String', ''],
  ['GEOMETRY', 'Geometry', ''],
] as const;

export class SwitchNode extends Node {
  static override bl_idname = 'GeometryNodeSwitch';
  static override bl_label = 'Switch';
  static override category = 'Utilities';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = {
    input_type: EnumProperty({ items: SWITCH_TYPES, default: 'FLOAT', name: 'Type' }),
  };
  declare input_type: typeof SWITCH_TYPES[number][0];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketBool, 'Switch');
    this.addInput(NodeSocketFloat, 'False', { identifier: 'False' });
    this.addInput(NodeSocketFloat, 'True', { identifier: 'True' });
    this.addOutput(NodeSocketFloat, 'Output');
  }
}

const RV_TYPES = [
  ['FLOAT_VECTOR', 'Vector', ''], ['FLOAT', 'Float', ''],
  ['INT', 'Integer', ''], ['BOOLEAN', 'Boolean', ''],
] as const;

export class RandomValueNode extends Node {
  static override bl_idname = 'FunctionNodeRandomValue';
  static override bl_label = 'Random Value';
  static override category = 'Utilities';
  static override tree_types: NodeTreeKind[] = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'];
  static override properties = { data_type: EnumProperty({ items: RV_TYPES, default: 'FLOAT', name: 'Type' }) };
  declare data_type: typeof RV_TYPES[number][0];

  override init(_ctx: NodeInitContext): void {
    this.addInput(NodeSocketVector, 'Min', { identifier: 'Min_Vector', default_value: [0, 0, 0] });
    this.addInput(NodeSocketVector, 'Max', { identifier: 'Max_Vector', default_value: [1, 1, 1] });
    this.addInput(NodeSocketFloat, 'Min', { default_value: 0 });
    this.addInput(NodeSocketFloat, 'Max', { default_value: 1 });
    this.addInput(NodeSocketInt, 'Min', { identifier: 'Min_Int', default_value: 0 });
    this.addInput(NodeSocketInt, 'Max', { identifier: 'Max_Int', default_value: 100 });
    this.addInput(NodeSocketFloat, 'Probability', { default_value: 0.5 });
    this.addInput(NodeSocketInt, 'ID', { default_value: 0 });
    this.addInput(NodeSocketInt, 'Seed', { default_value: 0 });
    this.addOutput(NodeSocketVector, 'Value', { identifier: 'Value_Vector' });
    this.addOutput(NodeSocketFloat, 'Value');
    this.addOutput(NodeSocketInt, 'Value', { identifier: 'Value_Int' });
    this.addOutput(NodeSocketBool, 'Value', { identifier: 'Value_Bool' });
  }

  static hash(id: number, seed: number): number {
    let n = ((id * 73856093) ^ (seed * 19349663)) >>> 0;
    n = ((n ^ (n >>> 13)) * 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
  }
}

// Suppress unused warning for COLOR import; useful for future Compare(Color) overload
void NodeSocketColor;
void ({} as Vec3 | undefined);

let _registered = false;
export function registerLogicNodes(): void {
  if (_registered) return;
  _registered = true;
  for (const cls of [BooleanMathNode, CompareNode, SwitchNode, RandomValueNode]) {
    NodeRegistry.register(cls as unknown as Parameters<typeof NodeRegistry.register>[0]);
  }
}
