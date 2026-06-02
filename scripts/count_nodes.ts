import { bootstrapBuiltins, NodeRegistry } from '../src';
bootstrapBuiltins();
const all = NodeRegistry.listAllNodes();
console.log('Total registered node classes:', all.length);
const byCategory: Record<string, number> = {};
for (const n of all) {
  const c = (n as { category?: string }).category ?? 'Misc';
  byCategory[c] = (byCategory[c] ?? 0) + 1;
}
console.log('By category:');
for (const [k, v] of Object.entries(byCategory).sort()) console.log(`  ${k}: ${v}`);
const trees = ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree', 'TextureNodeTree'] as const;
for (const t of trees) {
  console.log(`Nodes for ${t}:`, NodeRegistry.listForTree(t).length);
}
console.log('Sockets:', NodeRegistry.listAllSockets().length);
