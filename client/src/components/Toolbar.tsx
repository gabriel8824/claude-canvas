import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useCanvasStore } from '../store';
import { ClaudeUsageBadge } from './ClaudeUsageBadge';
import { startPlacement } from '../placementStore';
import { toggleCharacter, subscribeCharacter, getCharacterSnapshot } from '../characterStore';

interface ToolbarProps {
  onOpenProject: () => void;
  onGitHub: () => void;
  onAddGit: () => void;
  onShowShortcuts?: () => void;
}

const saveLabels = {
  idle:   { text: '',          color: '#484f58' },
  saving: { text: '● saving…', color: '#d29922' },
  saved:  { text: '✓ saved',   color: '#3fb950' },
  error:  { text: '✗ error',   color: '#f85149' },
};

const NODE_ITEMS = [
  { icon: '🤖', label: 'Claude Code', hint: 'Claude Code CLI na pasta do projeto', key: 'claude-code' },
  { icon: '⌨️', label: 'Terminal',    hint: 'New terminal session',                key: 'terminal' },
  { icon: '📁', label: 'Files',       hint: 'File browser',                        key: 'files' },
  { icon: '🌐', label: 'Preview',     hint: 'Browser preview',                     key: 'preview' },
  { icon: '🔀', label: 'Git',         hint: 'Source control panel',                key: 'git' },
  { icon: '📚', label: 'Docs',        hint: 'Markdown docs viewer',                key: 'docs' },
  { icon: '📝', label: 'Notes',       hint: 'Scratch pad with Markdown',           key: 'notes' },
  { icon: '🌐', label: 'HTTP',        hint: 'HTTP client / API tester',            key: 'http' },
  { icon: '⚙️', label: 'Processes',   hint: 'Process manager',                     key: 'process-manager' },
  { icon: '🗄️', label: 'Database',    hint: 'SQLite / DB inspector',               key: 'db-inspector' },
] as const;

type NodeKey = typeof NODE_ITEMS[number]['key'];

export function Toolbar({ onOpenProject, onGitHub, onAddGit, onShowShortcuts }: ToolbarProps) {
  const { addNode, nodes, groups, saveStatus } = useCanvasStore();
  const save = saveLabels[saveStatus];
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const characterVisible = useSyncExternalStore(subscribeCharacter, getCharacterSnapshot);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [dropdownOpen]);

  function inferProjectFolder(): string | null {
    if (!groups.length) return null;
    let bestFolder: string | null = null;
    let bestZ = -1;
    for (const group of groups) {
      const members = group.nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean) as typeof nodes;
      const maxZ = Math.max(...members.map(n => n.zIndex ?? 0));
      if (maxZ <= bestZ) continue;
      for (const m of members) {
        const d = m.data as any;
        const folder = d.currentPath ?? d.cwd ?? d.repoPath ?? null;
        if (folder && folder !== '~') { bestZ = maxZ; bestFolder = folder; break; }
      }
    }
    return bestFolder;
  }

  function spawnNode(key: NodeKey) {
    setDropdownOpen(false);

    if (key === 'git') {
      // Git abre diálogo próprio
      onAddGit();
      return;
    }

    const item = NODE_ITEMS.find(i => i.key === key)!;
    startPlacement({ type: key as any, label: item.label, icon: item.icon });
  }

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      display: 'flex',
      gap: 8,
      padding: '6px 12px',
      background: 'rgba(8,12,28,0.88)',
      backdropFilter: 'blur(28px) saturate(200%)',
      WebkitBackdropFilter: 'blur(28px) saturate(200%)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 14,
      boxShadow: '0 8px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.07)',
      alignItems: 'center',
    }}>
      {/* Brand */}
      <span style={{
        fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em',
        background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        whiteSpace: 'nowrap',
      }}>
        Claude Canvas
      </span>

      <Divider />

      {/* Primary actions */}
      <ToolBtn icon="📂" label="Open" hint="Open a folder" onClick={onOpenProject} highlight />
      <ToolBtn icon="🐙" label="GitHub" hint="Clone a GitHub repository" onClick={onGitHub} highlightColor="green" />

      <Divider />

      {/* Add panel dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(v => !v)}
          title="Add a panel"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: dropdownOpen ? 'rgba(120,100,255,0.22)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${dropdownOpen ? 'rgba(160,130,255,0.45)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 9, color: dropdownOpen ? 'rgba(200,185,255,0.95)' : 'rgba(255,255,255,0.7)',
            cursor: 'pointer', padding: '5px 11px',
            fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            if (dropdownOpen) return;
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = 'rgba(255,255,255,0.09)';
            el.style.borderColor = 'rgba(255,255,255,0.18)';
            el.style.color = 'rgba(255,255,255,0.95)';
          }}
          onMouseLeave={e => {
            if (dropdownOpen) return;
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = 'rgba(255,255,255,0.05)';
            el.style.borderColor = 'rgba(255,255,255,0.1)';
            el.style.color = 'rgba(255,255,255,0.7)';
          }}
        >
          <span style={{ fontSize: 13 }}>＋</span>
          Add Panel
          <span style={{
            fontSize: 9, opacity: 0.55,
            transform: dropdownOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            display: 'inline-block',
          }}>▼</span>
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,14,30,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)',
            padding: '6px',
            minWidth: 200,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            zIndex: 10000,
          }}>
            {NODE_ITEMS.map(item => (
              <DropdownItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                hint={item.hint}
                onClick={() => spawnNode(item.key)}
              />
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* Status */}
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap' }}>
        {nodes.length} panel{nodes.length !== 1 ? 's' : ''}
      </span>

      {save.text && (
        <span style={{ fontSize: 10, color: save.color, fontFamily: 'monospace', transition: 'color 0.3s', whiteSpace: 'nowrap' }}>
          {save.text}
        </span>
      )}

      <Divider />
      <ClaudeUsageBadge />

      <Divider />

      {/* Toggle personagem Claude */}
      <button
        onClick={toggleCharacter}
        title={characterVisible ? 'Desativar personagem Claude' : 'Ativar personagem Claude'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: characterVisible ? 'rgba(120,100,255,0.15)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${characterVisible ? 'rgba(160,130,255,0.35)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 9,
          color: characterVisible ? 'rgba(190,170,255,0.9)' : 'rgba(255,255,255,0.35)',
          cursor: 'pointer', padding: '5px 9px',
          fontSize: 13, transition: 'all 0.15s',
          whiteSpace: 'nowrap',
          position: 'relative',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = characterVisible ? 'rgba(120,100,255,0.25)' : 'rgba(255,255,255,0.08)';
          el.style.borderColor = characterVisible ? 'rgba(160,130,255,0.5)' : 'rgba(255,255,255,0.18)';
          el.style.color = 'rgba(255,255,255,0.9)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = characterVisible ? 'rgba(120,100,255,0.15)' : 'rgba(255,255,255,0.04)';
          el.style.borderColor = characterVisible ? 'rgba(160,130,255,0.35)' : 'rgba(255,255,255,0.08)';
          el.style.color = characterVisible ? 'rgba(190,170,255,0.9)' : 'rgba(255,255,255,0.35)';
        }}
      >
        🤖
        {!characterVisible && (
          <span style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%) rotate(-45deg)',
            width: 20, height: 1.5,
            background: 'rgba(255,255,255,0.5)',
            borderRadius: 2,
            pointerEvents: 'none',
          }} />
        )}
      </button>

      {onShowShortcuts && (
        <>
          <Divider />
          <button
            onClick={onShowShortcuts}
            title="Keyboard shortcuts (?)"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 9, color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer', padding: '5px 9px',
              fontSize: 11, transition: 'all 0.15s',
              whiteSpace: 'nowrap', fontFamily: 'monospace',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'rgba(255,255,255,0.08)';
              el.style.borderColor = 'rgba(255,255,255,0.18)';
              el.style.color = 'rgba(255,255,255,0.8)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'rgba(255,255,255,0.04)';
              el.style.borderColor = 'rgba(255,255,255,0.08)';
              el.style.color = 'rgba(255,255,255,0.4)';
            }}
          >
            ?
          </button>
        </>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />;
}

function DropdownItem({ icon, label, hint, onClick }: {
  icon: string; label: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 8,
        color: 'rgba(255,255,255,0.7)',
        cursor: 'pointer', padding: '7px 10px',
        fontSize: 12, transition: 'all 0.12s',
        textAlign: 'left', width: '100%',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'rgba(120,100,255,0.18)';
        el.style.borderColor = 'rgba(160,130,255,0.25)';
        el.style.color = 'rgba(255,255,255,0.95)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'transparent';
        el.style.borderColor = 'transparent';
        el.style.color = 'rgba(255,255,255,0.7)';
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>
      {label}
    </button>
  );
}

const HIGHLIGHT_COLORS = {
  purple: { bg: 'rgba(120,100,255,0.18)', bgHov: 'rgba(120,100,255,0.3)', border: 'rgba(160,130,255,0.35)', borderHov: 'rgba(180,160,255,0.5)', text: 'rgba(190,170,255,0.95)' },
  green:  { bg: 'rgba(30,120,60,0.22)',   bgHov: 'rgba(30,120,60,0.36)',  border: 'rgba(74,222,128,0.3)',  borderHov: 'rgba(74,222,128,0.55)', text: 'rgba(134,239,172,0.95)' },
};

function ToolBtn({ icon, label, hint, onClick, highlight, highlightColor = 'purple' }: {
  icon: string; label: string; hint: string; onClick: () => void;
  highlight?: boolean; highlightColor?: 'purple' | 'green';
}) {
  const c = HIGHLIGHT_COLORS[highlightColor];
  const bg    = highlight ? c.bg     : 'rgba(255,255,255,0.04)';
  const border = highlight ? c.border  : 'rgba(255,255,255,0.08)';
  const color  = highlight ? c.text    : 'rgba(255,255,255,0.75)';

  return (
    <button
      onClick={onClick}
      title={hint}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: bg, border: `1px solid ${border}`,
        borderRadius: 9, color,
        cursor: 'pointer', padding: '5px 11px',
        fontSize: 12, transition: 'all 0.15s',
        whiteSpace: 'nowrap', fontWeight: highlight ? 500 : 400,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = highlight ? c.bgHov : 'rgba(255,255,255,0.08)';
        el.style.borderColor = highlight ? c.borderHov : 'rgba(255,255,255,0.18)';
        el.style.color = 'rgba(255,255,255,0.95)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = bg;
        el.style.borderColor = border;
        el.style.color = color;
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  );
}
