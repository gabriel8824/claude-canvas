import { useState, useEffect, useCallback } from 'react';

interface ProcessInfo {
  id: string;
  pid?: number;
  cwd: string;
  startedAt: string;
  status: 'running' | 'exited';
}

export function ProcessManagerNode() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/processes');
      const { processes: procs } = await res.json();
      setProcesses(procs || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadProcesses();
    const interval = setInterval(loadProcesses, 3000);
    return () => clearInterval(interval);
  }, [loadProcesses]);

  async function killProcess(id: string) {
    if (!confirm(`Encerrar processo ${id}?`)) return;
    await fetch(`/api/processes/${id}`, { method: 'DELETE' });
    loadProcesses();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,7,18,0.9)', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flex: 1 }}>
          {processes.filter(p => p.status === 'running').length} processos ativos
        </span>
        <button
          onClick={loadProcesses}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11, padding: '2px 8px' }}
        >
          {loading ? '⟳' : '↺ Atualizar'}
        </button>
      </div>

      <div data-node-content style={{ flex: 1, overflow: 'auto' }}>
        {processes.length === 0 && !loading && (
          <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
            Nenhum processo em execução
          </div>
        )}
        {processes.map(proc => (
          <div
            key={proc.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div
              style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: proc.status === 'running' ? '#4ade80' : 'rgba(255,255,255,0.2)',
                boxShadow: proc.status === 'running' ? '0 0 6px #4ade80' : 'none',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'rgba(220,230,245,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {proc.id}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {proc.cwd} {proc.pid ? `· PID ${proc.pid}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 10, color: proc.status === 'running' ? '#4ade80' : 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
              {proc.status}
            </span>
            {proc.status === 'running' && (
              <button
                onClick={() => killProcess(proc.id)}
                style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 5, color: '#f87171', cursor: 'pointer', fontSize: 10, padding: '2px 7px', flexShrink: 0 }}
              >
                Parar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
