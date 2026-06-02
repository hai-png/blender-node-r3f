/**
 * Right-click / Shift+A add menu.
 *
 * Uses two category sources:
 *   1. `nodeitems_utils` / `NodeCategories` registrations (addon-compatible)
 *   2. built-in static `Node.category` fallback for anything uncategorised
 */
import { useMemo, useState } from 'react';
import type { NodeTree } from '../core/NodeTree';
import type { NodeTreeKind } from '../core/types';
import { NodeCategories, NodeRegistry, type NodeItem } from '../registry/NodeRegistry';
import { useTreeStore } from './store';

export interface AddMenuEntry {
  bl_idname: string;
  label: string;
  category: string;
  settings?: Record<string, unknown>;
}

export interface AddMenuSection {
  category: string;
  items: AddMenuEntry[];
}

export function buildAddMenuSections(treeKind: NodeTreeKind, filter = ''): AddMenuSection[] {
  const query = filter.trim().toLowerCase();
  const sections: AddMenuSection[] = [];
  const covered = new Set<string>();

  const include = (label: string, bl_idname: string): boolean => {
    if (!query) return true;
    return label.toLowerCase().includes(query) || bl_idname.toLowerCase().includes(query);
  };

  // 1) Addon / nodeitems_utils categories first.
  for (const cat of NodeCategories.list(treeKind)) {
    const items: AddMenuEntry[] = [];
    for (const item of cat.items) {
      const NodeCls = NodeRegistry.getNode(item.bl_idname);
      if (!NodeCls) continue;
      const label = item.label ?? NodeCls.bl_label;
      if (!include(label, item.bl_idname)) continue;
      covered.add(item.bl_idname);
      items.push({
        bl_idname: item.bl_idname,
        label,
        category: cat.label,
        settings: item.settings,
      });
    }
    if (items.length > 0) sections.push({ category: cat.label, items });
  }

  // 2) Fallback static categories for everything else.
  const fallbackByCat = new Map<string, AddMenuEntry[]>();
  for (const NodeCls of NodeRegistry.listForTree(treeKind)) {
    if (covered.has(NodeCls.bl_idname)) continue;
    if (!include(NodeCls.bl_label, NodeCls.bl_idname)) continue;
    const cat = NodeCls.category ?? 'Misc';
    if (!fallbackByCat.has(cat)) fallbackByCat.set(cat, []);
    fallbackByCat.get(cat)!.push({
      bl_idname: NodeCls.bl_idname,
      label: NodeCls.bl_label,
      category: cat,
    });
  }
  for (const [category, items] of [...fallbackByCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    items.sort((a, b) => a.label.localeCompare(b.label));
    sections.push({ category, items });
  }

  return sections;
}

export function createNodeFromAddMenuEntry(tree: NodeTree, entry: AddMenuEntry, location: [number, number]): import('../core/Node').Node | null {
  const NodeCls = NodeRegistry.getNode(entry.bl_idname);
  if (!NodeCls) return null;
  const node = tree.addNode(NodeCls as Parameters<typeof tree.addNode>[0]);
  node.location = location;
  if (entry.settings) {
    for (const [k, v] of Object.entries(entry.settings)) {
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return node;
}

export function AddMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const tree = useTreeStore((s) => s.tree);
  const [filter, setFilter] = useState('');
  const treeKind = (tree.constructor as unknown as { bl_idname: NodeTreeKind }).bl_idname;

  const grouped = useMemo(() => buildAddMenuSections(treeKind, filter), [treeKind, filter]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 1000,
        background: '#2b2b2b', border: '1px solid #111',
        borderRadius: 6, color: '#ddd', minWidth: 240, maxHeight: 480, overflow: 'auto',
        fontFamily: 'Inter, system-ui', fontSize: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <input
        autoFocus
        placeholder="Search…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 10px',
          background: '#1d1d1d', border: 'none', borderBottom: '1px solid #111',
          color: '#ddd', outline: 'none',
        }}
      />
      {grouped.map(({ category, items }) => (
        <div key={category}>
          <div style={{ padding: '4px 10px', fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{category}</div>
          {items.map((item) => (
            <div
              key={`${category}:${item.bl_idname}:${item.label}`}
              onClick={() => {
                createNodeFromAddMenuEntry(tree, item, [x - 200, y - 100]);
                useTreeStore.getState().bumpVersion();
                onClose();
              }}
              style={{ padding: '4px 16px', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a76ad')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {item.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

void ({} as NodeItem | undefined);
