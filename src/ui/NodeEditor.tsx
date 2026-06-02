/**
 * NodeEditor — React Flow host wired to a Blender NodeTree.
 *
 * Keyboard shortcuts (Blender-style):
 *   Shift+A          — Open Add menu at cursor
 *   Delete / Backspace — Delete selected nodes/edges
 *   Ctrl+Z           — Undo
 *   Ctrl+Y / Ctrl+Shift+Z — Redo
 *   M                — Mute/unmute selected nodes
 *   H                — Hide/unhide selected nodes
 *   Ctrl+C           — Copy selected nodes (clipboard JSON)
 *   Ctrl+V           — Paste copied nodes
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlenderNodeView } from './BlenderNode';
import { useTreeStore } from './store';
import { AddMenu } from './AddMenu';
import type { Node as BNode } from '../core/Node';
import { History, autoLayout, makeGroup, ungroup } from './operators';
import { NodeRegistry } from '../registry/NodeRegistry';
import type { NodeTreeKind } from '../core/types';

const nodeTypes = { blender: BlenderNodeView } as const;

export function NodeEditor() {
  const tree = useTreeStore((s) => s.tree);
  const version = useTreeStore((s) => s.version);
  const selectedNodeIds = useTreeStore((s) => s.selectedNodeIds);
  const setSelected = useTreeStore((s) => s.setSelected);
  const setTree = useTreeStore((s) => s.setTree);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const historyRef = useRef<History>(new History());
  const clipboardRef = useRef<string | null>(null);

  // derive RF nodes & edges from the runtime tree on every version bump
  const { rfNodes, rfEdges } = useMemo(() => {
    void version;
    const rfNodes: RFNode[] = tree.nodes.map((n) => ({
      id: n.id,
      type: 'blender',
      position: { x: n.location[0], y: n.location[1] },
      data: { node: n },
      selected: selectedNodeIds.has(n.id),
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
  }, [tree, version, selectedNodeIds]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
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
    useTreeStore.getState().bumpVersion();
    void applyNodeChanges(changes, rfNodes);
  }, [tree, rfNodes]);

  const onSelectionChange = useCallback(({ nodes }: { nodes: RFNode[] }) => {
    setSelected(nodes.map((n) => n.id));
  }, [setSelected]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    const from = tree.nodes.find((n) => n.id === c.source);
    const to = tree.nodes.find((n) => n.id === c.target);
    if (!from || !to) return;
    const fromS = from.findOutput(c.sourceHandle);
    const toS = to.findInput(c.targetHandle);
    if (!fromS || !toS) return;
    try {
      historyRef.current.push(tree);
      tree.addLink(fromS, toS);
      useTreeStore.getState().bumpVersion();
    } catch (e) {
      console.warn(e);
    }
  }, [tree]);

  const onEdgesDelete = useCallback((edges: RFEdge[]) => {
    historyRef.current.push(tree);
    for (const e of edges) {
      const link = tree.links.find((l) => l.id === e.id);
      if (link) tree.removeLink(link);
    }
    useTreeStore.getState().bumpVersion();
  }, [tree]);

  // -----------------------------------------------------------------------
  //  Keyboard shortcuts
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const selectedNodes = tree.nodes.filter((n) => selectedNodeIds.has(n.id));

      // Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const restored = historyRef.current.undo();
        if (restored) { setTree(restored); setSelected([]); }
        return;
      }
      // Redo
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const restored = historyRef.current.redo();
        if (restored) { setTree(restored); setSelected([]); }
        return;
      }
      // Auto-layout
      if (ctrl && e.key === 'l') {
        e.preventDefault();
        historyRef.current.push(tree);
        autoLayout(tree);
        useTreeStore.getState().bumpVersion();
        return;
      }
      // Copy
      if (ctrl && e.key === 'c') {
        e.preventDefault();
        if (selectedNodes.length === 0) return;
        const data = selectedNodes.map((n) => ({
          bl_idname: n.bl_idname,
          location: [...n.location],
          properties: Object.fromEntries(
            Object.keys((n.constructor as typeof BNode).properties ?? {}).map((k) => [
              k, (n as unknown as Record<string, unknown>)[k],
            ])
          ),
        }));
        clipboardRef.current = JSON.stringify(data);
        return;
      }
      // Paste
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        if (!clipboardRef.current) return;
        try {
          const data = JSON.parse(clipboardRef.current) as Array<{
            bl_idname: string; location: number[]; properties: Record<string, unknown>;
          }>;
          historyRef.current.push(tree);
          const newIds: string[] = [];
          for (const item of data) {
            const Cls = NodeRegistry.getNode(item.bl_idname);
            if (!Cls) continue;
            const node = tree.addNode(Cls as Parameters<typeof tree.addNode>[0]);
            node.location = [item.location[0]! + 40, item.location[1]! + 40];
            for (const [k, v] of Object.entries(item.properties)) {
              (node as unknown as Record<string, unknown>)[k] = v;
            }
            newIds.push(node.id);
          }
          setSelected(newIds);
          useTreeStore.getState().bumpVersion();
        } catch (e2) {
          console.warn('paste failed:', e2);
        }
        return;
      }
      // Mute/unmute selected
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (selectedNodes.length === 0) return;
        historyRef.current.push(tree);
        const anyUnmuted = selectedNodes.some((n) => !n.mute);
        for (const n of selectedNodes) n.mute = anyUnmuted;
        useTreeStore.getState().bumpVersion();
        return;
      }
      // Hide/unhide selected
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        if (selectedNodes.length === 0) return;
        historyRef.current.push(tree);
        const anyVisible = selectedNodes.some((n) => !n.hide);
        for (const n of selectedNodes) n.hide = anyVisible;
        useTreeStore.getState().bumpVersion();
        return;
      }
      // Shift+A — add menu at canvas center
      if (e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setMenu({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tree, selectedNodeIds, setSelected, setTree]);

  return (
    <div
      style={{ width: '100%', height: '100%', background: '#1d1d1d', display: 'flex', flexDirection: 'column' }}
    >
      {/* Operator toolbar */}
      <OperatorBar
        tree={tree}
        history={historyRef.current}
        selectedNodeIds={selectedNodeIds}
        setSelected={setSelected}
        setTree={setTree}
      />

      <div
        style={{ flex: 1, position: 'relative' }}
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
          onSelectionChange={onSelectionChange}
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
    </div>
  );
}

// -------------------------------------------------------------------------
//  Operator toolbar
// -------------------------------------------------------------------------
interface OperatorBarProps {
  tree: import('../core/NodeTree').NodeTree;
  history: History;
  selectedNodeIds: Set<string>;
  setSelected: (ids: string[]) => void;
  setTree: (tree: import('../core/NodeTree').NodeTree) => void;
}
function OperatorBar({ tree, history, selectedNodeIds, setSelected, setTree }: OperatorBarProps) {
  const bump = useTreeStore((s) => s.bumpVersion);

  const btn: React.CSSProperties = {
    padding: '3px 10px', background: '#333', border: '1px solid #444', borderRadius: 4,
    color: '#ccc', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, system-ui',
  };
  const disabledBtn: React.CSSProperties = { ...btn, opacity: 0.4, cursor: 'default' };

  const selectedNodes = tree.nodes.filter((n) => selectedNodeIds.has(n.id));

  return (
    <div style={{
      display: 'flex', gap: 6, padding: '4px 8px', background: '#252525',
      borderBottom: '1px solid #111', alignItems: 'center', flexShrink: 0,
    }}>
      <button style={btn} title="Undo (Ctrl+Z)" onClick={() => {
        const r = history.undo();
        if (r) { setTree(r); setSelected([]); }
      }}>↩ Undo</button>
      <button style={btn} title="Redo (Ctrl+Y)" onClick={() => {
        const r = history.redo();
        if (r) { setTree(r); setSelected([]); }
      }}>↪ Redo</button>
      <span style={{ width: 1, height: 16, background: '#444', margin: '0 4px' }} />
      <button style={btn} title="Auto-Layout (Ctrl+L)" onClick={() => {
        history.push(tree); autoLayout(tree); bump();
      }}>⊞ Auto-Layout</button>
      <button
        style={selectedNodes.length > 0 ? btn : disabledBtn}
        title="Group selected nodes"
        onClick={() => {
          if (selectedNodes.length === 0) return;
          history.push(tree);
          const { container } = makeGroup(tree, selectedNodes, getGroupCtors(tree));
          setSelected([container.id]);
          bump();
        }}
      >⬚ Group</button>
      <button
        style={(selectedNodes.length === 1 && (selectedNodes[0] as { resolvedTree?: unknown } | undefined)?.resolvedTree) ? btn : disabledBtn}
        title="Ungroup selected group node"
        onClick={() => {
          const selected = selectedNodes[0] as (BNode & { resolvedTree?: unknown }) | undefined;
          if (!selected?.resolvedTree) return;
          history.push(tree);
          const inlined = ungroup(tree, selected);
          setSelected(inlined.map((n: BNode) => n.id));
          bump();
        }}
      >⇤ Ungroup</button>
      <button
        style={selectedNodes.length >= 1 ? btn : disabledBtn}
        title="Mute selected (M)"
        onClick={() => {
          if (selectedNodes.length === 0) return;
          history.push(tree);
          const anyUnmuted = selectedNodes.some((n) => !n.mute);
          for (const n of selectedNodes) n.mute = anyUnmuted;
          bump();
        }}
      >◯ Mute</button>
      <button
        style={selectedNodes.length > 0 ? btn : disabledBtn}
        title="Hide selected (H)"
        onClick={() => {
          if (selectedNodes.length === 0) return;
          history.push(tree);
          const anyVisible = selectedNodes.some((n) => !n.hide);
          for (const n of selectedNodes) n.hide = anyVisible;
          bump();
        }}
      >👁 Hide</button>
    </div>
  );
}

// Fix: look up tree-kind-specific ctors for makeGroup
function getGroupCtors(tree: import('../core/NodeTree').NodeTree) {
  const kind = (tree.constructor as unknown as { bl_idname: NodeTreeKind }).bl_idname;
  const prefix = kind === 'ShaderNodeTree' ? 'Shader'
    : kind === 'GeometryNodeTree' ? 'Geometry'
    : kind === 'CompositorNodeTree' ? 'Compositor'
    : 'Texture';
  const groupContainer = NodeRegistry.getNode(`${prefix}NodeGroup`);
  const groupInput = NodeRegistry.getNode('NodeGroupInput');
  const groupOutput = NodeRegistry.getNode('NodeGroupOutput');
  if (!groupContainer || !groupInput || !groupOutput) {
    throw new Error(`Missing group node constructors for ${kind}. Call bootstrapBuiltins() first.`);
  }
  return {
    childTree: tree.constructor as new (name?: string) => import('../core/NodeTree').NodeTree,
    groupContainer: groupContainer as new () => import('../core/Node').Node,
    groupInput: groupInput as new () => import('../core/Node').Node,
    groupOutput: groupOutput as new () => import('../core/Node').Node,
  };
}

function rgbaToCss(c: readonly number[]): string {
  return `rgba(${Math.round(c[0]! * 255)}, ${Math.round(c[1]! * 255)}, ${Math.round(c[2]! * 255)}, ${c[3] ?? 1})`;
}
