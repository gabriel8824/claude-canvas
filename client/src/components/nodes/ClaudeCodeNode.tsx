import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ws } from '../../ws';
import { useCanvasStore } from '../../store';
import { TerminalData } from '../../types';
import { setClaudeActivity, clearClaudeActivity, ActivityKind, ClaudeActivity } from '../../claudeActivityStore';

interface Props {
  nodeId: string;
  data: TerminalData;
  active: boolean;
  width: number;
  height: number;
}

// ── CSS animations (injetados globalmente uma vez) ────────────────────────────
const ANIMS = `
@keyframes cc-bob        { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-5px)} }
@keyframes cc-bob-fast   { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-4px)} }
@keyframes cc-shake      { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-3px)} 40%,80%{transform:translateX(3px)} }
@keyframes cc-jump       { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-10px)} }
@keyframes cc-arm-l-idle { 0%,100%{transform:rotate(-8deg)}  50%{transform:rotate(-3deg)} }
@keyframes cc-arm-r-idle { 0%,100%{transform:rotate(8deg)}   50%{transform:rotate(3deg)} }
@keyframes cc-arm-l-type { 0%,100%{transform:rotate(25deg)}  50%{transform:rotate(45deg)} }
@keyframes cc-arm-r-type { 0%,100%{transform:rotate(-25deg)} 50%{transform:rotate(-45deg)} }
@keyframes cc-arm-l-think{ 0%,100%{transform:rotate(-55deg)} 50%{transform:rotate(-60deg)} }
@keyframes cc-arm-r-think{ 0%,100%{transform:rotate(8deg)}   50%{transform:rotate(3deg)} }
@keyframes cc-arm-l-done { 0%,100%{transform:rotate(-80deg)} 50%{transform:rotate(-65deg)} }
@keyframes cc-arm-r-done { 0%,100%{transform:rotate(-80deg)} 50%{transform:rotate(-65deg)} }
@keyframes cc-arm-worry  { 0%,100%{transform:rotate(-65deg)} 50%{transform:rotate(-75deg)} }
@keyframes cc-eye-blink  { 0%,90%,100%{transform:scaleY(1)}  94%,97%{transform:scaleY(0.08)} }
@keyframes cc-eye-scan   { 0%,100%{transform:translateX(-2px)} 50%{transform:translateX(2px)} }
@keyframes cc-antenna    { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(8deg)} }
@keyframes cc-glow       { 0%,100%{opacity:0.6;r:3} 50%{opacity:1;r:4} }
@keyframes cc-think-dot  { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
@keyframes cc-spark      { 0%{opacity:0;transform:scale(0) rotate(0deg)} 50%{opacity:1;transform:scale(1.1) rotate(15deg)} 100%{opacity:0;transform:scale(0.5) rotate(30deg)} }
@keyframes cc-float-in   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
@keyframes cc-sub-bob    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
@keyframes cc-pulse      { 0%,100%{opacity:1} 50%{opacity:0.25} }
@keyframes cc-screen-scan{ 0%,100%{background-position:0 0} 100%{background-position:0 100%} }
`;

let animsInjected = false;

// ── Parser de atividade ───────────────────────────────────────────────────────

const STRIP_ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g;

function parseActivity(lines: string[]): ClaudeActivity {
  let agents = 0;
  for (const l of lines) { if (/Agent\s*\(/.test(l)) agents++; }

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 60); i--) {
    const line = lines[i].trim();
    if (!line) continue;

    const toolMatch = line.match(/[⏺·▸➤]\s+([A-Za-z]+)\s*[\(\[]/);
    if (toolMatch) {
      const name = toolMatch[1];
      const argMatch = line.match(/[(\[](.{0,60})/);
      const arg = argMatch ? argMatch[1].replace(/[)\]]+.*$/, '').trim() : '';
      const labels: Record<string, string> = {
        Bash:'bash', Read:'lendo', Write:'escrevendo', Edit:'editando',
        Glob:'buscando', Grep:'buscando', Agent:'subagente', WebFetch:'fetch',
        WebSearch:'pesquisando', Task:'tarefa', TodoWrite:'planejando',
      };
      const kind: ActivityKind = name === 'Agent' ? 'agent' : 'tool';
      return { kind, label: labels[name] ?? name.toLowerCase(), tool: arg || undefined, agents };
    }
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line) || /thinking|pensand/i.test(line))
      return { kind: 'thinking', label: 'pensando', agents };
    if (/\b(error|erro|failed|falhou)\b/i.test(line) && !/^#/.test(line))
      return { kind: 'error', label: 'erro', agents };
    if (/[✓✔]|conclu|done|pronto|finaliz/i.test(line))
      return { kind: 'done', label: 'concluído', agents };
  }
  return { kind: 'idle', label: '', agents: 0 };
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ClaudeCodeNode({ nodeId, data, active, width, height }: Props) {
  const termRef    = useRef<HTMLDivElement>(null);
  const xtermRef   = useRef<Terminal | null>(null);
  const fitRef     = useRef<FitAddon | null>(null);
  const unsubRef   = useRef<(() => void)[]>([]);
  const linesRef   = useRef<string[]>([]);
  const lineAccRef = useRef<string>('');
  const [status, setStatus] = useState<'idle'|'connecting'|'ready'|'exited'>('idle');
  const { updateNodeData } = useCanvasStore();

  // Injeta CSS uma vez
  if (!animsInjected) {
    const s = document.createElement('style');
    s.textContent = ANIMS;
    document.head.appendChild(s);
    animsInjected = true;
  }

  useEffect(() => {
    if (!termRef.current) return;
    const term = new Terminal({
      theme: {
        background: '#080c14', foreground: 'rgba(200,215,235,0.9)',
        cursor: 'rgba(140,180,255,0.85)', cursorAccent: '#080c14',
        selectionBackground: 'rgba(100,150,255,0.2)',
        black: '#1e2030', red: '#f47067', green: '#6ee7b7',
        yellow: '#fbbf24', blue: '#7eb6ff', magenta: '#c084fc',
        cyan: '#5eead4', white: 'rgba(200,215,235,0.85)',
        brightBlack: '#3b4261', brightRed: '#ff8a7a', brightGreen: '#a7f3d0',
        brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
        brightCyan: '#99f6e4', brightWhite: 'rgba(240,248,255,0.95)',
      },
      fontFamily: '"Cascadia Code","Fira Code","JetBrains Mono",monospace',
      fontSize: 13, lineHeight: 1.5, cursorBlink: true,
      allowTransparency: true, scrollback: 8000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current   = fit;

    term.onData(d => ws.send({ type: 'terminal:input', id: nodeId, data: d }));

    function feedBuffer(raw: string) {
      const text = raw.replace(STRIP_ANSI, '');
      lineAccRef.current += text;
      const parts = lineAccRef.current.split('\n');
      lineAccRef.current = parts.pop() ?? '';
      if (parts.length) {
        linesRef.current = [...linesRef.current, ...parts].slice(-300);
        setClaudeActivity(nodeId, parseActivity(linesRef.current));
      }
    }

    const offOutput = ws.on('terminal:output', (msg) => {
      if (msg.id !== nodeId) return;
      term.write(msg.data);
      feedBuffer(msg.data as string);
    });
    const offReady = ws.on('terminal:ready', (msg) => {
      if (msg.id !== nodeId) return;
      setStatus('ready');
      updateNodeData(nodeId, { status: 'ready' });
      if (msg.scrollback) { term.write(msg.scrollback); feedBuffer(msg.scrollback as string); }
      if (!msg.scrollback && data.autoRun)
        setTimeout(() => ws.send({ type: 'terminal:input', id: nodeId, data: data.autoRun + '\n' }), 180);
      if (active) term.focus();
    });
    const offExit = ws.on('terminal:exit', (msg) => {
      if (msg.id !== nodeId) return;
      setStatus('exited');
      updateNodeData(nodeId, { status: 'exited' });
      clearClaudeActivity(nodeId);
      term.write('\r\n\x1b[2m[sessão encerrada]\x1b[0m\r\n');
    });

    unsubRef.current = [offOutput, offReady, offExit];
    setStatus('connecting');
    updateNodeData(nodeId, { status: 'connecting' });
    ws.send({ type: 'terminal:create', id: nodeId, cwd: data.cwd || '~', cols: term.cols, rows: term.rows });

    return () => {
      unsubRef.current.forEach(f => f());
      term.dispose();
      clearClaudeActivity(nodeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setTimeout(() => {
      fitRef.current?.fit();
      if (xtermRef.current)
        ws.send({ type: 'terminal:resize', id: nodeId, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
    }, 40);
  }, [width, height, nodeId]);

  useEffect(() => { if (active) xtermRef.current?.focus(); }, [active]);

  const cwd = (data.cwd || '~').replace(/^\/Users\/[^/]+/, '~');
  const statusColor = status === 'ready' ? '#6ee7b7' : status === 'exited' ? '#f47067' : '#fbbf24';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#080c14', borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
      {/* Header compacto */}
      <div style={{
        height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
        background: 'rgba(255,255,255,0.025)', borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.85 }}>
          <rect width="16" height="16" rx="4" fill="rgba(200,100,60,0.25)" />
          <path d="M8 3L11 10.5H9.6L8 6L6.4 10.5H5L8 3Z" fill="rgba(230,160,100,0.9)" />
          <line x1="6" y1="8" x2="10" y2="8" stroke="rgba(230,160,100,0.9)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(200,215,235,0.85)', letterSpacing: '-0.01em' }}>Claude Code</span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: statusColor,
          background: `${statusColor}15`, border: `1px solid ${statusColor}35`,
          borderRadius: 10, padding: '1px 7px',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          {status === 'ready' ? 'ativo' : status === 'exited' ? 'encerrado' : status === 'connecting' ? 'conectando' : 'idle'}
        </span>
        <span style={{ flex: 1, fontSize: 10, color: 'rgba(255,255,255,0.22)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cwd}
        </span>
        <button
          onClick={() => ws.send({ type: 'terminal:input', id: nodeId, data: 'claude\n' })}
          title="Reiniciar Claude"
          style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', borderRadius: 5, transition: 'color 0.15s', flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,160,100,0.9)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.25)'; }}
        >↺</button>
      </div>
      {/* Terminal */}
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden', padding: '4px 0 0 6px' }} onClick={() => xtermRef.current?.focus()} />
    </div>
  );
}
