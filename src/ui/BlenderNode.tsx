/**
 * Generic React Flow node renderer for any Blender Node.
 *
 * Renders the header + body + sockets, with Blender-style coloured handles.
 * One renderer handles every node type — node specifics come from the
 * runtime Node class (sockets, properties, label).
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTreeStore } from './store';
import type { Node as BNode } from '../core/Node';
import type { NodeSocket } from '../core/NodeSocket';

const HANDLE_SIZE = 12;

function rgbaToCss(c: readonly number[]): string {
  return `rgba(${Math.round(c[0]! * 255)}, ${Math.round(c[1]! * 255)}, ${Math.round(c[2]! * 255)}, ${c[3] ?? 1})`;
}

function socketStyle(s: NodeSocket, side: 'left' | 'right'): React.CSSProperties {
  return {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: rgbaToCss(s.color),
    border: '1.5px solid #111',
    borderRadius: s.display_shape === 'SQUARE' ? 2 : '50%',
    [side]: -HANDLE_SIZE / 2,
  } as React.CSSProperties;
}

interface BNodeProps {
  data: { node: BNode };
}

export function BlenderNodeView({ data, selected }: NodeProps & BNodeProps) {
  const node = data.node;
  const bumpVersion = useTreeStore((s) => s.bumpVersion);
  const propsSchema = (node.constructor as typeof BNode).properties;

  const rowH = 22;
  const headerH = 26;
  const headerColor = headerColorFor(node);
  const bodyH = Math.max(node.inputs.length, node.outputs.length) * rowH + Object.keys(propsSchema ?? {}).length * rowH + 12;
  node.height = headerH + bodyH;

  return (
    <div
      style={{
        width: node.width,
        minHeight: node.height,
        background: '#2b2b2b',
        border: selected ? '1.5px solid #ffaa44' : '1px solid #1a1a1a',
        borderRadius: 6,
        color: '#ddd',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
        boxShadow: selected ? '0 0 0 1px #ffaa44, 0 4px 12px rgba(0,0,0,0.6)' : '0 2px 6px rgba(0,0,0,0.5)',
        opacity: node.mute ? 0.5 : 1,
      }}
    >
      <div
        style={{
          height: headerH,
          background: headerColor,
          borderTopLeftRadius: 5,
          borderTopRightRadius: 5,
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#fff',
          fontWeight: 600,
          textShadow: '0 1px 1px rgba(0,0,0,0.4)',
        }}
      >
        <span>{node.label || node.bl_label}</span>
        <span style={{ opacity: 0.6, fontWeight: 400 }}>{node.bl_idname.replace(/^.*Node/, '')}</span>
      </div>

      {/* Outputs on the right */}
      <div style={{ padding: '6px 0' }}>
        {node.outputs.map((s) => (
          <div key={s.id} style={{ height: rowH, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 12px 0 8px', position: 'relative' }}>
            <span>{s.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={s.identifier}
              style={socketStyle(s, 'right')}
              isConnectable
            />
          </div>
        ))}
      </div>

      {/* Properties (inline editors) */}
      {Object.entries(propsSchema ?? {}).map(([key, desc]) => (
        <div key={key} style={{ padding: '2px 8px', height: rowH, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.7 }}>{desc.name ?? key}</span>
          <PropertyEditor node={node} propKey={key} onChange={bumpVersion} />
        </div>
      ))}

      {/* Inputs on the left */}
      <div style={{ padding: '6px 0 8px 0' }}>
        {node.inputs.map((s) => (
          <div key={s.id} style={{ height: rowH, display: 'flex', alignItems: 'center', padding: '0 8px 0 12px', gap: 6, position: 'relative' }}>
            <Handle
              type="target"
              position={Position.Left}
              id={s.identifier}
              style={socketStyle(s, 'left')}
              isConnectable
            />
            <span style={{ opacity: 0.85 }}>{s.name}</span>
            {!s.is_linked && !s.hide_value && <InlineSocketEditor socket={s} onChange={bumpVersion} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function headerColorFor(node: BNode): string {
  const id = node.bl_idname;
  // Zone Input/Output pairs get a distinctive warm tone so they're easy to
  // spot in a graph.
  if (id.includes('Simulation')) return '#8a4a2a';
  if (id.includes('Repeat')) return '#5a4a8a';
  if (id.includes('Foreach')) return '#4a7a8a';
  if (id.includes('Bsdf') || id.includes('Shader')) return '#5a8f4a';
  if (id.includes('Output')) return '#b25555';
  if (id.includes('Tex')) return '#a37038';
  if (id.startsWith('GeometryNode')) return '#3a7da6';
  if (id.startsWith('CompositorNode')) return '#86763a';
  if (id.startsWith('TextureNode')) return '#7a4aa8';
  if (id === 'NodeFrame' || id === 'NodeReroute') return '#444';
  return '#4d4d4d';
}

// -----------------------------------------------------------------------
//   Tiny inline editors
// -----------------------------------------------------------------------
function InlineSocketEditor({ socket, onChange }: { socket: NodeSocket; onChange: () => void }) {
  const kind = socket.kind;
  if (kind === 'VALUE' || kind === 'INT') {
    return (
      <input
        type="number"
        defaultValue={socket.default_value as number}
        step={kind === 'INT' ? 1 : 0.01}
        onChange={(e) => { (socket.default_value as unknown) = Number(e.target.value); socket.node.tree.depsgraph.invalidate(socket.node); onChange(); }}
        style={inputStyle}
      />
    );
  }
  if (kind === 'BOOLEAN') {
    return (
      <input
        type="checkbox"
        defaultChecked={socket.default_value as boolean}
        onChange={(e) => { (socket.default_value as unknown) = e.target.checked; socket.node.tree.depsgraph.invalidate(socket.node); onChange(); }}
      />
    );
  }
  if (kind === 'RGBA') {
    const c = socket.default_value as number[];
    const hex = '#' + [c[0], c[1], c[2]].map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
    return (
      <input
        type="color"
        defaultValue={hex}
        onChange={(e) => {
          const v = e.target.value;
          const r = parseInt(v.slice(1, 3), 16) / 255;
          const g = parseInt(v.slice(3, 5), 16) / 255;
          const b = parseInt(v.slice(5, 7), 16) / 255;
          (socket.default_value as unknown) = [r, g, b, 1];
          socket.node.tree.depsgraph.invalidate(socket.node);
          onChange();
        }}
        style={{ width: 24, height: 16, padding: 0, border: 'none' }}
      />
    );
  }
  if (kind === 'VECTOR') {
    const v = socket.default_value as number[];
    return (
      <div style={{ display: 'flex', gap: 2 }}>
        {(['x','y','z'] as const).map((axis, i) => (
          <input
            key={axis}
            type="number"
            defaultValue={v[i]}
            step={0.1}
            onChange={(e) => {
              (socket.default_value as number[])[i] = Number(e.target.value);
              socket.node.tree.depsgraph.invalidate(socket.node);
              onChange();
            }}
            style={{ ...inputStyle, width: 36 }}
          />
        ))}
      </div>
    );
  }
  return null;
}

function PropertyEditor({ node, propKey, onChange }: { node: BNode; propKey: string; onChange: () => void }) {
  const propsSchema = (node.constructor as typeof BNode).properties;
  const desc = propsSchema[propKey]!;
  const current = (node as unknown as Record<string, unknown>)[propKey];
  if (desc.kind === 'ENUM') {
    return (
      <select
        defaultValue={current as string}
        onChange={(e) => {
          (node as unknown as Record<string, unknown>)[propKey] = e.target.value;
          node.tree.depsgraph.invalidate(node);
          onChange();
        }}
        style={{ ...inputStyle, flex: 1 }}
      >
        {desc.items.map((it) => (
          <option key={it[0]} value={it[0]}>{it[1]}</option>
        ))}
      </select>
    );
  }
  if (desc.kind === 'FLOAT' || desc.kind === 'INT') {
    return (
      <input
        type="number"
        defaultValue={current as number}
        step={desc.kind === 'INT' ? 1 : 0.01}
        onChange={(e) => {
          (node as unknown as Record<string, unknown>)[propKey] = Number(e.target.value);
          node.tree.depsgraph.invalidate(node);
          onChange();
        }}
        style={{ ...inputStyle, flex: 1 }}
      />
    );
  }
  if (desc.kind === 'BOOL') {
    return (
      <input
        type="checkbox"
        defaultChecked={current as boolean}
        onChange={(e) => {
          (node as unknown as Record<string, unknown>)[propKey] = e.target.checked;
          node.tree.depsgraph.invalidate(node);
          onChange();
        }}
      />
    );
  }
  if (desc.kind === 'COLOR') {
    const c = current as number[];
    const hex = '#' + [c[0], c[1], c[2]].map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
    return (
      <input
        type="color"
        defaultValue={hex}
        onChange={(e) => {
          const v = e.target.value;
          const r = parseInt(v.slice(1, 3), 16) / 255;
          const g = parseInt(v.slice(3, 5), 16) / 255;
          const b = parseInt(v.slice(5, 7), 16) / 255;
          (node as unknown as Record<string, unknown>)[propKey] = [r, g, b, 1];
          node.tree.depsgraph.invalidate(node);
          onChange();
        }}
        style={{ width: 24, height: 16, padding: 0, border: 'none' }}
      />
    );
  }
  return <span style={{ opacity: 0.5 }}>{String(current)}</span>;
}

const inputStyle: React.CSSProperties = {
  background: '#1d1d1d',
  border: '1px solid #111',
  color: '#ddd',
  fontSize: 10,
  padding: '1px 4px',
  borderRadius: 3,
  width: 60,
};
