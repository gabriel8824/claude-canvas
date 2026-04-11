import { useState } from 'react';
import { Marked } from 'marked';
import { NotesData } from '../../types';
import { useCanvasStore } from '../../store';

const md = new Marked({ breaks: true, gfm: true });

interface Props {
  nodeId: string;
  data: NotesData;
}

export function NotesNode({ nodeId, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const [focused, setFocused] = useState(false);

  function setContent(content: string) {
    updateNodeData(nodeId, { content });
  }

  function toggleMarkdown() {
    updateNodeData(nodeId, { renderMarkdown: !data.renderMarkdown });
  }

  const showMarkdown = data.renderMarkdown && !focused;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(8,10,24,0.9)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)', flexShrink: 0,
      }}>
        <button
          onClick={toggleMarkdown}
          title={data.renderMarkdown ? 'Modo edição' : 'Renderizar Markdown'}
          style={{
            background: data.renderMarkdown ? 'rgba(140,190,255,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${data.renderMarkdown ? 'rgba(140,190,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 6, color: data.renderMarkdown ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.4)',
            cursor: 'pointer', padding: '2px 9px', fontSize: 11, fontFamily: 'monospace',
          }}
        >
          {data.renderMarkdown ? '✏️ Editar' : 'MD Preview'}
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>
          {data.content.length} chars
        </span>
      </div>

      {/* Content */}
      {showMarkdown ? (
        <div
          data-node-content
          onClick={() => setFocused(true)}
          style={{
            flex: 1, overflow: 'auto', padding: '12px 16px',
            color: 'rgba(220,230,245,0.9)', fontSize: 13, lineHeight: 1.7,
            cursor: 'text',
          }}
          dangerouslySetInnerHTML={{ __html: md.parse(data.content || '*Clique para editar...*') as string }}
        />
      ) : (
        <textarea
          data-node-content
          value={data.content}
          onChange={e => setContent(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Suas notas aqui... Suporte a Markdown."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
            color: 'rgba(220,230,245,0.9)', fontSize: 13, lineHeight: 1.7,
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            padding: '12px 16px',
          }}
        />
      )}
    </div>
  );
}
