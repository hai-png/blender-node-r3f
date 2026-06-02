/**
 * NodeEditor — React Flow host wired to a Blender NodeTree.
 */
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useState } from 'react';
import { BlenderNodeView } from './BlenderNode';
import { useTreeStore } from './store';
import { AddMenu } from './AddMenu';
import type { Node as BNode } from '../core/Node';

const nodeTypes = { blender: BlenderNodeView } as const;

export function NodeEditor() {
  const tree = useTreeStore((s) => s.tree);
  const version = useTreeStore((s) => s.version);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // derive RF nodes & edges from the runtime tree on every version bump
  const { rfNodes, rfEdges } = useMemo(() => {
    void version;
    const rfNodes: RFNode[] = tree.nodes.map((n) => ({
      id: n.id,
      type: 'blender',
      position: { x: n.location[0], y: n.location[1] },
      data: { node: n },
      // disable dragging on Frame (M0 simplification)
      draggable: n.bl_idname !== 'NodeFrame',
    }));
    const rfEdges: RFEdge[] = tree.links.map((l) => ({
      id: l.id,
      source: l.from_node.id,
      sourceHandle: l.from_socket.identifier,
      target: l.to_node.id,
      targetHandle: l.to_socket.identifier,
      animated: l.from_socket.kind === 'GEOMETRY',
      style: {
        stroke: (l.escapes_zone || !l.is_valid) ? '#cc4444' : rgbaToCss(l.from_socket.color),
        strokeWidth: l.from_socket.kind === 'SHADER' ? 3 : 2,
        strokeDasharray:
          l.escapes_zone ? '4 4'
          : l.from_socket.kind === 'SHADER' ? '6 3'
          : undefined,
      },
    }));
    return { rfNodes, rfEdges };
  }, [tree, version]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Sync position back to runtime nodes.
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        const n = tree.nodes.find((x) => x.id === ch.id);
        if (n) n.location = [ch.position.x, ch.position.y];
      }
      if (ch.type === 'remove') {
        const n = tree.nodes.find((x) => x.id === ch.id);
        if (n) tree.removeNode(n);
      }
    }
    // we don't need to keep RF state — it's derived; force re-render via:
    useTreeStore.getState().bumpVersion();
    void applyNodeChanges(changes, rfNodes); // no-op, just satisfies the API
  }, [tree, rfNodes]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    const from = tree.nodes.find((n) => n.id === c.source);
    const to = tree.nodes.find((n) => n.id === c.target);
    if (!from || !to) return;
    const fromS = from.findOutput(c.sourceHandle);
    const toS = to.findInput(c.targetHandle);
    if (!fromS || !toS) return;
    try {
      tree.addLink(fromS, toS);
      useTreeStore.getState().bumpVersion();
    } catch (e) {
      console.warn(e);
    }
  }, [tree]);

  const onEdgesDelete = useCallback((edges: RFEdge[]) => {
    for (const e of edges) {
      const link = tree.links.find((l) => l.id === e.id);
      if (link) tree.removeLink(link);
    }
    useTreeStore.getState().bumpVersion();
  }, [tree]);

  return (
    <div
      style={{ width: '100%', height: '100%', background: '#1d1d1d' }}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      onClick={() => setMenu(null)}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Delete', 'Backspace']}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        <Controls style={{ background: '#2b2b2b', border: '1px solid #111' }} />
        <MiniMap maskColor="rgba(0,0,0,0.5)" style={{ background: '#222' }} />
      </ReactFlow>
      {menu && <AddMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

function rgbaToCss(c: readonly number[]): string {
  return `rgba(${Math.round(c[0]! * 255)}, ${Math.round(c[1]! * 255)}, ${Math.round(c[2]! * 255)}, ${c[3] ?? 1})`;
}
