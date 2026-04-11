import { useState, useEffect, useRef } from 'react';
import { useCanvasStore } from '../store';

interface Command {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  action: () => void;
}

function fuzzyFilter(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

interface Props {
  onClose: () => void;
}

export function CommandPalette({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addNode, nodes } = useCanvasStore();
  const offset = nodes.length * 20;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const commands: Command[] = [
    // Create nodes
    { id: 'new-terminal',  icon: '⌨️',  label: 'Novo Terminal',      description: 'Abrir terminal PTY',            category: 'Criar',    action: () => { addNode('terminal',  { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-files',     icon: '📁',  label: 'Novo File Browser',   description: 'Navegar arquivos',              category: 'Criar',    action: () => { addNode('files',     { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-editor',    icon: '✏️',  label: 'Novo Editor',         description: 'Editor de código',             category: 'Criar',    action: () => { addNode('editor',    { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-preview',   icon: '🌐',  label: 'Novo Preview',        description: 'Browser preview',              category: 'Criar',    action: () => { addNode('preview',   { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-git',       icon: '🔀',  label: 'Novo Git Panel',      description: 'Source control',               category: 'Criar',    action: () => { addNode('git',       { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-docs',      icon: '📚',  label: 'Novo Docs Viewer',    description: 'Visualizador de Markdown',      category: 'Criar',    action: () => { addNode('docs',      { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-notes',     icon: '📝',  label: 'Nova Nota',           description: 'Bloco de anotações',            category: 'Criar',    action: () => { addNode('notes',     { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-http',      icon: '🌐',  label: 'Novo HTTP Client',    description: 'Testar APIs REST',              category: 'Criar',    action: () => { addNode('http',      { x: 80+offset, y: 80+offset }); onClose(); } },
    { id: 'new-ai-review', icon: '🤖',  label: 'Novo AI Review',      description: 'Code review com Claude',        category: 'Criar',    action: () => { addNode('ai-review', { x: 80+offset, y: 80+offset }); onClose(); } },
    // Canvas actions
    { id: 'zoom-reset',    icon: '🔍',  label: 'Reset Zoom',          description: 'Voltar para 100%',              category: 'Canvas',   action: () => { useCanvasStore.getState().setZoom(1); useCanvasStore.getState().setCanvasOffset({ x: 0, y: 0 }); onClose(); } },
    { id: 'undo',          icon: '↩️',  label: 'Desfazer',            description: 'Ctrl+Z',                       category: 'Canvas',   action: () => { useCanvasStore.getState().undo?.(); onClose(); } },
    { id: 'redo',          icon: '↪️',  label: 'Refazer',             description: 'Ctrl+Shift+Z',                 category: 'Canvas',   action: () => { useCanvasStore.getState().redo?.(); onClose(); } },
  ];

  const filtered = commands.filter(c =>
    fuzzyFilter(query, c.label + ' ' + c.description + ' ' + c.category)
  );

  useEffect(() => { setSelectedIdx(0); }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[selectedIdx]) filtered[selectedIdx].action();
  }

  // Group by category
  const byCategory = new Map<string, Command[]>();
  for (const cmd of filtered) {
    if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
    byCategory.get(cmd.category)!.push(cmd);
  }

  let flatIdx = 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'rgba(8,12,28,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: 520, maxHeight: 440, display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }}
      >
        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite um comando..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'rgba(220,230,245,0.9)', fontSize: 14, fontFamily: 'monospace' }}
          />
        </div>

        {/* Commands */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {Array.from(byCategory.entries()).map(([category, cmds]) => (
            <div key={category}>
              <div style={{ padding: '6px 16px 2px', fontSize: 9, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(140,190,255,0.5)', textTransform: 'uppercase' }}>
                {category}
              </div>
              {cmds.map(cmd => {
                const isSelected = flatIdx++ === selectedIdx;
                return (
                  <div
                    key={cmd.id}
                    onClick={cmd.action}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 16px',
                      background: isSelected ? 'rgba(100,150,255,0.14)' : 'transparent',
                      borderLeft: isSelected ? '2px solid rgba(100,160,255,0.6)' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 16, width: 24, textAlign: 'center', flexShrink: 0 }}>{cmd.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(220,230,245,0.9)' }}>{cmd.label}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{cmd.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12, fontFamily: 'monospace' }}>
              Nenhum comando encontrado
            </div>
          )}
        </div>

        <div style={{ padding: '6px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 16, fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
          <span>↑↓ navegar</span><span>Enter executar</span><span>Esc fechar</span>
        </div>
      </div>
    </div>
  );
}
