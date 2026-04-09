import { useState, useRef, useEffect } from 'react';
import { ws } from '../ws';
import { useCanvasStore } from '../store';

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  // owner/repo shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) return `https://github.com/${t}.git`;
  // Already a URL
  return t;
}

function repoName(url: string): string {
  return url.replace(/\.git$/, '').split('/').filter(Boolean).pop() || '';
}

function isValidInput(input: string): boolean {
  const t = input.trim();
  if (!t) return false;
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) return true;
  try { new URL(t); return true; } catch { return false; }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { onClose: () => void }

type Status = 'idle' | 'cloning' | 'done' | 'error';

export function GitHubModal({ onClose }: Props) {
  const { openProject } = useCanvasStore();

  const [input,     setInput]     = useState('');
  const [targetDir, setTargetDir] = useState('~/Documents');
  const [status,    setStatus]    = useState<Status>('idle');
  const [output,    setOutput]    = useState('');
  const [errorMsg,  setErrorMsg]  = useState('');
  const outputRef = useRef<HTMLPreElement>(null);

  const url      = resolveUrl(input);
  const name     = url ? repoName(url) : '';
  const fullPath = name ? `${targetDir}/${name}` : targetDir;
  const valid    = isValidInput(input);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  // Esc to close (unless cloning)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'cloning') onClose();
      if (e.key === 'Enter'  && status === 'idle' && valid) clone();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [status, valid, input]);

  function clone() {
    if (!valid || status === 'cloning') return;
    const reqId = `clone-${Date.now()}`;
    setStatus('cloning');
    setOutput('');
    setErrorMsg('');

    const unsubs: (() => void)[] = [];

    unsubs.push(ws.on('git:clone:output', (msg) => {
      if (msg.reqId !== reqId) return;
      setOutput(p => p + msg.data);
    }));
    unsubs.push(ws.on('git:clone:done', (msg) => {
      if (msg.reqId !== reqId) return;
      unsubs.forEach(f => f());
      setStatus('done');
      setTimeout(() => { openProject(msg.targetDir); onClose(); }, 900);
    }));
    unsubs.push(ws.on('git:clone:error', (msg) => {
      if (msg.reqId !== reqId) return;
      unsubs.forEach(f => f());
      setStatus('error');
      setErrorMsg(msg.message || 'Clone falhou');
    }));

    ws.send({ type: 'git:clone', reqId, url, targetDir: fullPath });
  }

  const isCloning = status === 'cloning';
  const isDone    = status === 'done';
  const isError   = status === 'error';

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !isCloning) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 540,
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
          padding: '18px 20px 14px',
          background: 'rgba(255,255,255,0.025)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            🐙
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
              Clone do GitHub
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
              Cole a URL ou use o formato <span style={{ fontFamily: 'monospace', color: 'rgba(180,200,255,0.6)' }}>owner/repo</span>
            </div>
          </div>
          {!isCloning && (
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
              fontSize: 16, lineHeight: 1, padding: '3px 8px',
            }}>×</button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 20px 4px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* URL input */}
          <div>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Repositório
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
                fontSize: 15, pointerEvents: 'none', opacity: 0.5,
              }}>🔗</span>
              <input
                autoFocus
                value={input}
                onChange={e => { setInput(e.target.value); setStatus('idle'); setErrorMsg(''); setOutput(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && valid && !isCloning) clone(); }}
                placeholder="https://github.com/owner/repo  ou  owner/repo"
                disabled={isCloning || isDone}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isError ? 'rgba(248,113,113,0.4)' : valid && input ? 'rgba(140,185,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 10, padding: '10px 12px 10px 36px',
                  color: 'rgba(215,230,255,0.9)', fontSize: 13,
                  fontFamily: 'monospace', outline: 'none',
                  opacity: isCloning || isDone ? 0.6 : 1,
                  transition: 'border-color 0.15s',
                }}
              />
            </div>

            {/* URL preview */}
            {url && url !== input.trim() && (
              <div style={{ marginTop: 5, fontSize: 11, color: 'rgba(140,190,255,0.6)', fontFamily: 'monospace', paddingLeft: 4 }}>
                → {url}
              </div>
            )}
          </div>

          {/* Target dir */}
          <div>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Clonar em
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8, padding: '6px 10px',
                opacity: isCloning || isDone ? 0.6 : 1,
              }}>
                <span style={{ fontSize: 13, color: 'rgba(140,190,255,0.7)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {targetDir}
                </span>
                <button
                  onClick={async () => {
                    const res = await fetch('/api/pick-folder');
                    const { path } = await res.json();
                    if (path) setTargetDir(path.replace(/\/$/, ''));
                  }}
                  disabled={isCloning || isDone}
                  title="Selecionar pasta"
                  style={{
                    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 5, color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
                    padding: '3px 8px', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  📁 Alterar
                </button>
              </div>
              {name && (
                <span style={{
                  fontSize: 12, color: 'rgba(140,190,255,0.7)', fontFamily: 'monospace',
                  whiteSpace: 'nowrap', background: 'rgba(100,150,255,0.1)',
                  border: '1px solid rgba(100,150,255,0.2)', borderRadius: 6, padding: '6px 10px',
                }}>
                  /{name}
                </span>
              )}
            </div>
            {name && (
              <div style={{ marginTop: 5, fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', paddingLeft: 4 }}>
                → {fullPath}
              </div>
            )}
          </div>

          {/* Output log */}
          {(output || isCloning) && (
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              <div style={{
                padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace',
                letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {isCloning && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
                Output
              </div>
              <pre
                ref={outputRef}
                style={{
                  margin: 0, padding: '10px 12px', maxHeight: 160,
                  overflow: 'auto', fontSize: 11, fontFamily: 'monospace',
                  color: 'rgba(180,210,190,0.85)', lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}
              >
                {output || '…'}
              </pre>
            </div>
          )}

          {/* Error */}
          {isError && errorMsg && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 10, fontSize: 12,
              color: 'rgba(252,165,165,0.9)', fontFamily: 'monospace',
            }}>
              ✗ {errorMsg}
            </div>
          )}

          {/* Success */}
          {isDone && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(74,222,128,0.08)',
              border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 10, fontSize: 12,
              color: 'rgba(134,239,172,0.9)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>✓</span>
              <span>Clone concluído! Abrindo projeto…</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.02)',
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
        }}>
          {!isCloning && !isDone && (
            <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
          )}
          {isError && (
            <button onClick={() => { setStatus('idle'); setOutput(''); setErrorMsg(''); }} style={secondaryBtn}>
              Tentar novamente
            </button>
          )}
          {(status === 'idle' || isError) && (
            <button
              onClick={clone}
              disabled={!valid}
              style={{
                ...primaryBtn,
                opacity: valid ? 1 : 0.35,
                cursor: valid ? 'pointer' : 'not-allowed',
              }}
            >
              🐙 Clonar e Abrir
            </button>
          )}
          {isCloning && (
            <button disabled style={{ ...primaryBtn, opacity: 0.6, cursor: 'not-allowed' }}>
              Clonando…
            </button>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: 'rgba(30,60,20,0.5)',
  border: '1px solid rgba(74,222,128,0.35)',
  borderRadius: 9, color: 'rgba(134,239,172,0.95)',
  cursor: 'pointer', padding: '8px 18px', fontSize: 13, fontWeight: 600,
};

const secondaryBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 9, color: 'rgba(255,255,255,0.45)',
  cursor: 'pointer', padding: '8px 14px', fontSize: 13,
};
