import { useState } from 'react';
import { AiReviewData } from '../../types';
import { useCanvasStore } from '../../store';

interface Props {
  nodeId: string;
  data: AiReviewData;
}

export function AiReviewNode({ nodeId, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const [code, setCode] = useState(data.code || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runReview() {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    updateNodeData(nodeId, { loading: true, review: '' });

    try {
      const res = await fetch('/api/ai/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language: data.language || 'auto' }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Stream the response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullReview = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE lines
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6);
            if (text === '[DONE]') break;
            try {
              const parsed = JSON.parse(text);
              fullReview += parsed.delta ?? '';
              updateNodeData(nodeId, { review: fullReview });
            } catch {}
          }
        }
      }

      updateNodeData(nodeId, { loading: false, code, review: fullReview });
    } catch (err: any) {
      setError(err.message);
      updateNodeData(nodeId, { loading: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,7,18,0.9)', fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Linguagem:</span>
        <input
          value={data.language}
          onChange={e => updateNodeData(nodeId, { language: e.target.value })}
          placeholder="auto"
          style={{
            width: 80, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5, color: 'rgba(220,230,245,0.9)', fontSize: 11, padding: '2px 6px',
            fontFamily: 'monospace', outline: 'none',
          }}
        />
        <span style={{ flex: 1 }} />
        <button
          onClick={runReview}
          disabled={loading || !code.trim()}
          style={{
            background: loading ? 'rgba(160,130,255,0.08)' : 'rgba(160,130,255,0.15)',
            border: '1px solid rgba(160,130,255,0.3)',
            borderRadius: 6, color: 'rgba(180,160,255,0.9)',
            cursor: loading ? 'default' : 'pointer', fontSize: 11, padding: '4px 14px',
          }}
        >
          {loading ? '⟳ Revisando…' : '✨ Revisar código'}
        </button>
      </div>

      {/* Content: code input + review output split */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 0 }}>
        {/* Code input */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', padding: '4px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, letterSpacing: '0.06em' }}>
            CÓDIGO
          </div>
          <textarea
            data-node-content
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Cole o código aqui para revisar..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'rgba(200,215,240,0.9)', fontSize: 12, padding: '8px 10px',
              fontFamily: '"JetBrains Mono", monospace', resize: 'none',
              lineHeight: 1.6,
            }}
          />
        </div>

        {/* Review output */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', padding: '4px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, letterSpacing: '0.06em' }}>
            REVISÃO
          </div>
          <div
            data-node-content
            style={{ flex: 1, overflow: 'auto', padding: '8px 10px', color: 'rgba(200,215,240,0.9)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
          >
            {loading && !data.review && (
              <span style={{ color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>Analisando código…</span>
            )}
            {error && <span style={{ color: '#f87171' }}>{error}</span>}
            {data.review || (!loading && !error && <span style={{ color: 'rgba(255,255,255,0.2)' }}>O review aparecerá aqui...</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
