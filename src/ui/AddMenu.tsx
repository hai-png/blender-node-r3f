/**
 * Right-click / Shift+A add menu.
 * Lists every Node registered for the current tree's kind, grouped by category.
 */
import { useMemo, useState } from 'react';
import { NodeRegistry } from '../registry/NodeRegistry';
import { useTreeStore } from './store';
import type { NodeTreeKind } from '../core/types';

export function AddMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const tree = useTreeStore((s) => s.tree);
  const [filter, setFilter] = useState('');
  const treeKind = (tree.constructor as unknown as { bl_idname: NodeTreeKind }).bl_idname;

  const grouped = useMemo(() => {
    const items = NodeRegistry.listForTree(treeKind);
    const byCat = new Map<string, typeof items>();
    for (const it of items) {
      if (filter && !it.bl_label.toLowerCase().includes(filter.toLowerCase()) && !it.bl_idname.toLowerCase().includes(filter.toLowerCase())) continue;
      const cat = it.category ?? 'Misc';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(it);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [treeKind, filter]);

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
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div style={{ padding: '4px 10px', fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{cat}</div>
          {items.map((NodeCls) => (
            <div
              key={NodeCls.bl_idname}
              onClick={() => {
                const node = tree.addNode(NodeCls as Parameters<typeof tree.addNode>[0]);
                node.location = [x - 200, y - 100];
                useTreeStore.getState().bumpVersion();
                onClose();
              }}
              style={{ padding: '4px 16px', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a76ad')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {NodeCls.bl_label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
