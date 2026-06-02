/**
 * Standalone Inspector Sidebar — mirrors Blender's sidebar properties panel.
 *
 * Displays detailed information about the currently selected node:
 *   - Metadata (bl_idname, label override, name, location, and mute/hide toggles)
 *   - Declarative properties (Float, Int, Bool, Enum, String, Vector, Color)
 *   - Input Socket default values (for unlinked and visible sockets)
 *   - Diagnostics (performance timings & node errors, e.g., graph cycles)
 */
import React from 'react';
import { useTreeStore } from './store';
import { Node } from '../core/Node';
import { NodeSocket } from '../core/NodeSocket';

export function Inspector() {
  const tree = useTreeStore((s) => s.tree);
  const version = useTreeStore((s) => s.version);
  const selectedNodeIds = useTreeStore((s) => s.selectedNodeIds);
  const bumpVersion = useTreeStore((s) => s.bumpVersion);

  // Re-render when version changes
  React.useEffect(() => {
    // sub to version updates to refresh form values dynamically
  }, [version]);

  if (!tree) {
    return (
      <div style={panelPlaceholderStyle}>
        No active tree
      </div>
    );
  }

  const selectedIds = Array.from(selectedNodeIds);
  if (selectedIds.length === 0) {
    return (
      <div style={panelPlaceholderStyle}>
        Select a node to inspect properties
      </div>
    );
  }

  // Inspect the first selected node
  const node = tree.nodes.find((n) => n.id === selectedIds[0]);
  if (!node) {
    return (
      <div style={panelPlaceholderStyle}>
        Node not found in current tree
      </div>
    );
  }

  const propsSchema = (node.constructor as typeof Node).properties ?? {};
  const hasProperties = Object.keys(propsSchema).length > 0;

  // Get unlinked and visible input sockets
  const unlinkedInputs = node.inputs.filter((s) => !s.is_linked && !s.hide && !s.hide_value);
  const hasSockets = unlinkedInputs.length > 0;

  // Get timings and errors from the last evaluation
  const lastResult = tree.depsgraph.lastResult;
  const timing = lastResult?.node_timings.get(node.id);
  const error = lastResult?.errors.get(node.id) || (lastResult?.errors.has('__cycle__') && tree.topoOrder().cycleNodes?.some(n => n.id === node.id) ? lastResult.errors.get('__cycle__') : null);

  const handleLabelChange = (val: string) => {
    node.label = val;
    bumpVersion();
  };

  const handleMuteChange = (val: boolean) => {
    node.mute = val;
    tree.depsgraph.invalidate(node);
    bumpVersion();
  };

  const handleHideChange = (val: boolean) => {
    node.hide = val;
    tree.depsgraph.invalidate(node);
    bumpVersion();
  };

  return (
    <div style={containerStyle}>
      {/* Panel Title */}
      <div style={sectionHeaderStyle}>
        <span>Node Properties</span>
      </div>

      <div style={contentStyle}>
        {/* Basic Metadata */}
        <div style={cardStyle}>
          <div style={titleStyle}>
            <span style={typeBadgeStyle}>{node.bl_idname.replace(/^.*Node/, '')}</span>
            <span style={{ fontWeight: 600, color: '#fff' }}>{node.bl_label}</span>
          </div>

          <div style={formRowStyle}>
            <span style={labelStyle}>Label:</span>
            <input
              type="text"
              value={node.label || ''}
              placeholder={node.bl_label}
              onChange={(e) => handleLabelChange(e.target.value)}
              style={inputTextStyle}
            />
          </div>

          <div style={formRowStyle}>
            <span style={labelStyle}>Name:</span>
            <input
              type="text"
              value={node.name}
              readOnly
              style={{ ...inputTextStyle, opacity: 0.5, cursor: 'not-allowed' }}
            />
          </div>

          <div style={formRowStyle}>
            <span style={labelStyle}>Mute:</span>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={node.mute}
                onChange={(e) => handleMuteChange(e.target.checked)}
                style={checkboxStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.6 }}>Pass-through</span>
            </label>
          </div>

          <div style={formRowStyle}>
            <span style={labelStyle}>Hide:</span>
            <input
              type="checkbox"
              checked={node.hide}
              onChange={(e) => handleHideChange(e.target.checked)}
              style={checkboxStyle}
            />
          </div>
        </div>

        {/* Declarative Properties Schema */}
        {hasProperties && (
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>Properties</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(propsSchema).map(([key, desc]) => (
                <div key={key} style={propertyFormRowStyle}>
                  <div style={propertyNameStyle}>{desc.name ?? key}:</div>
                  <PropertyField node={node} propKey={key} onChange={bumpVersion} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input Sockets Default Values */}
        {hasSockets && (
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>Input Sockets</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unlinkedInputs.map((socket) => (
                <div key={socket.id} style={propertyFormRowStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={socketIndicatorStyle(socket.color)} />
                    <span style={propertyNameStyle}>{socket.name}:</span>
                  </div>
                  <SocketField socket={socket} onChange={bumpVersion} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diagnostics, timing, and errors */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>Diagnostics</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
            <div style={diagRowStyle}>
              <span style={{ opacity: 0.6 }}>Eval Time:</span>
              <span>{timing !== undefined ? `${timing.toFixed(2)} ms` : 'N/A'}</span>
            </div>
            {error && (
              <div style={errorBoxStyle}>
                <strong>Warning / Error:</strong>
                <p style={{ margin: '4px 0 0 0', lineHeight: 1.3 }}>{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
//   Property Editors
// -----------------------------------------------------------------------
function PropertyField({ node, propKey, onChange }: { node: Node; propKey: string; onChange: () => void }) {
  const propsSchema = (node.constructor as typeof Node).properties ?? {};
  const desc = propsSchema[propKey]!;
  const current = (node as unknown as Record<string, unknown>)[propKey];

  const handleValChange = (val: unknown) => {
    (node as unknown as Record<string, unknown>)[propKey] = val;
    node.tree.depsgraph.invalidate(node);
    onChange();
  };

  if (desc.kind === 'ENUM') {
    return (
      <select
        value={current as string}
        onChange={(e) => handleValChange(e.target.value)}
        style={selectInputStyle}
      >
        {desc.items.map((it) => (
          <option key={it[0]} value={it[0]}>
            {it[1]}
          </option>
        ))}
      </select>
    );
  }

  if (desc.kind === 'FLOAT' || desc.kind === 'INT') {
    const isInt = desc.kind === 'INT';
    return (
      <div style={{ display: 'flex', gap: 4, flex: 1, alignItems: 'center' }}>
        <input
          type="number"
          value={current as number}
          step={isInt ? 1 : 0.01}
          onChange={(e) => handleValChange(Number(e.target.value))}
          style={inputTextStyle}
        />
        {!isInt && desc.min !== undefined && desc.max !== undefined && (
          <input
            type="range"
            min={desc.min}
            max={desc.max}
            step={0.01}
            value={current as number}
            onChange={(e) => handleValChange(Number(e.target.value))}
            style={{ flex: 1, height: 4, accentColor: '#3a7da6' }}
          />
        )}
      </div>
    );
  }

  if (desc.kind === 'BOOL') {
    return (
      <input
        type="checkbox"
        checked={current as boolean}
        onChange={(e) => handleValChange(e.target.checked)}
        style={checkboxStyle}
      />
    );
  }

  if (desc.kind === 'STRING') {
    return (
      <input
        type="text"
        value={current as string}
        onChange={(e) => handleValChange(e.target.value)}
        style={inputTextStyle}
      />
    );
  }

  if (desc.kind === 'COLOR') {
    const c = current as number[];
    const hex = '#' + [c[0], c[1], c[2]].map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => {
            const v = e.target.value;
            const r = parseInt(v.slice(1, 3), 16) / 255;
            const g = parseInt(v.slice(3, 5), 16) / 255;
            const b = parseInt(v.slice(5, 7), 16) / 255;
            handleValChange([r, g, b, 1]);
          }}
          style={colorInputStyle}
        />
        <span style={{ fontSize: 9, opacity: 0.5, fontFamily: 'monospace' }}>
          {`[${c.slice(0,3).map(v => v.toFixed(2)).join(',')}]`}
        </span>
      </div>
    );
  }

  return <span style={{ opacity: 0.5, fontSize: 10 }}>{String(current)}</span>;
}

// -----------------------------------------------------------------------
//   Socket Editors
// -----------------------------------------------------------------------
function SocketField({ socket, onChange }: { socket: NodeSocket; onChange: () => void }) {
  const kind = socket.kind;

  const handleValChange = (val: unknown) => {
    (socket.default_value as unknown) = val;
    socket.node.tree.depsgraph.invalidate(socket.node);
    onChange();
  };

  if (kind === 'VALUE' || kind === 'INT') {
    const isInt = kind === 'INT';
    return (
      <input
        type="number"
        value={socket.default_value as number}
        step={isInt ? 1 : 0.01}
        onChange={(e) => handleValChange(Number(e.target.value))}
        style={inputTextStyle}
      />
    );
  }

  if (kind === 'BOOLEAN') {
    return (
      <input
        type="checkbox"
        checked={socket.default_value as boolean}
        onChange={(e) => handleValChange(e.target.checked)}
        style={checkboxStyle}
      />
    );
  }

  if (kind === 'RGBA') {
    const c = socket.default_value as number[];
    const hex = '#' + [c[0], c[1], c[2]].map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => {
            const v = e.target.value;
            const r = parseInt(v.slice(1, 3), 16) / 255;
            const g = parseInt(v.slice(3, 5), 16) / 255;
            const b = parseInt(v.slice(5, 7), 16) / 255;
            handleValChange([r, g, b, 1]);
          }}
          style={colorInputStyle}
        />
        <span style={{ fontSize: 9, opacity: 0.5, fontFamily: 'monospace' }}>
          {`[${c.slice(0,3).map(v => v.toFixed(2)).join(',')}]`}
        </span>
      </div>
    );
  }

  if (kind === 'VECTOR') {
    const v = socket.default_value as number[];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: 0.4, width: 10, fontSize: 9, fontWeight: 'bold' }}>{axis}</span>
            <input
              type="number"
              value={v[i] ?? 0}
              step={0.1}
              onChange={(e) => {
                const copy = [...v];
                copy[i] = Number(e.target.value);
                handleValChange(copy);
              }}
              style={inputTextStyle}
            />
          </div>
        ))}
      </div>
    );
  }

  return <span style={{ opacity: 0.4, fontSize: 10 }}>Opaque Sockets</span>;
}

function socketIndicatorStyle(c: readonly number[]): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: `rgba(${Math.round(c[0]! * 255)}, ${Math.round(c[1]! * 255)}, ${Math.round(c[2]! * 255)}, ${c[3] ?? 1})`,
    display: 'inline-block',
  };
}

// -----------------------------------------------------------------------
//   Styles matching Blender dark aesthetics
// -----------------------------------------------------------------------
const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: '#252525',
  borderLeft: '1px solid #141414',
  display: 'flex',
  flexDirection: 'column',
  color: '#cccccc',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
};

const sectionHeaderStyle: React.CSSProperties = {
  height: 28,
  background: '#1a1a1a',
  borderBottom: '1px solid #141414',
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  fontWeight: 600,
  color: '#e5e5e5',
  flexShrink: 0,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: '#2f2f2f',
  border: '1px solid #1e1e1e',
  borderRadius: 4,
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const cardHeaderStyle: React.CSSProperties = {
  fontWeight: 'bold',
  color: '#bbb',
  fontSize: 9.5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #282828',
  paddingBottom: 4,
};

const titleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  borderBottom: '1px solid #282828',
  paddingBottom: 6,
};

const typeBadgeStyle: React.CSSProperties = {
  background: '#3e3e3e',
  padding: '1px 4px',
  borderRadius: 3,
  fontSize: 8.5,
  color: '#888',
  fontFamily: 'monospace',
};

const formRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 20,
};

const propertyFormRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const labelStyle: React.CSSProperties = {
  width: 50,
  color: '#888',
  flexShrink: 0,
};

const propertyNameStyle: React.CSSProperties = {
  color: '#aaa',
  fontWeight: 500,
};

const inputTextStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #1c1c1c',
  borderRadius: 3,
  color: '#eee',
  fontSize: 10,
  padding: '2px 6px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const selectInputStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #1c1c1c',
  borderRadius: 3,
  color: '#eee',
  fontSize: 10,
  padding: '1px 4px',
  outline: 'none',
  width: '100%',
};

const checkboxStyle: React.CSSProperties = {
  accentColor: '#3a7da6',
  cursor: 'pointer',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

const colorInputStyle: React.CSSProperties = {
  width: 28,
  height: 16,
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
};

const diagRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
};

const errorBoxStyle: React.CSSProperties = {
  background: '#4a2525',
  border: '1px solid #662a2a',
  borderRadius: 3,
  color: '#ff9999',
  padding: 6,
  marginTop: 4,
};

const panelPlaceholderStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: '#252525',
  borderLeft: '1px solid #141414',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#777',
  fontSize: 12,
  fontStyle: 'italic',
  padding: 20,
  textAlign: 'center',
  boxSizing: 'border-box',
};
