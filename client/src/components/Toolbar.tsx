import { useCanvasStore } from '../store';

interface ToolbarProps {
  onOpenProject: () => void;
  onGitHub: () => void;
  onAddGit: () => void;
}

const saveLabels = {
  idle:   { text: '',          color: '#484f58' },
  saving: { text: '● saving…', color: '#d29922' },
  saved:  { text: '✓ saved',   color: '#3fb950' },
  error:  { text: '✗ error',   color: '#f85149' },
};

export function Toolbar({ onOpenProject, onGitHub, onAddGit }: ToolbarProps) {
  const { addNode, nodes, groups, saveStatus } = useCanvasStore();
  const save = saveLabels[saveStatus];

  function inferProjectFolder(): string | null {
    if (!groups.length) return null;
    // Pick the group whose members have the highest zIndex (most recently active)
    let bestFolder: string | null = null;
    let bestZ = -1;
    for (const group of groups) {
      const members = group.nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean) as typeof nodes;
      const maxZ = Math.max(...members.map(n => n.zIndex ?? 0));
      if (maxZ <= bestZ) continue;
      // Find a folder path from files, terminal, or git node in this group
      for (const m of members) {
        const d = m.data as any;
        const folder = d.currentPath ?? d.cwd ?? d.repoPath ?? null;
        if (folder && folder !== '~') { bestZ = maxZ; bestFolder = folder; break; }
      }
    }
    return bestFolder;
  }

  function spawnAt(type: 'terminal' | 'files' | 'preview' | 'docs') {
    const offset = nodes.length * 24;
    if (type === 'terminal') {
      const folder = inferProjectFolder();
      addNode('terminal', { x: 80 + offset, y: 80 + offset },
        folder ? { data: { cwd: folder, status: 'idle' } } : undefined);
    } else {
      addNode(type, { x: 80 + offset, y: 80 + offset });
    }
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
      padding: '8px 16px',
      background: 'rgba(8,12,28,0.82)',
      backdropFilter: 'blur(28px) saturate(200%)',
      WebkitBackdropFilter: 'blur(28px) saturate(200%)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 16,
      boxShadow: '0 8px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.07)',
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, marginRight: 4, letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #a78bfa, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Claude Canvas
      </span>

      <Divider />

      <ToolBtn
        icon="📂"
        label="Open Project"
        hint="Open a folder — creates file browser + terminal"
        onClick={onOpenProject}
        highlight
      />
      <ToolBtn
        icon="🐙"
        label="GitHub"
        hint="Clone a GitHub repository and open it"
        onClick={onGitHub}
        highlightColor="green"
      />

      <Divider />

      <ToolBtn icon="⌨️" label="Terminal" hint="New terminal"        onClick={() => spawnAt('terminal')} />
      <ToolBtn icon="📁" label="Files"    hint="File browser"         onClick={() => spawnAt('files')} />
      <ToolBtn icon="🌐" label="Preview"  hint="Browser preview"      onClick={() => spawnAt('preview')} />
      <ToolBtn icon="🔀" label="Git"      hint="Source control panel" onClick={onAddGit} />
      <ToolBtn icon="📚" label="Docs"     hint="Visualizador de documentação (.md)" onClick={() => spawnAt('docs')} />

      <Divider />

      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
        {nodes.length} panel{nodes.length !== 1 ? 's' : ''}
      </span>

      {save.text && (
        <span style={{ fontSize: 10, color: save.color, fontFamily: 'monospace', transition: 'color 0.3s', letterSpacing: '0.02em' }}>
          {save.text}
        </span>
      )}

      <Divider />

      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>
        drag canvas · title to move · edge to resize
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />;
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
  const bg     = highlight ? c.bg     : 'rgba(255,255,255,0.04)';
  const border  = highlight ? c.border  : 'rgba(255,255,255,0.08)';
  const color   = highlight ? c.text    : 'rgba(255,255,255,0.75)';

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
