import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ws } from '../../ws';
import { useCanvasStore } from '../../store';
import { TerminalData, TerminalPane as TerminalPaneData, PreviewData } from '../../types';

// Matches URLs printed by dev servers: http://localhost:5173 or http://127.0.0.1:3000
const SERVER_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/;

// Track which terminals already spawned a preview (prevents duplicates)
const previewCreated = new Set<string>();

interface Props {
  nodeId: string;
  data: TerminalData;
  active: boolean;
  width: number;
  height: number;
}

// ─── Shared terminal theme / options ────────────────────────────────────────

function makeTerminal(): Terminal {
  return new Terminal({
    theme: {
      background: '#050810',
      foreground: 'rgba(220,230,245,0.92)',
      cursor: 'rgba(160,200,255,0.9)',
      cursorAccent: '#050810',
      selectionBackground: 'rgba(100,150,255,0.25)',
      black: '#2a2e3a',
      red: '#ff7b72',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#7eb6ff',
      magenta: '#c084fc',
      cyan: '#34d399',
      white: 'rgba(200,215,235,0.85)',
      brightBlack: '#4a5168',
      brightRed: '#ffa198',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#6ee7b7',
      brightWhite: 'rgba(240,248,255,0.95)',
    },
    fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
    fontSize: 13,
    lineHeight: 1.45,
    cursorBlink: true,
    allowTransparency: true,
  });
}

// ─── Single pane component ───────────────────────────────────────────────────

interface PaneProps {
  paneId: string;       // session id sent to server
  nodeId: string;       // the canvas node id (used for auto-preview, autoRun)
  data: TerminalData;
  isActive: boolean;
  showClose: boolean;   // show × button?
  onActivate: () => void;
  onClose: () => void;
  flex: number;         // flex grow value (0.3, 0.7, etc.)
  totalHeight: number;  // px — so we can size correctly
}

function TerminalPane({
  paneId,
  nodeId,
  data,
  isActive,
  showClose,
  onActivate,
  onClose,
  flex,
  totalHeight,
}: PaneProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unsubRef = useRef<(() => void)[]>([]);
  const { updateNodeData } = useCanvasStore();
  const [cwd, setCwd] = useState(data.cwd || '~');

  // Boot terminal
  useEffect(() => {
    if (!termRef.current) return;

    const term = makeTerminal();
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    // Send input to server — use paneId as session id
    term.onData(d => {
      ws.send({ type: 'terminal:input', id: paneId, data: d });
    });

    // Buffer for detecting dev server URL across chunked PTY output
    let outBuf = '';

    const offOutput = ws.on('terminal:output', (msg) => {
      if (msg.id !== paneId) return;
      term.write(msg.data);

      // Auto-preview only for the primary pane (paneId === nodeId) to avoid duplicates
      if (!data.autoPreview || paneId !== nodeId || previewCreated.has(nodeId)) return;

      const plain = (msg.data as string).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      outBuf += plain;
      if (outBuf.length > 4000) outBuf = outBuf.slice(-4000);

      const urlMatch = outBuf.match(SERVER_URL_RE);
      if (!urlMatch) return;

      previewCreated.add(nodeId);
      outBuf = '';

      const detectedUrl = urlMatch[0].replace(/\/$/, '');
      const store = useCanvasStore.getState();
      const termNode = store.nodes.find(n => n.id === nodeId);
      if (!termNode) return;

      // Check if a preview linked to this terminal already exists — avoid duplicates on reload
      const existing = store.nodes.find(
        n => n.type === 'preview' && (n.data as PreviewData).linkedTerminalId === nodeId
      );
      if (existing) {
        store.updateNodeData(existing.id, { url: detectedUrl, inputUrl: detectedUrl } as Partial<PreviewData>);
        return;
      }

      const group = store.groups.find(g => g.nodeIds.includes(nodeId));
      const prevNode = store.addNode('preview', { x: termNode.x + termNode.width + 36, y: termNode.y }, {
        title: `Preview :${urlMatch[1]}`,
        width: 800, height: 520,
        data: { url: detectedUrl, inputUrl: detectedUrl, linkedTerminalId: nodeId } as PreviewData,
      });
      if (group) store.addNodeToGroup(group.id, prevNode.id);
    });

    const offReady = ws.on('terminal:ready', (msg) => {
      if (msg.id !== paneId) return;
      // Only update the node-level status for the primary pane
      if (paneId === nodeId) updateNodeData(nodeId, { status: 'ready' });
      // Replay scrollback if the server sent it
      if (msg.scrollback) term.write(msg.scrollback);
      if (isActive) term.focus();
      if (paneId === nodeId && data.autoRun) {
        setTimeout(() => {
          ws.send({ type: 'terminal:input', id: paneId, data: data.autoRun + '\n' });
        }, 120);
      }
    });

    const offExit = ws.on('terminal:exit', (msg) => {
      if (msg.id !== paneId) return;
      if (paneId === nodeId) updateNodeData(nodeId, { status: 'exited' });
      term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
    });

    unsubRef.current = [offOutput, offReady, offExit];

    // Create terminal session on server
    if (paneId === nodeId) updateNodeData(nodeId, { status: 'connecting' });
    ws.send({
      type: 'terminal:create',
      id: paneId,
      cwd: data.cwd || '~',
      cols: term.cols,
      rows: term.rows,
    });

    return () => {
      unsubRef.current.forEach(f => f());
      term.dispose();
      ws.send({ type: 'terminal:kill', id: paneId });
      if (paneId === nodeId) previewCreated.delete(nodeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refit when flex share or totalHeight changes
  useEffect(() => {
    setTimeout(() => {
      fitRef.current?.fit();
      if (xtermRef.current) {
        ws.send({
          type: 'terminal:resize',
          id: paneId,
          cols: xtermRef.current.cols,
          rows: xtermRef.current.rows,
        });
      }
    }, 50);
  }, [flex, totalHeight]);

  // Focus when active
  useEffect(() => {
    if (isActive) xtermRef.current?.focus();
  }, [isActive]);

  function restartSession() {
    if (paneId === nodeId) updateNodeData(nodeId, { status: 'connecting' });
    ws.send({
      type: 'terminal:create',
      id: paneId,
      cwd: cwd,
      cols: xtermRef.current?.cols || 80,
      rows: xtermRef.current?.rows || 24,
    });
    xtermRef.current?.clear();
  }

  const statusColor =
    paneId === nodeId
      ? data.status === 'ready'
        ? '#4ade80'
        : data.status === 'exited'
        ? '#f87171'
        : '#facc15'
      : '#4ade80'; // secondary panes don't track global status

  return (
    <div
      onClick={onActivate}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        outline: isActive ? '1px solid rgba(100,160,255,0.35)' : '1px solid transparent',
        borderRadius: 3,
        transition: 'outline-color 0.15s',
      }}
    >
      {/* Pane toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 12,
        flexShrink: 0,
      }}>
        <span style={{ color: statusColor, fontSize: 8, lineHeight: 1, filter: `drop-shadow(0 0 4px ${statusColor})` }}>●</span>
        <input
          value={cwd}
          onChange={e => setCwd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') restartSession(); }}
          placeholder="Working directory"
          title="Working directory (Enter to restart)"
          onClick={e => e.stopPropagation()}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'rgba(140,190,255,0.85)', fontSize: 12, flex: 1, minWidth: 0,
            fontFamily: 'monospace',
          }}
        />
        <button
          onClick={(e) => { e.stopPropagation(); restartSession(); }}
          title="Restart terminal"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5,
            color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
            padding: '1px 7px', fontSize: 12,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
        >
          ↺
        </button>
        {showClose && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close pane"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 5,
              color: 'rgba(255,100,100,0.5)', cursor: 'pointer',
              padding: '1px 6px', fontSize: 12,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,100,100,0.9)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,100,100,0.5)'; }}
          >
            ×
          </button>
        )}
      </div>
      {/* Terminal output area */}
      <div
        ref={termRef}
        style={{ flex: 1, padding: '6px 4px 4px', overflow: 'hidden', minHeight: 0 }}
      />
    </div>
  );
}

// ─── Draggable divider ───────────────────────────────────────────────────────

interface DividerProps {
  direction: 'horizontal' | 'vertical';
  onDrag: (delta: number) => void;
}

function PaneDivider({ direction, onDrag }: DividerProps) {
  const startRef = useRef<number>(0);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    startRef.current = direction === 'horizontal' ? e.clientX : e.clientY;

    function onMouseMove(ev: MouseEvent) {
      const pos = direction === 'horizontal' ? ev.clientX : ev.clientY;
      onDrag(pos - startRef.current);
      startRef.current = pos;
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  const isHoriz = direction === 'horizontal';
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width: isHoriz ? 5 : '100%',
        height: isHoriz ? '100%' : 5,
        background: 'rgba(255,255,255,0.07)',
        cursor: isHoriz ? 'col-resize' : 'row-resize',
        transition: 'background 0.15s',
        position: 'relative',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(100,160,255,0.3)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.07)'; }}
    />
  );
}

// ─── Main TerminalNode ───────────────────────────────────────────────────────

export function TerminalNode({ nodeId, data, active, width, height }: Props) {
  const { updateNodeData } = useCanvasStore();

  // Split ratio: proportion for the first pane (0..1). Default 0.5.
  const [splitRatio, setSplitRatio] = useState(0.5);

  const panes: TerminalPaneData[] = data.panes ?? [];
  const isSplit = panes.length >= 2;
  const activePaneId = data.activePaneId ?? (panes[0]?.id ?? nodeId);
  const splitDirection = data.splitDirection ?? 'horizontal';

  // Toolbar height in px (for computing pane area)
  const TOOLBAR_H = 32;
  const paneAreaHeight = height - TOOLBAR_H;

  // ── Split actions ──────────────────────────────────────────────────────────

  function doSplit(direction: 'horizontal' | 'vertical') {
    if (isSplit) return; // already split

    const pane1: TerminalPaneData = { id: nodeId, cwd: data.cwd || '~' };
    const pane2Id = `${nodeId}-pane2-${Date.now()}`;
    const pane2: TerminalPaneData = { id: pane2Id, cwd: data.cwd || '~' };

    setSplitRatio(0.5);
    updateNodeData(nodeId, {
      panes: [pane1, pane2],
      activePaneId: nodeId,
      splitDirection: direction,
    } as Partial<TerminalData>);
  }

  function doCloseSplit() {
    // Kill secondary panes
    const secondary = panes.filter(p => p.id !== nodeId);
    secondary.forEach(p => ws.send({ type: 'terminal:kill', id: p.id }));

    updateNodeData(nodeId, {
      panes: undefined,
      activePaneId: undefined,
      splitDirection: undefined,
    } as Partial<TerminalData>);
  }

  function closePane(paneId: string) {
    ws.send({ type: 'terminal:kill', id: paneId });
    const remaining = panes.filter(p => p.id !== paneId);
    if (remaining.length <= 1) {
      updateNodeData(nodeId, {
        panes: undefined,
        activePaneId: undefined,
        splitDirection: undefined,
      } as Partial<TerminalData>);
    } else {
      updateNodeData(nodeId, {
        panes: remaining,
        activePaneId: remaining[0].id,
      } as Partial<TerminalData>);
    }
  }

  const handleDividerDrag = useCallback((delta: number) => {
    const totalSize = splitDirection === 'horizontal' ? width : paneAreaHeight;
    setSplitRatio(prev => {
      const newRatio = prev + delta / totalSize;
      return Math.min(0.85, Math.max(0.15, newRatio));
    });
  }, [width, paneAreaHeight, splitDirection]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(4,6,16,0.88)' }}>
      {/* Node-level toolbar (split buttons) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 4, padding: '3px 8px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        fontSize: 11,
        height: TOOLBAR_H,
        flexShrink: 0,
      }}>
        {!isSplit && (
          <>
            <button
              onClick={() => doSplit('horizontal')}
              title="Split horizontal (side by side)"
              style={splitBtnStyle}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
            >
              ⊞
            </button>
            <button
              onClick={() => doSplit('vertical')}
              title="Split vertical (top and bottom)"
              style={splitBtnStyle}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
            >
              ⊟
            </button>
          </>
        )}
        {isSplit && (
          <button
            onClick={doCloseSplit}
            title="Close split — back to single pane"
            style={{ ...splitBtnStyle, color: 'rgba(255,180,100,0.5)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,180,100,0.9)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,180,100,0.5)'; }}
          >
            ⊠ unsplit
          </button>
        )}
      </div>

      {/* Pane area */}
      {!isSplit ? (
        // ── Single-pane mode (backward-compatible) ──
        <SinglePaneLegacy
          nodeId={nodeId}
          data={data}
          active={active}
          width={width}
          height={paneAreaHeight}
          updateNodeData={updateNodeData}
        />
      ) : (
        // ── Split mode ──
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: splitDirection === 'horizontal' ? 'row' : 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <TerminalPane
            key={panes[0].id}
            paneId={panes[0].id}
            nodeId={nodeId}
            data={{ ...data, cwd: panes[0].cwd }}
            isActive={activePaneId === panes[0].id}
            showClose={true}
            onActivate={() => updateNodeData(nodeId, { activePaneId: panes[0].id } as Partial<TerminalData>)}
            onClose={() => closePane(panes[0].id)}
            flex={splitRatio}
            totalHeight={paneAreaHeight}
          />
          <PaneDivider direction={splitDirection} onDrag={handleDividerDrag} />
          <TerminalPane
            key={panes[1].id}
            paneId={panes[1].id}
            nodeId={nodeId}
            data={{ ...data, cwd: panes[1].cwd }}
            isActive={activePaneId === panes[1].id}
            showClose={true}
            onActivate={() => updateNodeData(nodeId, { activePaneId: panes[1].id } as Partial<TerminalData>)}
            onClose={() => closePane(panes[1].id)}
            flex={1 - splitRatio}
            totalHeight={paneAreaHeight}
          />
        </div>
      )}
    </div>
  );
}

// ─── Shared button style ─────────────────────────────────────────────────────

const splitBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5,
  color: 'rgba(255,255,255,0.4)',
  cursor: 'pointer',
  padding: '1px 7px',
  fontSize: 13,
  transition: 'all 0.15s',
};

// ─── Legacy single-pane (original TerminalNode internals) ────────────────────
// Kept separate so the split-mode panes use TerminalPane above, while
// single-mode continues to work exactly as before.

interface LegacyProps {
  nodeId: string;
  data: TerminalData;
  active: boolean;
  width: number;
  height: number;
  updateNodeData: (id: string, data: Partial<TerminalData>) => void;
}

function SinglePaneLegacy({ nodeId, data, active, width, height, updateNodeData }: LegacyProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unsubRef = useRef<(() => void)[]>([]);
  const [cwd, setCwd] = useState(data.cwd || '~');

  // Boot terminal
  useEffect(() => {
    if (!termRef.current) return;

    const term = makeTerminal();
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    term.onData(d => {
      ws.send({ type: 'terminal:input', id: nodeId, data: d });
    });

    let outBuf = '';

    const offOutput = ws.on('terminal:output', (msg) => {
      if (msg.id !== nodeId) return;
      term.write(msg.data);

      if (!data.autoPreview || previewCreated.has(nodeId)) return;

      const plain = (msg.data as string).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      outBuf += plain;
      if (outBuf.length > 4000) outBuf = outBuf.slice(-4000);

      const urlMatch = outBuf.match(SERVER_URL_RE);
      if (!urlMatch) return;

      previewCreated.add(nodeId);
      outBuf = '';

      const detectedUrl = urlMatch[0].replace(/\/$/, '');
      const store = useCanvasStore.getState();
      const termNode = store.nodes.find(n => n.id === nodeId);
      if (!termNode) return;

      // Check if a preview linked to this terminal already exists — avoid duplicates on reload
      const existing = store.nodes.find(
        n => n.type === 'preview' && (n.data as PreviewData).linkedTerminalId === nodeId
      );
      if (existing) {
        store.updateNodeData(existing.id, { url: detectedUrl, inputUrl: detectedUrl } as Partial<PreviewData>);
        return;
      }

      const group = store.groups.find(g => g.nodeIds.includes(nodeId));
      const prevNode = store.addNode('preview', { x: termNode.x + termNode.width + 36, y: termNode.y }, {
        title: `Preview :${urlMatch[1]}`,
        width: 800, height: 520,
        data: { url: detectedUrl, inputUrl: detectedUrl, linkedTerminalId: nodeId } as PreviewData,
      });
      if (group) store.addNodeToGroup(group.id, prevNode.id);
    });

    const offReady = ws.on('terminal:ready', (msg) => {
      if (msg.id !== nodeId) return;
      updateNodeData(nodeId, { status: 'ready' });
      // Replay scrollback if provided
      if (msg.scrollback) term.write(msg.scrollback);
      term.focus();
      if (data.autoRun) {
        setTimeout(() => {
          ws.send({ type: 'terminal:input', id: nodeId, data: data.autoRun + '\n' });
        }, 120);
      }
    });

    const offExit = ws.on('terminal:exit', (msg) => {
      if (msg.id !== nodeId) return;
      updateNodeData(nodeId, { status: 'exited' });
      term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
    });

    unsubRef.current = [offOutput, offReady, offExit];

    updateNodeData(nodeId, { status: 'connecting' });
    ws.send({
      type: 'terminal:create',
      id: nodeId,
      cwd: data.cwd || '~',
      cols: term.cols,
      rows: term.rows,
    });

    return () => {
      unsubRef.current.forEach(f => f());
      term.dispose();
      ws.send({ type: 'terminal:kill', id: nodeId });
      previewCreated.delete(nodeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit on resize
  useEffect(() => {
    if (!fitRef.current || !xtermRef.current) return;
    setTimeout(() => {
      fitRef.current?.fit();
      ws.send({
        type: 'terminal:resize',
        id: nodeId,
        cols: xtermRef.current!.cols,
        rows: xtermRef.current!.rows,
      });
    }, 50);
  }, [width, height]);

  // Focus when active
  useEffect(() => {
    if (active && data.status === 'ready') {
      xtermRef.current?.focus();
    }
  }, [active]);

  function restartSession() {
    updateNodeData(nodeId, { status: 'connecting' });
    ws.send({
      type: 'terminal:create',
      id: nodeId,
      cwd: cwd,
      cols: xtermRef.current?.cols || 80,
      rows: xtermRef.current?.rows || 24,
    });
    xtermRef.current?.clear();
  }

  const statusColor = data.status === 'ready' ? '#4ade80' : data.status === 'exited' ? '#f87171' : '#facc15';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 12,
        flexShrink: 0,
      }}>
        <span style={{ color: statusColor, fontSize: 8, lineHeight: 1, filter: `drop-shadow(0 0 4px ${statusColor})` }}>●</span>
        <input
          value={cwd}
          onChange={e => setCwd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') restartSession(); }}
          placeholder="Working directory"
          title="Working directory (Enter to restart)"
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'rgba(140,190,255,0.85)', fontSize: 12, flex: 1, minWidth: 0,
            fontFamily: 'monospace',
          }}
        />
        <button
          onClick={restartSession}
          title="Restart terminal"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5,
            color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
            padding: '1px 7px', fontSize: 12,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
        >
          ↺
        </button>
      </div>
      <div
        ref={termRef}
        style={{ flex: 1, padding: '6px 4px 4px', overflow: 'hidden', minHeight: 0 }}
      />
    </div>
  );
}
