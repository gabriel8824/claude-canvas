import { useState } from 'react';
import { useCanvasStore } from '../store';

const RECENT_KEY = 'claude-canvas:recent-projects';
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(path: string) {
  const list = [path, ...loadRecent().filter(p => p !== path)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

async function pickFolder(): Promise<string | null> {
  const res = await fetch('/api/pick-folder');
  const { path } = await res.json();
  return path ?? null;
}

interface Props { onClose: () => void }

export function OpenProjectModal({ onClose }: Props) {
  const { openProject } = useCanvasStore();
  const [recent]  = useState<string[]>(loadRecent);
  const [picking, setPicking] = useState(false);

  async function browse() {
    setPicking(true);
    try {
      const p = await pickFolder();
      if (p) confirm(p);
    } finally {
      setPicking(false);
    }
  }

  function confirm(path: string) {
    saveRecent(path);
    openProject(path);
    onClose();
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 480,
        background: 'rgba(8,12,28,0.90)',
        backdropFilter: 'blur(32px) saturate(200%)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 20, overflow: 'hidden',
        boxShadow: '0 32px 100px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.07)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 20px 16px',
          background: 'rgba(255,255,255,0.025)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>
            📂
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Abrir Projeto</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
              Abre explorador + terminal + git conectados à pasta
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '3px 8px',
          }}>×</button>
        </div>

        {/* Browse button */}
        <div style={{ padding: '18px 20px 0' }}>
          <button
            onClick={browse}
            disabled={picking}
            style={{
              width: '100%', padding: '14px 20px',
              background: 'rgba(120,100,255,0.15)',
              border: '1px solid rgba(160,130,255,0.3)',
              borderRadius: 12, cursor: picking ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'all 0.15s', opacity: picking ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!picking) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(120,100,255,0.28)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(160,130,255,0.55)'; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(120,100,255,0.15)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(160,130,255,0.3)'; }}
          >
            <span style={{ fontSize: 24 }}>{picking ? '⏳' : '📁'}</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(200,185,255,0.95)' }}>
                {picking ? 'Abrindo seletor…' : 'Selecionar Pasta'}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                Abre o seletor de pastas nativo do sistema
              </div>
            </div>
          </button>
        </div>

        {/* Recents */}
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {recent.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 }}>
                Recentes
              </div>
              <div style={{
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 12, overflow: 'hidden',
                maxHeight: 260, overflowY: 'auto',
              }}>
                {recent.map((p, i) => (
                  <div
                    key={p}
                    onClick={() => confirm(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', cursor: 'pointer',
                      borderBottom: i < recent.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'rgba(215,230,250,0.9)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.split('/').filter(Boolean).pop()}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {p
                          .replace(/^\/Users\/[^/]+/, '~')         // macOS
                          .replace(/^[A-Za-z]:\/Users\/[^/]+/, '~') // Windows via toUnix
                          .replace(/^\/home\/[^/]+/, '~')}          {/* Linux */}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>→</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {recent.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 0 4px', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
              Nenhum projeto recente
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
