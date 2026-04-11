import { useState } from 'react';
import { HttpClientData, HttpRequestHeader } from '../../types';
import { useCanvasStore } from '../../store';

interface Props {
  nodeId: string;
  data: HttpClientData;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: '#4ade80', POST: '#60a5fa', PUT: '#facc15',
  PATCH: '#fb923c', DELETE: '#f87171',
};

export function HttpClientNode({ nodeId, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'headers' | 'body' | 'response'>('headers');

  function update(patch: Partial<HttpClientData>) {
    updateNodeData(nodeId, patch);
  }

  async function sendRequest() {
    if (!data.url) return;
    setLoading(true);
    const start = Date.now();

    try {
      // Build headers object
      const headersObj: Record<string, string> = {};
      for (const h of data.headers) {
        if (h.key.trim()) headersObj[h.key.trim()] = h.value;
      }

      // Use proxy to avoid CORS issues
      const proxyRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: data.url,
          method: data.method,
          headers: headersObj,
          body: data.method !== 'GET' && data.method !== 'DELETE' ? data.body : undefined,
        }),
      });

      const proxyData = await proxyRes.json();
      const elapsed = Date.now() - start;

      update({
        response: {
          status: proxyData.status ?? 0,
          statusText: proxyData.statusText ?? '',
          body: proxyData.body ?? '',
          time: elapsed,
          headers: Object.entries(proxyData.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })),
        },
      });
      setActiveTab('response');
    } catch (err: any) {
      update({
        response: {
          status: 0,
          statusText: 'Network Error',
          body: err.message,
          time: Date.now() - start,
          headers: [],
        },
      });
      setActiveTab('response');
    } finally {
      setLoading(false);
    }
  }

  function addHeader() {
    update({ headers: [...data.headers, { key: '', value: '' }] });
  }

  function updateHeader(idx: number, patch: Partial<HttpRequestHeader>) {
    const updated = data.headers.map((h, i) => i === idx ? { ...h, ...patch } : h);
    update({ headers: updated });
  }

  function removeHeader(idx: number) {
    update({ headers: data.headers.filter((_, i) => i !== idx) });
  }

  const statusColor = data.response
    ? data.response.status >= 500 ? '#f87171'
      : data.response.status >= 400 ? '#fb923c'
      : data.response.status >= 300 ? '#facc15'
      : '#4ade80'
    : 'transparent';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,7,18,0.9)', fontFamily: 'monospace' }}>
      {/* URL bar */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <select
          value={data.method}
          onChange={e => update({ method: e.target.value as typeof data.method })}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, color: METHOD_COLORS[data.method] ?? '#fff',
            fontSize: 12, padding: '4px 6px', fontFamily: 'monospace', fontWeight: 700,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          value={data.url}
          onChange={e => update({ url: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') sendRequest(); }}
          placeholder="https://api.example.com/endpoint"
          style={{
            flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'rgba(220,230,245,0.9)', fontSize: 12, padding: '4px 10px',
            fontFamily: 'monospace', outline: 'none',
          }}
        />
        <button
          onClick={sendRequest}
          disabled={loading || !data.url}
          style={{
            background: loading ? 'rgba(140,190,255,0.08)' : 'rgba(140,190,255,0.15)',
            border: '1px solid rgba(140,190,255,0.3)',
            borderRadius: 6, color: 'rgba(140,200,255,0.9)',
            cursor: loading ? 'default' : 'pointer',
            fontSize: 12, padding: '4px 14px', flexShrink: 0,
          }}
        >
          {loading ? '⟳' : 'Send'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        {(['headers', 'body', 'response'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? 'rgba(140,190,255,0.06)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '1px solid rgba(140,190,255,0.4)' : '1px solid transparent',
              color: activeTab === tab ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.35)',
              cursor: 'pointer', fontSize: 11, padding: '6px 14px', fontFamily: 'monospace',
            }}
          >
            {tab === 'response' && data.response
              ? <span>response <span style={{ color: statusColor }}>{data.response.status}</span></span>
              : tab}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div data-node-content style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {activeTab === 'headers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.headers.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input
                  value={h.key}
                  onChange={e => updateHeader(i, { key: e.target.value })}
                  placeholder="Header name"
                  style={inputStyle}
                />
                <input
                  value={h.value}
                  onChange={e => updateHeader(i, { value: e.target.value })}
                  placeholder="Value"
                  style={{ ...inputStyle, flex: 2 }}
                />
                <button onClick={() => removeHeader(i)} style={smallBtn}>×</button>
              </div>
            ))}
            <button onClick={addHeader} style={{ ...smallBtn, alignSelf: 'flex-start', padding: '4px 10px' }}>
              + Header
            </button>
          </div>
        )}

        {activeTab === 'body' && (
          <textarea
            value={data.body}
            onChange={e => update({ body: e.target.value })}
            placeholder='{ "key": "value" }'
            style={{
              width: '100%', height: '100%', minHeight: 200,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'rgba(220,230,245,0.9)', fontSize: 12,
              padding: 8, fontFamily: 'monospace', resize: 'none', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        )}

        {activeTab === 'response' && data.response && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              <span style={{ color: statusColor, fontWeight: 700 }}>
                {data.response.status} {data.response.statusText}
              </span>
              <span>{data.response.time}ms</span>
            </div>
            <pre style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 6, padding: 10, fontSize: 11, color: 'rgba(200,215,240,0.85)',
              overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {(() => {
                try { return JSON.stringify(JSON.parse(data.response.body), null, 2); }
                catch { return data.response.body; }
              })()}
            </pre>
          </div>
        )}

        {activeTab === 'response' && !data.response && (
          <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            Envie uma requisição para ver a resposta
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5, color: 'rgba(220,230,245,0.9)', fontSize: 11, padding: '3px 7px',
  fontFamily: 'monospace', outline: 'none',
};

const smallBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5, color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
  fontSize: 12, padding: '3px 7px', fontFamily: 'monospace',
};
