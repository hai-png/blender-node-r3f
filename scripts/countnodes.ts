import { bootstrapBuiltins, NodeRegistry } from '../src/index';
bootstrapBuiltins();
const all = NodeRegistry.listAllNodes();
const byTree: Record<string, string[]> = {};
for (const cls of all) {
  for (const t of cls.tree_types) {
    if (!byTree[t]) byTree[t] = [];
    byTree[t].push(cls.bl_idname);
  }
}
console.log('Total registered node classes:', all.length);
for (const t of Object.keys(byTree).sort()) {
  console.log(`  ${t}: ${byTree[t]!.length}`);
}
