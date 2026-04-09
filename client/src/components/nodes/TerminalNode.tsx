import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ws } from '../../ws';
import { useCanvasStore } from '../../store';
import { TerminalData, PreviewData } from '../../types';

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

export function TerminalNode({ nodeId, data, active, width, height }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unsubRef = useRef<(() => void)[]>([]);
  const { updateNodeData } = useCanvasStore();
  const [cwd, setCwd] = useState(data.cwd || '~');

  // Boot terminal
  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
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

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    // Send input to server
    term.onData(data => {
      ws.send({ type: 'terminal:input', id: nodeId, data });
    });

    // Buffer for detecting dev server URL across chunked PTY output
    let outBuf = '';

    // Listen for output
    const offOutput = ws.on('terminal:output', (msg) => {
      if (msg.id !== nodeId) return;
      term.write(msg.data);

      // Auto-create preview once dev server URL is detected in output
      if (!data.autoPreview || previewCreated.has(nodeId)) return;

      // Strip ANSI escape codes and accumulate in buffer
      const plain = (msg.data as string).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      outBuf += plain;
      if (outBuf.length > 4000) outBuf = outBuf.slice(-4000);

      const urlMatch = outBuf.match(SERVER_URL_RE);
      if (!urlMatch) return;

      // URL found — create preview immediately
      previewCreated.add(nodeId);
      outBuf = '';

      const detectedUrl = urlMatch[0].replace(/\/$/, '');
      const store = useCanvasStore.getState();
      const termNode = store.nodes.find(n => n.id === nodeId);
      if (!termNode) return;

      const group = store.groups.find(g => g.nodeIds.includes(nodeId));
      const prevNode = store.addNode('preview', { x: termNode.x + termNode.width + 36, y: termNode.y }, {
        title: `Preview :${urlMatch[1]}`,
        width: 800, height: 520,
        data: { url: detectedUrl, inputUrl: detectedUrl, linkedTerminalId: nodeId } as PreviewData,
      });
      if (group) store.addNodeToGroup(group.id, prevNode.id);
    });
    const offReady = ws.on('terminal:ready', (msg) => {
      if (msg.id === nodeId) {
        updateNodeData(nodeId, { status: 'ready' });
        term.focus();
        if (data.autoRun) {
          setTimeout(() => {
            ws.send({ type: 'terminal:input', id: nodeId, data: data.autoRun + '\n' });
          }, 120);
        }
      }
    });
    const offExit = ws.on('terminal:exit', (msg) => {
      if (msg.id === nodeId) {
        updateNodeData(nodeId, { status: 'exited' });
        term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
      }
    });

    unsubRef.current = [offOutput, offReady, offExit];

    // Create terminal session on server
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(4,6,16,0.88)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 12,
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
        style={{ flex: 1, padding: '6px 4px 4px', overflow: 'hidden' }}
      />
    </div>
  );
}
