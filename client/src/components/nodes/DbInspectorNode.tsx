import { useState, useEffect } from 'react';
import { DbInspectorData } from '../../types';
import { useCanvasStore } from '../../store';

interface Props {
  nodeId: string;
  data: DbInspectorData;
}

export function DbInspectorNode({ nodeId, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const [tables, setTables] = useState<string[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [queryResult, setQueryResult] = useState<{ rows: Record<string, unknown>[]; columns: string[]; truncated?: boolean } | null>(null);
  const [queryError, setQueryError] = useState('');
  const [running, setRunning] = useState(false);
  const [activeView, setActiveView] = useState<'tables' | 'query'>('tables');

  async function loadTables() {
    if (!data.connectionString) return;
    setLoadingTables(true);
    try {
      const res = await fetch(`/api/db/tables?path=${encodeURIComponent(data.connectionString)}`);
      const json = await res.json();
      if (json.error) { setTables([]); return; }
      setTables(json.tables || []);
    } catch {} finally { setLoadingTables(false); }
  }

  useEffect(() => {
    if (data.connectionString) loadTables();
  }, [data.connectionString]);

  async function runQuery() {
    if (!data.query.trim() || !data.connectionString) return;
    setRunning(true);
    setQueryError('');
    try {
      const res = await fetch('/api/db/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: data.connectionString, query: data.query }),
      });
      const json = await res.json();
      if (json.error) { setQueryError(json.error); setQueryResult(null); }
      else { setQueryResult(json); setQueryError(''); }
    } catch (err: any) { setQueryError(err.message); } finally { setRunning(false); }
  }

  function selectTable(tableName: string) {
    updateNodeData(nodeId, { selectedTable: tableName, query: `SELECT * FROM "${tableName}" LIMIT 100;` });
    setActiveView('query');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,7,18,0.9)', fontFamily: 'monospace' }}>
      {/* Connection bar */}
      <div style={{ display: 'flex', gap: 6, padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <input
          value={data.connectionString}
          onChange={e => updateNodeData(nodeId, { connectionString: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') loadTables(); }}
          placeholder="/path/to/database.db"
          style={{
            flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'rgba(220,230,245,0.9)', fontSize: 11, padding: '4px 9px',
            fontFamily: 'monospace', outline: 'none',
          }}
        />
        <button onClick={loadTables} style={{ background: 'rgba(140,190,255,0.1)', border: '1px solid rgba(140,190,255,0.25)', borderRadius: 6, color: 'rgba(140,200,255,0.9)', cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
          {loadingTables ? '⟳' : 'Conectar'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        {(['tables', 'query'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveView(tab)} style={{
            background: activeView === tab ? 'rgba(140,190,255,0.06)' : 'transparent',
            border: 'none', borderBottom: activeView === tab ? '1px solid rgba(140,190,255,0.4)' : '1px solid transparent',
            color: activeView === tab ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.35)',
            cursor: 'pointer', fontSize: 11, padding: '6px 14px', fontFamily: 'monospace',
          }}>
            {tab === 'tables' ? `Tabelas (${tables.length})` : 'Query'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div data-node-content style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {activeView === 'tables' && (
          <div>
            {tables.length === 0 && !loadingTables && (
              <div style={{ padding: 16, color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center' }}>
                {data.connectionString ? 'Nenhuma tabela encontrada' : 'Digite o caminho do banco acima'}
              </div>
            )}
            {tables.map(tbl => (
              <div
                key={tbl}
                onClick={() => selectTable(tbl)}
                style={{
                  padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  background: data.selectedTable === tbl ? 'rgba(100,150,255,0.1)' : 'transparent',
                }}
              >
                <span style={{ fontSize: 13 }}>🗄️</span>
                <span style={{ fontSize: 12, color: 'rgba(220,230,245,0.85)' }}>{tbl}</span>
              </div>
            ))}
          </div>
        )}

        {activeView === 'query' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', gap: 6, padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
              <textarea
                value={data.query}
                onChange={e => updateNodeData(nodeId, { query: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runQuery(); }}
                rows={3}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6, color: 'rgba(220,230,245,0.9)', fontSize: 11, padding: '6px 8px',
                  fontFamily: 'monospace', resize: 'none', outline: 'none',
                }}
              />
              <button onClick={runQuery} disabled={running} style={{
                background: 'rgba(140,190,255,0.1)', border: '1px solid rgba(140,190,255,0.25)',
                borderRadius: 6, color: 'rgba(140,200,255,0.9)', cursor: running ? 'default' : 'pointer',
                fontSize: 11, padding: '4px 10px', flexShrink: 0, alignSelf: 'flex-start',
              }}>
                {running ? '⟳' : '▶ Run'}<br />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>⌘↵</span>
              </button>
            </div>

            {queryError && (
              <div style={{ padding: '8px 12px', color: '#f87171', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                {queryError}
              </div>
            )}

            {queryResult && (
              <div style={{ flex: 1, overflow: 'auto' }}>
                {queryResult.truncated && (
                  <div style={{ padding: '4px 12px', fontSize: 10, color: 'rgba(250,204,21,0.8)', background: 'rgba(250,204,21,0.05)' }}>
                    Limitado a 500 linhas
                  </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
                      {queryResult.columns.map(col => (
                        <th key={col} style={{ padding: '5px 10px', textAlign: 'left', color: 'rgba(140,190,255,0.8)', borderBottom: '1px solid rgba(255,255,255,0.07)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600 }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                        {queryResult.columns.map(col => (
                          <td key={col} style={{ padding: '4px 10px', color: 'rgba(200,215,240,0.8)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>
                            {String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
