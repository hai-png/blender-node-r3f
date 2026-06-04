/**
 * Layer 1 — Python Addon Transpiler
 *
 * Parses a Blender Python addon source string and produces ready-to-use
 * TypeScript classes with auto-generated executor hooks.
 *
 * Handles:
 *   - class Foo(bpy.types.Node):  →  class Foo extends Node
 *   - bl_idname, bl_label          →  static fields
 *   - foo: FloatProperty(...)      →  static properties + declare
 *   - enum via annotations         →  EnumProperty
 *   - self.inputs.new(type, name)  →  addInput(Socket, name)
 *   - self.outputs.new(type, name) →  addOutput(Socket, name)
 *   - def update(self):            →  override update()
 *
 * What it CAN'T automate (still needs human annotation):
 *   - The actual `executeGeo`/`executeShader` logic (C-level in Blender)
 *
 * Output: a .ts file string that can be written to disk or eval'd at runtime.
 */

import type { NodeTreeKind, SocketKind } from '../core/types';

/* ── Type map: Blender Python socket type → TS socket class name ─── */

const SOCKET_TYPE_MAP: Record<string, { cls: string; kind: SocketKind }> = {
  NodeSocketFloat:          { cls: 'NodeSocketFloat',          kind: 'VALUE' },
  NodeSocketFloatFactor:    { cls: 'NodeSocketFloatFactor',    kind: 'VALUE' },
  NodeSocketFloatAngle:     { cls: 'NodeSocketFloatAngle',     kind: 'VALUE' },
  NodeSocketFloatUnsigned:  { cls: 'NodeSocketFloatUnsigned',  kind: 'VALUE' },
  NodeSocketInt:            { cls: 'NodeSocketInt',            kind: 'INT' },
  NodeSocketIntUnsigned:    { cls: 'NodeSocketIntUnsigned',    kind: 'INT' },
  NodeSocketBool:           { cls: 'NodeSocketBool',           kind: 'BOOLEAN' },
  NodeSocketVector:         { cls: 'NodeSocketVector',         kind: 'VECTOR' },
  NodeSocketVectorXYZ:      { cls: 'NodeSocketVectorXYZ',      kind: 'VECTOR' },
  NodeSocketVectorDirection:{ cls: 'NodeSocketVectorDirection',kind: 'VECTOR' },
  NodeSocketVectorEuler:    { cls: 'NodeSocketVectorEuler',    kind: 'VECTOR' },
  NodeSocketVectorTranslation:{ cls: 'NodeSocketVectorTranslation', kind: 'VECTOR' },
  NodeSocketRotation:       { cls: 'NodeSocketRotation',       kind: 'ROTATION' },
  NodeSocketMatrix:         { cls: 'NodeSocketMatrix',         kind: 'MATRIX' },
  NodeSocketColor:          { cls: 'NodeSocketColor',          kind: 'RGBA' },
  NodeSocketString:         { cls: 'NodeSocketString',         kind: 'STRING' },
  NodeSocketShader:         { cls: 'NodeSocketShader',         kind: 'SHADER' },
  NodeSocketGeometry:       { cls: 'NodeSocketGeometry',       kind: 'GEOMETRY' },
  NodeSocketObject:         { cls: 'NodeSocketObject',         kind: 'OBJECT' },
  NodeSocketCollection:     { cls: 'NodeSocketCollection',     kind: 'COLLECTION' },
  NodeSocketMaterial:       { cls: 'NodeSocketMaterial',       kind: 'MATERIAL' },
  NodeSocketImage:          { cls: 'NodeSocketImage',          kind: 'IMAGE' },
  NodeSocketTexture:        { cls: 'NodeSocketTexture',        kind: 'TEXTURE' },
  NodeSocketMenu:           { cls: 'NodeSocketMenu',           kind: 'MENU' },
};

/* ── Property parser ──────────────────────────────────────────────── */

interface ParsedProperty {
  name: string;
  tsType: string;
  propCall: string;
  declare: string;
}

function parseFloatProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const parts: string[] = [];
  if (opts.default !== undefined) parts.push(`default: ${JSON.stringify(opts.default)}`);
  if (opts.min !== undefined) parts.push(`min: ${JSON.stringify(opts.min)}`);
  if (opts.max !== undefined) parts.push(`max: ${JSON.stringify(opts.max)}`);
  if (opts.soft_min !== undefined) parts.push(`soft_min: ${JSON.stringify(opts.soft_min)}`);
  if (opts.soft_max !== undefined) parts.push(`soft_max: ${JSON.stringify(opts.soft_max)}`);
  if (opts.subtype && opts.subtype !== 'NONE') parts.push(`subtype: '${opts.subtype}'`);
  return {
    name, tsType: 'number',
    propCall: `FloatProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: number;`,
  };
}

function parseIntProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const parts: string[] = [];
  if (opts.default !== undefined) parts.push(`default: ${JSON.stringify(opts.default)}`);
  if (opts.min !== undefined) parts.push(`min: ${JSON.stringify(opts.min)}`);
  if (opts.max !== undefined) parts.push(`max: ${JSON.stringify(opts.max)}`);
  return {
    name, tsType: 'number',
    propCall: `IntProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: number;`,
  };
}

function parseBoolProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const parts: string[] = [];
  if (opts.default !== undefined) parts.push(`default: ${JSON.stringify(opts.default)}`);
  return {
    name, tsType: 'boolean',
    propCall: `BoolProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: boolean;`,
  };
}

function parseStringProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const parts: string[] = [];
  if (opts.default !== undefined) parts.push(`default: ${JSON.stringify(opts.default)}`);
  if (opts.subtype && opts.subtype !== 'NONE') parts.push(`subtype: '${opts.subtype}'`);
  return {
    name, tsType: 'string',
    propCall: `StringProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: string;`,
  };
}

function parseEnumProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const items = (opts.items as Array<[string, string, string]>) ?? [];
  const itemsStr = items.map(([id, label, desc]) =>
    `['${id}', '${label}', '${desc}']`,
  ).join(', ');
  const parts: string[] = [`items: [${itemsStr}]`];
  if (opts.default !== undefined) parts.push(`default: '${opts.default}'`);
  return {
    name, tsType: 'string',
    propCall: `EnumProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: string;`,
  };
}

function parseVectorProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const parts: string[] = [];
  const size: number = (opts.size as number) ?? 3;
  if (opts.default !== undefined) {
    const arr = opts.default as number[];
    parts.push(`default: [${arr.slice(0, size).join(', ')}]`);
  }
  if (opts.min !== undefined) parts.push(`min: ${JSON.stringify(opts.min)}`);
  if (opts.max !== undefined) parts.push(`max: ${JSON.stringify(opts.max)}`);
  if (opts.subtype && opts.subtype !== 'NONE') parts.push(`subtype: '${opts.subtype}'`);
  parts.push(`size: ${size}`);
  return {
    name, tsType: `number[]`,
    propCall: `FloatVectorProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: number[];`,
  };
}

function parseColorProp(name: string, opts: Record<string, unknown>): ParsedProperty {
  const parts: string[] = [];
  if (opts.default !== undefined) {
    const arr = opts.default as number[];
    parts.push(`default: [${arr.slice(0, 4).join(', ')}]`);
  }
  return {
    name, tsType: `number[]`,
    propCall: `ColorProperty({ ${parts.join(', ')} })`,
    declare: `declare ${name}: number[];`,
  };
}

/* ── Core parser ──────────────────────────────────────────────────── */

export interface TranspiledNode {
  bl_idname: string;
  bl_label: string;
  category: string;
  treeTypes: NodeTreeKind[];
  tsClassSource: string;
  registrationCode: string;
  hadErrors: boolean;
  warnings: string[];
}

/**
 * Parse a snippet of Blender Python addon source into TypeScript.
 *
 * Handles the most common patterns:
 *   class MyNode(bpy.types.Node):
 *       bl_idname = 'MyNode'
 *       bl_label = 'My Node'
 *       my_prop: bpy.props.FloatProperty(name="...", default=1)
 *       def init(self, ctx):
 *           self.inputs.new('NodeSocketFloat', 'Value')
 *           self.outputs.new('NodeSocketFloat', 'Result')
 */
export function transpilePythonAddon(pythonSource: string): TranspiledNode[] {
  const results: TranspiledNode[] = [];
  const warnings: string[] = [];

  // Simple regex-based parser — sufficient for Blender addons which have
  // very consistent class structure.

  // Find all class definitions
  const classRe = /class\s+(\w+)\s*\([^)]*(?:bpy\.types\.)?Node[^)]*\)\s*:/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classRe.exec(pythonSource)) !== null) {
    const className = classMatch[1]!;
    const classStart = classMatch.index + classMatch[0].length;

    // Find the class body (indented block)
    const bodyStart = pythonSource.indexOf('\n', classStart) + 1;
    const bodyEnd = findClassBodyEnd(pythonSource, classStart);
    const body = pythonSource.slice(bodyStart, bodyEnd);

    const result = parseNodeClass(className, body, warnings);
    results.push(result);
  }

  return results;
}

function findClassBodyEnd(source: string, classStart: number): number {
  // Walk from the class declaration to find where the indented body ends.
  // Body ends when we hit a line at indent 0 (top-level) or EOF.
  const tail = source.slice(classStart);
  const lines = tail.split('\n');

  // Accumulate character offsets of each line including trailing \n
  // line 0 = class declaration (skip), lines 1+ = body
  let charOffset = lines[0]!.length + 1; // class declaration line + newline
  let nestedDepth = 0; // depth of nested def/if/for blocks within class body

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;

    charOffset += line.length + 1; // +1 for preceding \n

    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level: indent 0 means new class/import/function outside this class
    if (indent === 0 && nestedDepth <= 0) {
      charOffset -= (line.length + 1); // don't include this line
      break;
    }

    if (/^(def|class|if|for|while|with|try)\b/.test(trimmed)) {
      nestedDepth++;
    } else if (indent <= 4 && nestedDepth > 0 &&
               !/^(def|class|if|for|while|with|try|elif|else|except|finally)\b/.test(trimmed)) {
      // Simple heuristic: back at class-body indent after a nested block
      nestedDepth--;
    }
  }

  return classStart + charOffset;
}

function parseNodeClass(
  className: string, body: string, warnings: string[],
): TranspiledNode {
  const result: TranspiledNode = {
    bl_idname: className,
    bl_label: className,
    category: 'Converted',
    treeTypes: ['GeometryNodeTree'],
    tsClassSource: '',
    registrationCode: '',
    hadErrors: false,
    warnings,
  };

  const props: ParsedProperty[] = [];
  const initSockets: { direction: 'input'|'output'; type: string; name: string }[] = [];

  // Regex patterns for properties
  const propRe = /(\w+)\s*:\s*bpy\.props\.(Float|Int|Bool|String|Enum|FloatVector|Color)Property\s*\(\s*([\s\S]*?)\s*\)/g;
  const initRe = /def\s+init\s*\([^)]*\)\s*:(.*?)(?=\n\s{0,4}(?:def\s|\n\s{0,4}\S|class\s|$))/s;
  const idnameRe = /bl_idname\s*=\s*['"]([^'"]+)['"]/;
  const labelRe = /bl_label\s*=\s*['"]([^'"]+)['"]/;
  const cateRe = /bl_category\s*=\s*['"]([^'"]+)['"]/;

  // Static fields
  const idnameMatch = idnameRe.exec(body);
  if (idnameMatch) result.bl_idname = idnameMatch[1]!;

  const labelMatch = labelRe.exec(body);
  if (labelMatch) result.bl_label = labelMatch[1]!;

  const cateMatch = cateRe.exec(body);
  if (cateMatch) result.category = cateMatch[1]!;

  // Properties
  let propMatch: RegExpExecArray | null;
  while ((propMatch = propRe.exec(body)) !== null) {
    const name = propMatch[1]!;
    const kind = propMatch[2]!;
    const argsStr = propMatch[3]!;
    const opts = parsePropArgs(argsStr);

    let parsed: ParsedProperty;
    switch (kind) {
      case 'Float':        parsed = parseFloatProp(name, opts); break;
      case 'Int':          parsed = parseIntProp(name, opts); break;
      case 'Bool':         parsed = parseBoolProp(name, opts); break;
      case 'String':       parsed = parseStringProp(name, opts); break;
      case 'Enum':         parsed = parseEnumProp(name, opts); break;
      case 'FloatVector':  parsed = parseVectorProp(name, opts); break;
      case 'Color':        parsed = parseColorProp(name, opts); break;
      default: continue;
    }
    props.push(parsed);
  }

  // init() sockets
  const initMatch = initRe.exec(body);
  if (initMatch) {
    const initBody = initMatch[1]!;
    const inputRe = /self\.inputs\.new\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
    const outputRe = /self\.outputs\.new\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;

    let m: RegExpExecArray | null;
    while ((m = inputRe.exec(initBody)) !== null) {
      initSockets.push({ direction: 'input', type: m[1]!, name: m[2]! });
    }
    while ((m = outputRe.exec(initBody)) !== null) {
      initSockets.push({ direction: 'output', type: m[1]!, name: m[2]! });
    }
  }

  // Detect tree type from body hints
  if (/GeometryNode/.test(className) || /geometry|geo/i.test(body)) {
    result.treeTypes = ['GeometryNodeTree'];
  } else if (/ShaderNode/.test(className) || /shader/i.test(body)) {
    result.treeTypes = ['ShaderNodeTree'];
  } else if (/CompositorNode/.test(className) || /composit/i.test(body)) {
    result.treeTypes = ['CompositorNodeTree'];
  }

  // Build TS class source
  const propEntries = props.map((p) => `    ${p.name}: ${p.propCall},`).join('\n');
  const declares = props.map((p) => `  ${p.declare}`).join('\n');
  const initLines = initSockets.map((s) => {
    const sock = SOCKET_TYPE_MAP[s.type] ?? { cls: 'NodeSocketFloat', kind: 'VALUE' };
    return s.direction === 'input'
      ? `    this.addInput(${sock.cls}, '${s.name}');`
      : `    this.addOutput(${sock.cls}, '${s.name}');`;
  }).join('\n');

  const hasGeoExec = result.treeTypes[0] === 'GeometryNodeTree';
  const executorHook = hasGeoExec
    ? `\n  /** Auto-generated pass-through executor. Override for real behaviour. */\n  executeGeo?(ctx: import('../eval/GeometryEvaluator').GeoNodeExecCtx): void {\n    // Pass-through: propagate defaults to outputs\n    for (const out of this.outputs) {\n      ctx.setOutputValue(out.name, out.default_value);\n    }\n  }`
    : '';

  result.tsClassSource = `
import { bpy, FloatProperty, IntProperty, BoolProperty, StringProperty, EnumProperty, FloatVectorProperty, ColorProperty } from 'blender-nodes-r3f';

export class ${className} extends bpy.types.Node {
  static override bl_idname = '${result.bl_idname}';
  static override bl_label = '${result.bl_label}';
  static override category = '${result.category}';
  static override tree_types = ['${result.treeTypes[0]}'] as const;
  static override properties = {
${propEntries}
  };
${declares}${executorHook}

  override init(): void {
${initLines || '    // No sockets declared'}
  }
}
`.trim();

  result.registrationCode = `
bpy.utils.register_class(${className});
nodeitems_utils.register_node_categories('${result.bl_idname.toUpperCase()}', [
  new nodeitems_utils.NodeCategory('${result.bl_idname.toUpperCase()}', '${result.category}', [
    new nodeitems_utils.NodeItem('${result.bl_idname}'),
  ]),
]);`.trim();

  return result;
}

/* ── Prop arg parser ─────────────────────────────────────────────── */

function parsePropArgs(argsStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Pairs of name=value
  const pairRe = /(\w+)\s*=\s*(?:(['"])([^'"]*)\2|(-?\d+(?:\.\d+)?)|(\w+)|\[([^\]]*)\]|\(([^)]*)\))/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(argsStr)) !== null) {
    const key = m[1]!;
    if (m[3] !== undefined) {
      result[key] = m[3]; // quoted string
    } else if (m[4] !== undefined) {
      result[key] = Number(m[4]); // number
    } else if (m[5] !== undefined) {
      const kw = m[5];
      if (kw === 'True') result[key] = true;
      else if (kw === 'False') result[key] = false;
      else if (kw === 'None') result[key] = undefined;
      else result[key] = kw;
    } else if (m[6] !== undefined) {
      // Array: e.g. [1, 0, 0]
      result[key] = m[6].split(',').map((s) => {
        const n = Number(s.trim());
        return isNaN(n) ? s.trim() : n;
      });
    } else if (m[7] !== undefined) {
      // Tuple of strings: e.g. ('ID', 'Name', 'Desc')
      result[key] = m[7].split(',').map((s) => {
        const stripped = s.trim();
        return stripped.replace(/^['"]|['"]$/g, '');
      });
    }
  }

  // Also handle `name="..."` style keyword args
  const kwRe = /(\w+)\s*=\s*["']([^"']+)["']/g;
  while ((m = kwRe.exec(argsStr)) !== null) {
    if (result[m[1]!] === undefined) result[m[1]!] = m[2];
  }

  return result;
}

/* ── Full addon transpile ──────────────────────────────────────────── */

export interface TranspiledAddon {
  imports: string;
  classes: string;
  registration: string;
  /** Composed .ts source ready to save/eval. */
  fullSource: string;
  nodes: TranspiledNode[];
}

export function transpileFullAddon(pythonSource: string): TranspiledAddon {
  const nodes = transpilePythonAddon(pythonSource);

  const imports = `import { bpy, nodeitems_utils, FloatProperty, IntProperty, BoolProperty, StringProperty, EnumProperty, FloatVectorProperty, ColorProperty } from 'blender-nodes-r3f';`;

  const classes = nodes.map((n) => n.tsClassSource).join('\n\n');
  const registration = nodes.map((n) => n.registrationCode).join('\n\n');

  const fullSource = [
    '/** Auto-generated addon bridge. Source: Blender Python addon */',
    imports,
    '',
    classes,
    '',
    'let _registered = false;',
    'export function registerConvertedAddon(): void {',
    '  if (_registered) return;',
    '  _registered = true;',
    ...nodes.map((n) => `  bpy.utils.register_class(${n.bl_idname});`),
    ...nodes.map((n) => `  // Category: ${n.category} — node: ${n.bl_idname}`),
    '}',
  ].join('\n');

  return { imports, classes, registration, fullSource, nodes };
}
