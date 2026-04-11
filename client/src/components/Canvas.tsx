import React, { useRef, useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useCanvasStore } from '../store';
import { CanvasNode, Group, GroupConnection, TerminalData, FilesData, PreviewData, GitData, EditorData, DocsData, NotesData, HttpClientData, AiReviewData, DbInspectorData } from '../types';
import { TerminalNode } from './nodes/TerminalNode';
import { FileBrowserNode } from './nodes/FileBrowserNode';
import { PreviewNode } from './nodes/PreviewNode';
import { GitNode } from './nodes/GitNode';
import { EditorNode } from './nodes/EditorNode';
import { DocsNode } from './nodes/DocsNode';
import { NotesNode } from './nodes/NotesNode';
import { HttpClientNode } from './nodes/HttpClientNode';
import { AiReviewNode } from './nodes/AiReviewNode';
import { ProcessManagerNode } from './nodes/ProcessManagerNode';
import { DbInspectorNode } from './nodes/DbInspectorNode';
import { ClaudeCodeNode } from './nodes/ClaudeCodeNode';
import { ClaudeCharacterOverlay } from './ClaudeCharacter';
import { subscribePlacement, getPlacementSnapshot, clearPlacement } from '../placementStore';

const TITLE_H = 36;
const MIN_W = 280;
const MIN_H = 180;
const PAD = { x: 20, top: 38, bottom: 20 };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  nodeId: string; startX: number; startY: number; origX: number; origY: number;
}
interface ResizeState {
  nodeId: string; dir: ResizeDir; startX: number; startY: number;
  origX: number; origY: number; origW: number; origH: number;
}

// ─── Group color palette ──────────────────────────────────────────────────────

export const GROUP_COLORS: Record<string, { r: number; g: number; b: number; label: string }> = {
  blue:   { r: 80,  g: 120, b: 255, label: 'Azul' },
  purple: { r: 140, g: 60,  b: 255, label: 'Roxo' },
  green:  { r: 40,  g: 200, b: 100, label: 'Verde' },
  cyan:   { r: 0,   g: 200, b: 220, label: 'Ciano' },
  orange: { r: 255, g: 140, b: 40,  label: 'Laranja' },
  pink:   { r: 220, g: 60,  b: 180, label: 'Rosa' },
  red:    { r: 255, g: 80,  b: 80,  label: 'Vermelho' },
};

// ─── Group bounds ─────────────────────────────────────────────────────────────

function nodeHeight(n: CanvasNode) { return n.minimized ? TITLE_H : n.height; }

function groupBounds(group: Group, nodes: CanvasNode[]) {
  const members = group.nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean) as CanvasNode[];
  if (!members.length) return null;
  const x1 = Math.min(...members.map(n => n.x))                    - PAD.x;
  const y1 = Math.min(...members.map(n => n.y))                    - PAD.top;
  const x2 = Math.max(...members.map(n => n.x + n.width))          + PAD.x;
  const y2 = Math.max(...members.map(n => n.y + nodeHeight(n)))     + PAD.bottom;
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

// ─── Groups layer ─────────────────────────────────────────────────────────────

function GroupsLayer({ groups, nodes, highlightId, onClose, onStartGroupDrag, onUpdateGroup, linkingFromGroupId, onLinkGroup }: {
  groups: Group[];
  nodes: CanvasNode[];
  highlightId: string | null;
  onClose: (groupId: string) => void;
  onStartGroupDrag: (groupId: string, e: MouseEvent) => void;
  onUpdateGroup: (groupId: string, patch: Partial<Pick<Group, 'label' | 'color'>>) => void;
  linkingFromGroupId: string | null;
  onLinkGroup: (groupId: string) => void;
}) {
  const [hoverId,     setHoverId]     = React.useState<string | null>(null);
  const [editGroupId, setEditGroupId] = React.useState<string | null>(null);
  const [editName,    setEditName]    = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  function openEdit(group: Group, e: React.MouseEvent) {
    e.stopPropagation();
    setEditGroupId(group.id);
    setEditName(group.label);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function saveEdit(groupId: string) {
    onUpdateGroup(groupId, { label: editName.trim() || 'Grupo' });
    setEditGroupId(null);
  }

  // Compute editing group data for the detached popover
  const editingGroup  = editGroupId ? groups.find(g => g.id === editGroupId) : null;
  const editingBounds = editingGroup ? groupBounds(editingGroup, nodes) : null;
  const editC         = editingGroup ? (GROUP_COLORS[editingGroup.color || 'blue'] ?? GROUP_COLORS.blue) : null;

  return (
    <>
      {/* ── Group containers (low z-index, backdrop-filter creates stacking ctx) ── */}
      {groups.map(group => {
        const b = groupBounds(group, nodes);
        if (!b) return null;
        const hi       = highlightId === group.id;
        const hov      = hoverId === group.id;
        const editing  = editGroupId === group.id;
        const colorKey = group.color || 'blue';
        const c        = GROUP_COLORS[colorKey] ?? GROUP_COLORS.blue;
        const rgb      = `${c.r},${c.g},${c.b}`;
        const textA    = hi || hov ? 0.9 : 0.5;

        const isLinkSource = linkingFromGroupId === group.id;
        const isLinkTarget = linkingFromGroupId !== null && linkingFromGroupId !== group.id;

        return (
          <div
            key={group.id}
            onClick={isLinkTarget ? e => { e.stopPropagation(); onLinkGroup(group.id); } : undefined}
            style={{
              position: 'absolute', left: b.x1, top: b.y1, width: b.w, height: b.h,
              borderRadius: 24,
              border: `1px solid rgba(${rgb},${isLinkSource ? 0.7 : hi ? 0.4 : hov ? 0.22 : isLinkTarget ? 0.35 : 0.13})`,
              background: `rgba(${rgb},${isLinkSource ? 0.12 : isLinkTarget ? 0.07 : hi ? 0.09 : 0.04})`,
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              boxShadow: isLinkSource
                ? `0 0 0 2px rgba(${rgb},0.4), 0 0 40px rgba(${rgb},0.2)`
                : isLinkTarget && hov
                ? `0 0 0 2px rgba(${rgb},0.5), 0 0 30px rgba(${rgb},0.15)`
                : hi
                ? `0 0 40px rgba(${rgb},0.14), inset 0 0 40px rgba(${rgb},0.05)`
                : 'inset 0 1px 0 rgba(255,255,255,0.04)',
              transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
              cursor: isLinkTarget ? 'crosshair' : 'default',
              pointerEvents: isLinkTarget ? 'auto' : 'none', zIndex: isLinkTarget ? 2 : 0,
            }}
          >
            {/* Header strip */}
            <div
              onMouseEnter={() => setHoverId(group.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 40, pointerEvents: 'auto', display: 'flex', alignItems: 'center' }}
            >
              {/* Drag area */}
              <div
                onMouseDown={e => { e.stopPropagation(); onStartGroupDrag(group.id, e.nativeEvent); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 0 0 14px', cursor: isLinkTarget ? 'crosshair' : 'grab', overflow: 'hidden', height: '100%' }}
              >
                <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                <span style={{
                  fontSize: 10, fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.06em',
                  color: `rgba(${Math.min(255,c.r+80)},${Math.min(255,c.g+80)},${Math.min(255,c.b+80)},${textA})`,
                  transition: 'color 0.2s',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {group.label}
                </span>
                {hi && !linkingFromGroupId && (
                  <span style={{ fontSize: 9, color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>
                    solte para adicionar
                  </span>
                )}
                {isLinkTarget && hov && (
                  <span style={{ fontSize: 9, color: '#60a5fa', background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>
                    conectar aqui
                  </span>
                )}
              </div>

              {/* Link button */}
              <button
                onClick={e => { e.stopPropagation(); onLinkGroup(group.id); }}
                onMouseDown={e => e.stopPropagation()}
                title={isLinkSource ? 'Cancelar conexão (ESC)' : 'Conectar a outro projeto'}
                style={{
                  background: isLinkSource ? `rgba(${rgb},0.25)` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isLinkSource ? `rgba(${rgb},0.5)` : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 6,
                  color: isLinkSource ? `rgba(${Math.min(255,c.r+80)},${Math.min(255,c.g+80)},${Math.min(255,c.b+80)},0.95)` : 'rgba(255,255,255,0.3)',
                  cursor: 'pointer', width: 22, height: 22, fontSize: 12, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0, marginRight: 4,
                }}
              >
                🔗
              </button>

              {/* Edit button */}
              <button
                onClick={e => openEdit(group, e)}
                onMouseDown={e => e.stopPropagation()}
                title="Editar grupo"
                style={{
                  background: editing ? `rgba(${rgb},0.2)` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${editing ? `rgba(${rgb},0.4)` : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 6,
                  color: editing ? `rgba(${Math.min(255,c.r+80)},${Math.min(255,c.g+80)},${Math.min(255,c.b+80)},0.9)` : 'rgba(255,255,255,0.3)',
                  cursor: 'pointer', width: 22, height: 22, fontSize: 11, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0, marginRight: 4,
                }}
              >
                ✏️
              </button>

              {/* Close button */}
              <button
                onClick={e => { e.stopPropagation(); onClose(group.id); }}
                onMouseDown={e => e.stopPropagation()}
                title={`Fechar "${group.label}" e todos os painéis`}
                style={{
                  background: hov ? 'rgba(248,113,113,0.18)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${hov ? 'rgba(248,113,113,0.45)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 6,
                  color: hov ? 'rgba(252,165,165,0.95)' : 'rgba(255,255,255,0.3)',
                  cursor: 'pointer', width: 22, height: 22, fontSize: 14, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0, marginRight: 10,
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      {/* ── Edit popover — rendered OUTSIDE group divs to escape stacking ctx ── */}
      {editingGroup && editingBounds && editC && (() => {
        const rgb = `${editC.r},${editC.g},${editC.b}`;
        return (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: editingBounds.x1 + 14,
              top:  editingBounds.y1 + 44,
              zIndex: 99999,
              background: 'rgba(8,12,28,0.97)',
              border: '1px solid rgba(255,255,255,0.13)',
              borderRadius: 14, padding: 14, width: 230,
              pointerEvents: 'auto',
              boxShadow: '0 16px 48px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {/* Name */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginBottom: 5, fontFamily: 'monospace' }}>NOME</div>
              <input
                ref={inputRef}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(editingGroup.id); if (e.key === 'Escape') setEditGroupId(null); }}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 7, color: 'rgba(255,255,255,0.9)',
                  fontSize: 12, padding: '6px 9px', outline: 'none',
                  fontFamily: 'monospace',
                }}
              />
            </div>

            {/* Color swatches */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginBottom: 7, fontFamily: 'monospace' }}>COR</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {Object.entries(GROUP_COLORS).map(([key, col]) => {
                  const selected = (editingGroup.color || 'blue') === key;
                  return (
                    <div
                      key={key}
                      title={col.label}
                      onClick={() => onUpdateGroup(editingGroup.id, { color: key })}
                      style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: `rgb(${col.r},${col.g},${col.b})`,
                        cursor: 'pointer',
                        border: selected ? '2px solid rgba(255,255,255,0.9)' : '2px solid rgba(255,255,255,0.12)',
                        boxShadow: selected ? `0 0 10px rgba(${col.r},${col.g},${col.b},0.8)` : 'none',
                        transition: 'all 0.15s',
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditGroupId(null)}
                style={{ ...popBtn, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
              >
                Cancelar
              </button>
              <button
                onClick={() => saveEdit(editingGroup.id)}
                style={{ ...popBtn, background: `rgba(${rgb},0.25)`, color: `rgba(${Math.min(255,editC.r+80)},${Math.min(255,editC.g+80)},${Math.min(255,editC.b+80)},0.95)`, border: `1px solid rgba(${rgb},0.4)` }}
              >
                Salvar
              </button>
            </div>
          </div>
        );
      })()}
    </>
  );
}

const popBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, color: 'rgba(255,255,255,0.7)',
  cursor: 'pointer', fontSize: 11, padding: '5px 10px',
  fontFamily: 'monospace',
};

// ─── Connection lines ─────────────────────────────────────────────────────────

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ─── Group-to-group connection lines ─────────────────────────────────────────

let gcAnimInjected = false;
function injectGcAnim() {
  if (gcAnimInjected || typeof document === 'undefined') return;
  gcAnimInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    @keyframes gc-dash { from { stroke-dashoffset: 60 } to { stroke-dashoffset: 0 } }
    @keyframes gc-pulse-dot { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
  `;
  document.head.appendChild(s);
}

function edgePoint(
  ax1: number, ay1: number, ax2: number, ay2: number,  // bounds of group A
  bx1: number, by1: number, bx2: number, by2: number   // bounds of group B
): [number, number, number, number] {
  const acx = (ax1 + ax2) / 2, acy = (ay1 + ay2) / 2;
  const bcx = (bx1 + bx2) / 2, bcy = (by1 + by2) / 2;
  const dx = bcx - acx, dy = bcy - acy;
  const absDx = Math.abs(dx), absDy = Math.abs(dy);

  let x1: number, y1: number, x2: number, y2: number;
  if (absDx > absDy) {
    // horizontal layout — connect right/left edges
    if (dx > 0) { x1 = ax2; y1 = acy; x2 = bx1; y2 = bcy; }
    else         { x1 = ax1; y1 = acy; x2 = bx2; y2 = bcy; }
  } else {
    // vertical layout — connect bottom/top edges
    if (dy > 0) { x1 = acx; y1 = ay2; x2 = bcx; y2 = by1; }
    else         { x1 = acx; y1 = ay1; x2 = bcx; y2 = by2; }
  }
  return [x1, y1, x2, y2];
}

function GroupConnectionsLayer({ groupConnections, groups, nodes, onRemove }: {
  groupConnections: GroupConnection[];
  groups: Group[];
  nodes: CanvasNode[];
  onRemove: (id: string) => void;
}) {
  injectGcAnim();
  const [hoverId, setHoverId] = React.useState<string | null>(null);

  if (!groupConnections.length) return null;

  return (
    <svg style={{
      position: 'absolute', left: 0, top: 0,
      width: 60000, height: 60000,
      pointerEvents: 'none', zIndex: 0,
      overflow: 'visible',
    }}>
      <defs>
        <filter id="gc-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {groupConnections.map(conn => {
        const fromGroup = groups.find(g => g.id === conn.fromGroupId);
        const toGroup   = groups.find(g => g.id === conn.toGroupId);
        if (!fromGroup || !toGroup) return null;
        const fb = groupBounds(fromGroup, nodes);
        const tb = groupBounds(toGroup,   nodes);
        if (!fb || !tb) return null;

        const fromC = GROUP_COLORS[fromGroup.color || 'blue'] ?? GROUP_COLORS.blue;
        const toC   = GROUP_COLORS[toGroup.color   || 'blue'] ?? GROUP_COLORS.blue;
        const r = Math.round((fromC.r + toC.r) / 2);
        const g = Math.round((fromC.g + toC.g) / 2);
        const b = Math.round((fromC.b + toC.b) / 2);
        const rgb = `${r},${g},${b}`;

        const [x1, y1, x2, y2] = edgePoint(fb.x1, fb.y1, fb.x2, fb.y2, tb.x1, tb.y1, tb.x2, tb.y2);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const d = bezierPath(x1, y1, x2, y2);
        const hov = hoverId === conn.id;

        return (
          <g key={conn.id} filter="url(#gc-glow)">
            {/* Glow halo */}
            <path d={d} fill="none" stroke={`rgba(${rgb},0.1)`} strokeWidth={hov ? 16 : 12} />
            {/* Main animated dash */}
            <path
              d={d} fill="none"
              stroke={`rgba(${rgb},${hov ? 0.75 : 0.5})`}
              strokeWidth={hov ? 2.5 : 2}
              strokeDasharray="12 8"
              style={{ animation: 'gc-dash 1.2s linear infinite' }}
            />
            {/* Static underlayer */}
            <path d={d} fill="none" stroke={`rgba(${rgb},0.15)`} strokeWidth={1} />

            {/* Endpoint dots */}
            <circle cx={x1} cy={y1} r={5} fill={`rgba(${fromC.r},${fromC.g},${fromC.b},0.8)`}
              style={{ animation: 'gc-pulse-dot 2s ease-in-out infinite' }} />
            <circle cx={x2} cy={y2} r={5} fill={`rgba(${toC.r},${toC.g},${toC.b},0.8)`}
              style={{ animation: 'gc-pulse-dot 2s ease-in-out infinite 0.5s' }} />
            <circle cx={x1} cy={y1} r={3} fill="rgba(255,255,255,0.5)" />
            <circle cx={x2} cy={y2} r={3} fill="rgba(255,255,255,0.5)" />

            {/* Midpoint delete button (interactive — pointer-events enabled) */}
            <g
              transform={`translate(${mx},${my})`}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onMouseEnter={() => setHoverId(conn.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={e => { e.stopPropagation(); onRemove(conn.id); }}
            >
              {/* Label pill */}
              <rect x={-36} y={-11} width={72} height={22} rx={11}
                fill={`rgba(8,12,28,${hov ? 0.97 : 0.88})`}
                stroke={`rgba(${rgb},${hov ? 0.6 : 0.35})`}
                strokeWidth={1}
              />
              <text
                x={0} y={4.5}
                textAnchor="middle"
                fontSize={9}
                fontFamily="monospace"
                fontWeight={600}
                fill={`rgba(${rgb},${hov ? 1 : 0.75})`}
              >
                {fromGroup.label} ↔ {toGroup.label}
              </text>
              {/* × remove (only on hover) */}
              {hov && (
                <g transform="translate(26, 0)">
                  <circle r={8} fill={`rgba(${rgb},0.2)`} stroke={`rgba(${rgb},0.5)`} strokeWidth={1} />
                  <text textAnchor="middle" y={4} fontSize={11} fill="rgba(255,255,255,0.9)">×</text>
                </g>
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function ConnectionsLayer({ nodes }: { nodes: CanvasNode[] }) {
  // file-browser → editor connections
  const editorConns = nodes
    .filter(n => n.type === 'editor' && (n.data as unknown as EditorData).openedFromNodeId)
    .map(editorNode => {
      const fromId = (editorNode.data as unknown as EditorData).openedFromNodeId!;
      const from = nodes.find(n => n.id === fromId);
      if (!from) return null;
      return { key: editorNode.id, from, to: editorNode, color: '100,160,255' };
    })
    .filter(Boolean) as { key: string; from: CanvasNode; to: CanvasNode; color: string }[];

  // terminal → preview connections
  const previewConns = nodes
    .filter(n => n.type === 'preview' && (n.data as unknown as PreviewData).linkedTerminalId)
    .map(previewNode => {
      const termId = (previewNode.data as unknown as PreviewData).linkedTerminalId!;
      const term = nodes.find(n => n.id === termId);
      if (!term) return null;
      return { key: previewNode.id, from: term, to: previewNode, color: '80,210,140' };
    })
    .filter(Boolean) as { key: string; from: CanvasNode; to: CanvasNode; color: string }[];

  // files → claude-code connections (project panels)
  const claudeConns = nodes
    .filter(n => n.type === 'claude-code' && (n.data as unknown as TerminalData).linkedFilesNodeId)
    .map(claudeNode => {
      const filesId = (claudeNode.data as unknown as TerminalData).linkedFilesNodeId!;
      const files = nodes.find(n => n.id === filesId);
      if (!files) return null;
      return { key: `files-claude-${claudeNode.id}`, from: files, to: claudeNode, color: '255,160,60' };
    })
    .filter(Boolean) as { key: string; from: CanvasNode; to: CanvasNode; color: string }[];

  // claude-code → git connections (project panels)
  const gitConns = nodes
    .filter(n => n.type === 'git' && (n.data as unknown as GitData).linkedClaudeNodeId)
    .map(gitNode => {
      const claudeId = (gitNode.data as unknown as GitData).linkedClaudeNodeId!;
      const claude = nodes.find(n => n.id === claudeId);
      if (!claude) return null;
      return { key: `claude-git-${gitNode.id}`, from: claude, to: gitNode, color: '160,100,255' };
    })
    .filter(Boolean) as { key: string; from: CanvasNode; to: CanvasNode; color: string }[];

  const allConns = [...editorConns, ...previewConns, ...claudeConns, ...gitConns];
  if (!allConns.length) return null;

  return (
    <svg style={{
      position: 'absolute', left: 0, top: 0,
      width: 60000, height: 60000,
      pointerEvents: 'none', zIndex: 1,
      overflow: 'visible',
    }}>
      <defs>
        <filter id="conn-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {allConns.map(({ key, from, to, color }) => {
        const fromH = from.minimized ? TITLE_H : from.height;
        const toH   = to.minimized   ? TITLE_H : to.height;

        const x1 = from.x + from.width;
        const y1 = from.y + fromH / 2;
        const x2 = to.x;
        const y2 = to.y + toH / 2;
        const d  = bezierPath(x1, y1, x2, y2);

        return (
          <g key={key} filter="url(#conn-glow)">
            <path d={d} fill="none" stroke={`rgba(${color},0.12)`} strokeWidth={4} />
            <path d={d} fill="none" stroke={`rgba(${color},0.5)`} strokeWidth={1.5} strokeDasharray="5 4" />
            <circle cx={x1} cy={y1} r={3} fill={`rgba(${color},0.7)`} />
            <circle cx={x2} cy={y2} r={3} fill={`rgba(${color},0.7)`} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── MiniMap ──────────────────────────────────────────────────────────────────

const MINIMAP_W = 160;
const MINIMAP_H = 100;

function MiniMap({ nodes, canvasOffset, zoom, visible }: {
  nodes: CanvasNode[];
  canvasOffset: { x: number; y: number };
  zoom: number;
  visible: boolean;
}) {
  if (!visible || !nodes.length) return null;

  // Find bounding box of all nodes
  const xs = nodes.flatMap(n => [n.x, n.x + n.width]);
  const ys = nodes.flatMap(n => [n.y, n.y + (n.minimized ? 36 : n.height)]);
  const minX = Math.min(...xs) - 40;
  const minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs) + 40;
  const maxY = Math.max(...ys) + 40;
  const worldW = maxX - minX;
  const worldH = maxY - minY;

  const scaleX = MINIMAP_W / worldW;
  const scaleY = MINIMAP_H / worldH;
  const scale = Math.min(scaleX, scaleY, 0.15);

  // Viewport rect in world space
  const vpW = window.innerWidth / zoom;
  const vpH = window.innerHeight / zoom;
  const vpX = -canvasOffset.x / zoom;
  const vpY = -canvasOffset.y / zoom;

  const NODE_COLORS: Record<string, string> = {
    terminal: 'rgba(74,222,128,0.7)',
    files: 'rgba(100,160,255,0.7)',
    editor: 'rgba(140,190,255,0.7)',
    preview: 'rgba(250,204,21,0.7)',
    git: 'rgba(248,113,113,0.7)',
    docs: 'rgba(167,139,250,0.7)',
    notes: 'rgba(253,186,116,0.7)',
    http: 'rgba(34,211,238,0.7)',
    'ai-review': 'rgba(192,132,252,0.7)',
    default: 'rgba(255,255,255,0.4)',
  };

  return (
    <div style={{
      position: 'fixed', left: 20, bottom: 20, zIndex: 9000,
      background: 'rgba(8,12,28,0.82)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      overflow: 'hidden',
      width: MINIMAP_W, height: MINIMAP_H,
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      <svg width={MINIMAP_W} height={MINIMAP_H}>
        {/* Nodes */}
        {nodes.map(n => {
          const x = (n.x - minX) * scale;
          const y = (n.y - minY) * scale;
          const w = Math.max(3, n.width * scale);
          const h = Math.max(2, (n.minimized ? 36 : n.height) * scale);
          const color = NODE_COLORS[n.type] ?? NODE_COLORS.default;
          return (
            <rect key={n.id} x={x} y={y} width={w} height={h}
              fill={color} rx={1} opacity={0.8} />
          );
        })}

        {/* Viewport indicator */}
        <rect
          x={(vpX - minX) * scale}
          y={(vpY - minY) * scale}
          width={vpW * scale}
          height={vpH * scale}
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth={1}
          rx={2}
        />
      </svg>
    </div>
  );
}

// ─── Zoom HUD ─────────────────────────────────────────────────────────────────

function ZoomHUD({ zoom, onZoom, onReset }: {
  zoom: number;
  onZoom: (delta: number) => void;
  onReset: () => void;
}) {
  const pct = Math.round(zoom * 100);
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
      display: 'flex', alignItems: 'center', gap: 4,
      background: 'rgba(8,12,28,0.82)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 12,
      padding: '5px 8px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
      userSelect: 'none',
    }}>
      <button onClick={() => onZoom(-ZOOM_STEP)} title="Zoom out (Ctrl −)" style={zBtn}>−</button>
      <button
        onClick={onReset}
        title="Reset zoom (Ctrl 0)"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: zoom === 1 ? 'rgba(255,255,255,0.2)' : 'rgba(140,190,255,0.9)',
          fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
          padding: '2px 6px', borderRadius: 4, minWidth: 44, textAlign: 'center',
          transition: 'color 0.15s', letterSpacing: '0.04em',
        }}
      >
        {pct}%
      </button>
      <button onClick={() => onZoom(+ZOOM_STEP)} title="Zoom in (Ctrl +)" style={zBtn}>+</button>
    </div>
  );
}

const zBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  color: 'rgba(255,255,255,0.5)', cursor: 'pointer', width: 26, height: 22,
  fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
  lineHeight: 1,
};

// ─── Main Canvas ──────────────────────────────────────────────────────────────

interface GroupDragState {
  groupId: string;
  startX: number; startY: number;
  origPositions: { id: string; x: number; y: number }[];
}

export function Canvas() {
  const { nodes, groups, groupConnections, updateNode, bringToFront, removeNode, toggleMinimize, addNodeToGroup,
          canvasOffset, setCanvasOffset, zoom, setZoom, removeGroup, updateGroup, setNodesPositions,
          addGroupConnection, removeGroupConnection,
          undo, redo, pushHistory } = useCanvasStore();
  const [linkingFromGroupId, setLinkingFromGroupId] = useState<string | null>(null);
  const [activeId, setActiveId]             = useState<string | null>(null);
  const [canvasDrag, setCanvasDrag]         = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [highlightGroup, setHighlightGroup] = useState<string | null>(null);
  const [showMinimap, setShowMinimap]       = useState(true);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [boxSelect, setBoxSelect]           = useState<{
    startX: number; startY: number; endX: number; endY: number;
  } | null>(null);

  const drag          = useRef<DragState | null>(null);
  const resize        = useRef<ResizeState | null>(null);
  const groupDrag     = useRef<GroupDragState | null>(null);
  const boxSelectRef  = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const zoomRef       = useRef(zoom);             // always-current zoom for event handlers
  const offsetRef     = useRef(canvasOffset);
  const canvasRef     = useRef<HTMLDivElement>(null);

  // ── Placement mode (arrastar para posicionar node) ──────────────────────────
  const pending = useSyncExternalStore(subscribePlacement, getPlacementSnapshot);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  zoomRef.current   = zoom;
  offsetRef.current = canvasOffset;

  // ── Zoom logic ──────────────────────────────────────────────────────────────

  const applyZoom = useCallback((factor: number, cx: number, cy: number) => {
    const z  = zoomRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
    const af = nz / z;
    const o  = offsetRef.current;
    setCanvasOffset({ x: cx - (cx - o.x) * af, y: cy - (cy - o.y) * af });
    setZoom(nz);
  }, [setCanvasOffset, setZoom]);

  const zoomBy = useCallback((delta: number) => {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    applyZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current + delta)) / zoomRef.current, cx, cy);
  }, [applyZoom]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setCanvasOffset({ x: 0, y: 0 });
  }, [setZoom, setCanvasOffset]);

  // Wheel zoom — plain scroll on canvas, ignored inside node content
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Let scroll work normally inside node content (terminal, file list, etc.)
      if ((e.target as Element).closest?.('[data-node-content]')) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      applyZoom(factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyZoom]);


  // Rastrear posição do ghost no canvas world
  useEffect(() => {
    if (!pending) { setGhostPos(null); return; }
    const handler = (e: MouseEvent) => {
      const o = offsetRef.current; const z = zoomRef.current;
      setGhostPos({ x: (e.clientX - o.x) / z, y: (e.clientY - o.y) / z });
    };
    document.addEventListener('mousemove', handler);
    return () => document.removeEventListener('mousemove', handler);
  }, [pending]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { clearPlacement(); setLinkingFromGroupId(null); return; }
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(+ZOOM_STEP); }
      if (e.key === '-')                  { e.preventDefault(); zoomBy(-ZOOM_STEP); }
      if (e.key === '0')                  { e.preventDefault(); resetZoom(); }
      if (!e.shiftKey && e.key === 'z')   { e.preventDefault(); undo(); }
      if (e.shiftKey  && e.key === 'z')   { e.preventDefault(); redo(); }
      if (e.key === 'y')                  { e.preventDefault(); redo(); }
      if (e.key === 'g') {
        e.preventDefault();
        setSelected(prev => {
          const selectedArr = [...prev];
          if (selectedArr.length > 1) {
            useCanvasStore.getState().createGroup(selectedArr, 'Grupo');
            return new Set();
          }
          return prev;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomBy, resetZoom, undo, redo]);

  // ── Group hover detection ────────────────────────────────────────────────────

  function detectGroupHover(nodeId: string) {
    const state = useCanvasStore.getState();
    const dragged = state.nodes.find(n => n.id === nodeId);
    if (!dragged) return null;
    const cx = dragged.x + dragged.width / 2;
    const cy = dragged.y + nodeHeight(dragged) / 2;
    for (const group of state.groups) {
      if (group.nodeIds.includes(nodeId)) continue;
      const b = groupBounds(group, state.nodes);
      if (b && cx >= b.x1 && cx <= b.x2 && cy >= b.y1 && cy <= b.y2) return group.id;
    }
    return null;
  }

  // ── Mouse events ─────────────────────────────────────────────────────────────

  const startGroupDrag = useCallback((groupId: string, e: MouseEvent) => {
    e.stopPropagation();
    const state = useCanvasStore.getState();
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;
    state.pushHistory();
    const origPositions = group.nodeIds
      .map(id => state.nodes.find(n => n.id === id))
      .filter(Boolean)
      .map(n => ({ id: n!.id, x: n!.x, y: n!.y }));
    groupDrag.current = { groupId, startX: e.clientX, startY: e.clientY, origPositions };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const z = zoomRef.current;
    if (groupDrag.current) {
      const { startX, startY, origPositions } = groupDrag.current;
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      setNodesPositions(origPositions.map(p => ({ id: p.id, x: p.x + dx, y: p.y + dy })));
    } else if (drag.current) {
      // Divide screen delta by zoom to get world delta
      const dx = (e.clientX - drag.current.startX) / z;
      const dy = (e.clientY - drag.current.startY) / z;
      updateNode(drag.current.nodeId, { x: drag.current.origX + dx, y: drag.current.origY + dy });
      setHighlightGroup(detectGroupHover(drag.current.nodeId));
    } else if (boxSelectRef.current) {
      const worldX = (e.clientX - offsetRef.current.x) / z;
      const worldY = (e.clientY - offsetRef.current.y) / z;
      boxSelectRef.current = { ...boxSelectRef.current, endX: worldX, endY: worldY };
      setBoxSelect({ ...boxSelectRef.current });
    } else if (resize.current) {
      const { nodeId, dir, startX, startY, origX, origY, origW, origH } = resize.current;
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      let x = origX, y = origY, w = origW, h = origH;
      if (dir.includes('e')) w = Math.max(MIN_W, origW + dx);
      if (dir.includes('s')) h = Math.max(MIN_H, origH + dy);
      if (dir.includes('w')) { w = Math.max(MIN_W, origW - dx); x = origX + origW - w; }
      if (dir.includes('n')) { h = Math.max(MIN_H, origH - dy); y = origY + origH - h; }
      updateNode(nodeId, { x, y, width: w, height: h });
    } else if (canvasDrag) {
      setCanvasOffset({ x: canvasDrag.origX + (e.clientX - canvasDrag.startX), y: canvasDrag.origY + (e.clientY - canvasDrag.startY) });
    }
  }, [canvasDrag, setCanvasOffset]);

  const onMouseUp = useCallback(() => {
    if (groupDrag.current) {
      groupDrag.current = null;
    } else if (drag.current) {
      const hovered = detectGroupHover(drag.current.nodeId);
      if (hovered) addNodeToGroup(hovered, drag.current.nodeId);
      setHighlightGroup(null);
    } else if (boxSelectRef.current) {
      const bs = boxSelectRef.current;
      const x1 = Math.min(bs.startX, bs.endX);
      const y1 = Math.min(bs.startY, bs.endY);
      const x2 = Math.max(bs.startX, bs.endX);
      const y2 = Math.max(bs.startY, bs.endY);
      const newSelected = new Set<string>();
      const state = useCanvasStore.getState();
      for (const n of state.nodes) {
        if (n.x < x2 && n.x + n.width > x1 && n.y < y2 && n.y + (n.minimized ? 36 : n.height) > y1) {
          newSelected.add(n.id);
        }
      }
      setSelected(prev => new Set([...prev, ...newSelected]));
      setBoxSelect(null);
      boxSelectRef.current = null;
      drag.current = null;
      resize.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      return;
    }
    drag.current = null;
    resize.current = null;
    setCanvasDrag(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [addNodeToGroup]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  function startDrag(e: React.MouseEvent, node: CanvasNode) {
    e.preventDefault();
    pushHistory();
    bringToFront(node.id);
    setActiveId(node.id);
    drag.current = { nodeId: node.id, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
    document.body.style.userSelect = 'none';
  }

  function startResize(e: React.MouseEvent, node: CanvasNode, dir: ResizeDir) {
    e.preventDefault(); e.stopPropagation();
    bringToFront(node.id); setActiveId(node.id);
    resize.current = {
      nodeId: node.id, dir,
      startX: e.clientX, startY: e.clientY,
      origX: node.x, origY: node.y, origW: node.width, origH: node.height,
    };
    document.body.style.userSelect = 'none';
    const cursors: Record<ResizeDir, string> = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
    document.body.style.cursor = cursors[dir];
  }

  // ── Inferir cwd a partir do grupo onde o node foi solto ───────────────────
  function cwdFromGroup(worldX: number, worldY: number): string | null {
    for (const group of groups) {
      const b = groupBounds(group, nodes);
      if (!b) continue;
      if (worldX >= b.x1 && worldX <= b.x2 && worldY >= b.y1 && worldY <= b.y2) {
        // Pegar cwd dos membros do grupo
        for (const id of group.nodeIds) {
          const n = nodes.find(n => n.id === id);
          if (!n) continue;
          const d = n.data as any;
          const folder = d.currentPath ?? d.cwd ?? d.repoPath ?? null;
          if (folder && folder !== '~') return folder;
        }
      }
    }
    return null;
  }

  function startCanvasDrag(e: React.MouseEvent) {
    // ── Placement mode: clique coloca o node ───────────────────────────────
    if (pending) {
      const worldX = (e.clientX - canvasOffset.x) / zoom;
      const worldY = (e.clientY - canvasOffset.y) / zoom;
      const { addNode, createGroup, addNodeToGroup } = useCanvasStore.getState();

      const detectedCwd = cwdFromGroup(worldX, worldY);
      const groupHit = groups.find(g => {
        const b = groupBounds(g, nodes);
        return b ? worldX >= b.x1 && worldX <= b.x2 && worldY >= b.y1 && worldY <= b.y2 : false;
      });

      let extraData: Record<string, unknown> = {};
      if (pending.type === 'claude-code' || pending.type === 'terminal') {
        extraData = { cwd: detectedCwd || '~', status: 'idle', ...(pending.type === 'claude-code' ? { autoRun: 'claude' } : {}) };
      } else if (pending.type === 'files') {
        extraData = { currentPath: detectedCwd || '~', history: [] };
      } else if (pending.type === 'git') {
        extraData = { repoPath: detectedCwd || '~' };
      }

      const newNode = addNode(pending.type, { x: worldX - 200, y: worldY - 100 }, Object.keys(extraData).length ? { data: extraData } : undefined);
      if (groupHit) addNodeToGroup(groupHit.id, newNode.id);

      clearPlacement();
      e.stopPropagation();
      return;
    }

    if ((e.target as HTMLElement) !== canvasRef.current) return;
    setActiveId(null);
    if (e.shiftKey) {
      // Start box select
      const worldX = (e.clientX - canvasOffset.x) / zoom;
      const worldY = (e.clientY - canvasOffset.y) / zoom;
      const bs = { startX: worldX, startY: worldY, endX: worldX, endY: worldY };
      boxSelectRef.current = bs;
      setBoxSelect(bs);
    } else {
      setSelected(new Set()); // clear selection when clicking empty canvas
      setCanvasDrag({ startX: e.clientX, startY: e.clientY, origX: canvasOffset.x, origY: canvasOffset.y });
    }
    document.body.style.userSelect = 'none';
  }

  function renderNodeContent(node: CanvasNode) {
    switch (node.type) {
      case 'terminal':         return <TerminalNode nodeId={node.id} data={node.data as TerminalData} active={activeId === node.id} width={node.width} height={node.height - TITLE_H} />;
      case 'files':            return <FileBrowserNode nodeId={node.id} data={node.data as FilesData} />;
      case 'preview':          return <PreviewNode nodeId={node.id} data={node.data as PreviewData} width={node.width} height={node.height - TITLE_H} />;
      case 'git':              return <GitNode nodeId={node.id} data={node.data as unknown as GitData} />;
      case 'editor':           return <EditorNode nodeId={node.id} data={node.data as unknown as EditorData} />;
      case 'docs':             return <DocsNode nodeId={node.id} data={node.data as unknown as DocsData} width={node.width} height={node.height - TITLE_H} />;
      case 'notes':            return <NotesNode nodeId={node.id} data={node.data as NotesData} />;
      case 'http':             return <HttpClientNode nodeId={node.id} data={node.data as HttpClientData} />;
      case 'ai-review':        return <AiReviewNode nodeId={node.id} data={node.data as AiReviewData} />;
      case 'process-manager':  return <ProcessManagerNode />;
      case 'db-inspector':     return <DbInspectorNode nodeId={node.id} data={node.data as DbInspectorData} />;
      case 'claude-code':      return <ClaudeCodeNode nodeId={node.id} data={node.data as TerminalData} active={activeId === node.id} width={node.width} height={node.height - TITLE_H} />;
    }
  }

  // Grid adapts to zoom
  const gridSize = 32 * zoom;
  const gridX    = canvasOffset.x % gridSize;
  const gridY    = canvasOffset.y % gridSize;
  const RH = 6;

  return (
    <>
      <div
        ref={canvasRef}
        onMouseDown={startCanvasDrag}
        style={{
          position: 'fixed', inset: 0,
          background: `
            radial-gradient(ellipse at 15% 25%, rgba(110,50,220,0.14) 0%, transparent 55%),
            radial-gradient(ellipse at 85% 15%, rgba(40,100,255,0.14) 0%, transparent 55%),
            radial-gradient(ellipse at 55% 85%, rgba(0,190,140,0.08) 0%, transparent 45%),
            radial-gradient(ellipse at 75% 60%, rgba(200,50,120,0.06) 0%, transparent 40%),
            linear-gradient(145deg, #05080f 0%, #07091a 50%, #050810 100%)
          `,
          overflow: 'hidden',
          cursor: pending ? 'crosshair' : linkingFromGroupId ? 'crosshair' : canvasDrag ? 'grabbing' : 'default',
        }}
      >
        {/* Grid dots — scale-aware */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: Math.min(0.12, 0.06 + zoom * 0.06) }}>
          <defs>
            <pattern id="grid" x={gridX} y={gridY} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
              <circle cx={1 * zoom} cy={1 * zoom} r={Math.min(1.2, zoom * 0.8)} fill="rgba(160,200,255,0.8)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Canvas world */}
        <div style={{
          position: 'absolute',
          transformOrigin: '0 0',
          transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${zoom})`,
        }}>
          <GroupConnectionsLayer
            groupConnections={groupConnections}
            groups={groups}
            nodes={nodes}
            onRemove={removeGroupConnection}
          />

          <GroupsLayer
            groups={groups} nodes={nodes} highlightId={highlightGroup}
            onClose={id => { pushHistory(); removeGroup(id); }}
            onStartGroupDrag={startGroupDrag}
            onUpdateGroup={updateGroup}
            linkingFromGroupId={linkingFromGroupId}
            onLinkGroup={targetGroupId => {
              if (!linkingFromGroupId) {
                // iniciar ligação
                setLinkingFromGroupId(targetGroupId);
              } else if (linkingFromGroupId === targetGroupId) {
                // cancelar
                setLinkingFromGroupId(null);
              } else {
                // criar conexão
                addGroupConnection(linkingFromGroupId, targetGroupId);
                setLinkingFromGroupId(null);
              }
            }}
          />

          <ConnectionsLayer nodes={nodes} />

          {boxSelect && (
            <div style={{
              position: 'absolute',
              left: Math.min(boxSelect.startX, boxSelect.endX),
              top: Math.min(boxSelect.startY, boxSelect.endY),
              width: Math.abs(boxSelect.endX - boxSelect.startX),
              height: Math.abs(boxSelect.endY - boxSelect.startY),
              border: '1px solid rgba(100,160,255,0.5)',
              background: 'rgba(100,150,255,0.06)',
              borderRadius: 4,
              pointerEvents: 'none',
              zIndex: 99998,
            }} />
          )}

          {/* (personagens renderizados em screen space, fora deste div) */}

          {/* Ghost de posicionamento */}
          {pending && ghostPos && (
            <div style={{
              position: 'absolute',
              left: ghostPos.x - 200,
              top: ghostPos.y - 100,
              width: 400, height: 200,
              border: '2px dashed rgba(96,165,250,0.6)',
              borderRadius: 14,
              background: 'rgba(96,165,250,0.06)',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'none',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>{pending.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(147,197,253,0.9)' }}>{pending.label}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>clique para posicionar · ESC para cancelar</span>
            </div>
          )}

          {nodes.map(node => (
            <div
              key={node.id}
              style={{
                position: 'absolute', left: node.x, top: node.y,
                width: node.width, height: node.minimized ? TITLE_H : node.height,
                zIndex: node.zIndex, borderRadius: 16, overflow: 'hidden',
                background: 'rgba(10,14,32,0.72)',
                backdropFilter: 'blur(24px) saturate(160%)',
                WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                border: `1px solid ${
                  selected.has(node.id) ? 'rgba(100,160,255,0.6)' :
                  activeId === node.id ? 'rgba(140,185,255,0.35)' : 'rgba(255,255,255,0.08)'
                }`,
                boxShadow: activeId === node.id
                  ? '0 0 0 1px rgba(120,170,255,0.25), 0 20px 60px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.07)'
                  : '0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
                display: 'flex', flexDirection: 'column',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onMouseDown={(e) => {
                bringToFront(node.id);
                setActiveId(node.id);
                if (e.shiftKey) {
                  e.stopPropagation();
                  setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                }
              }}
            >
              <div
                onMouseDown={e => startDrag(e, node)}
                style={{
                  height: TITLE_H, minHeight: TITLE_H, display: 'flex',
                  alignItems: 'center', gap: 8, padding: '0 12px',
                  background: 'rgba(255,255,255,0.04)',
                  borderBottom: node.minimized ? 'none' : '1px solid rgba(255,255,255,0.07)',
                  cursor: 'grab', userSelect: 'none', flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div onClick={e => { e.stopPropagation(); pushHistory(); removeNode(node.id); }} title="Close" style={trafficLight('rgba(248,113,113,0.9)')} />
                  <div onClick={e => { e.stopPropagation(); toggleMinimize(node.id); }} title={node.minimized ? 'Restore' : 'Minimize'} style={trafficLight('rgba(250,204,21,0.9)')} />
                  <div style={trafficLight('rgba(74,222,128,0.9)')} />
                </div>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 4, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.type === 'terminal'         && '⌨️ '}
                  {node.type === 'files'            && '📁 '}
                  {node.type === 'preview'          && '🌐 '}
                  {node.type === 'git'              && '🔀 '}
                  {node.type === 'editor'           && '✏️ '}
                  {node.type === 'notes'            && '📝 '}
                  {node.type === 'http'             && '🌐 '}
                  {node.type === 'ai-review'        && '🤖 '}
                  {node.type === 'process-manager'  && '⚙️ '}
                  {node.type === 'db-inspector'     && '🗄️ '}
                  {node.type === 'claude-code'       && '◈ '}
                  {node.title}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>
                  {node.width}×{node.minimized ? 0 : node.height}
                </span>
              </div>

              {!node.minimized && (
                <div data-node-content style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                  {renderNodeContent(node)}
                </div>
              )}

              {!node.minimized && <>
                <div onMouseDown={e => startResize(e, node, 's')}  style={rh('s',  RH)} />
                <div onMouseDown={e => startResize(e, node, 'e')}  style={rh('e',  RH)} />
                <div onMouseDown={e => startResize(e, node, 'w')}  style={rh('w',  RH)} />
                <div onMouseDown={e => startResize(e, node, 'se')} style={rh('se', RH)} />
                <div onMouseDown={e => startResize(e, node, 'sw')} style={rh('sw', RH)} />
                <div onMouseDown={e => startResize(e, node, 'ne')} style={rh('ne', RH)} />
                <div onMouseDown={e => startResize(e, node, 'nw')} style={rh('nw', RH)} />
              </>}
            </div>
          ))}
        </div>
      </div>

      {/* Personagens Claude — em screen space, tamanho fixo */}
      <ClaudeCharacterOverlay nodes={nodes} zoom={zoom} canvasOffset={canvasOffset} />

      {/* Zoom HUD — outside canvas div so it's not affected by transforms */}
      <MiniMap nodes={nodes} canvasOffset={canvasOffset} zoom={zoom} visible={showMinimap} />
      <button
        onClick={() => setShowMinimap(m => !m)}
        title="Toggle minimap"
        style={{
          position: 'fixed', bottom: 20, right: 88, zIndex: 9000,
          background: showMinimap ? 'rgba(140,190,255,0.12)' : 'rgba(8,12,28,0.82)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${showMinimap ? 'rgba(140,190,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 8, color: showMinimap ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.4)',
          cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', padding: '4px 8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        map
      </button>
      <ZoomHUD zoom={zoom} onZoom={delta => zoomBy(delta)} onReset={resetZoom} />
    </>
  );
}

function trafficLight(color: string): React.CSSProperties {
  return { width: 12, height: 12, borderRadius: '50%', background: color, cursor: 'pointer', flexShrink: 0 };
}

function rh(dir: ResizeDir, size: number): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute', zIndex: 10 };
  const cursors: Record<ResizeDir, string> = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
  base.cursor = cursors[dir];
  const S = size, C = size * 2;
  if (dir === 's')  return { ...base, bottom: 0, left: C, right: C, height: S };
  if (dir === 'n')  return { ...base, top: 0, left: C, right: C, height: S };
  if (dir === 'e')  return { ...base, top: C, bottom: C, right: 0, width: S };
  if (dir === 'w')  return { ...base, top: C, bottom: C, left: 0, width: S };
  if (dir === 'se') return { ...base, bottom: 0, right: 0, width: C, height: C };
  if (dir === 'sw') return { ...base, bottom: 0, left: 0, width: C, height: C };
  if (dir === 'ne') return { ...base, top: 0, right: 0, width: C, height: C };
  if (dir === 'nw') return { ...base, top: 0, left: 0, width: C, height: C };
  return base;
}
