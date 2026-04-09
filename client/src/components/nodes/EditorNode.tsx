import { useEffect, useRef, useState } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands';
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { EditorData } from '../../types';
import { useCanvasStore } from '../../store';

interface Props {
  nodeId: string;
  data: EditorData;
}

function langFor(ext: string) {
  switch (ext.toLowerCase()) {
    case 'js': case 'mjs': case 'cjs': return javascript();
    case 'jsx':                         return javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx':                         return javascript({ jsx: true, typescript: true });
    case 'json': case 'jsonc':          return json();
    case 'css': case 'scss':            return css();
    case 'html': case 'htm':            return html();
    case 'md': case 'mdx':             return markdown();
    case 'py':                          return python();
    default:                            return null;
  }
}

const EDITOR_THEME = EditorView.theme({
  '&': { background: 'transparent', height: '100%' },
  '.cm-scroller': {
    overflow: 'auto', height: '100%',
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
    fontSize: '13px', lineHeight: '1.6',
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': {
    background: 'rgba(5,8,20,0.6)', border: 'none',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.2)',
  },
  '.cm-activeLineGutter': { background: 'rgba(140,190,255,0.06)', color: 'rgba(255,255,255,0.5)' },
  '.cm-activeLine':        { background: 'rgba(140,190,255,0.04)' },
  '.cm-cursor':            { borderLeftColor: 'rgba(140,190,255,0.9)' },
  '.cm-selectionBackground':             { background: 'rgba(100,150,255,0.25) !important' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(100,150,255,0.3)  !important' },
  '.cm-matchingBracket': { background: 'rgba(100,200,100,0.15)', outline: '1px solid rgba(100,200,100,0.4)' },
});

export function EditorNode({ nodeId, data }: Props) {
  const containerRef                    = useRef<HTMLDivElement>(null);
  const viewRef                         = useRef<EditorView | null>(null);
  const { updateNodeData }              = useCanvasStore();

  const [status,   setStatus]   = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [isDirty,  setIsDirty]  = useState(false);
  const [saveMsg,  setSaveMsg]  = useState('');

  const filePath = data.filePath;
  const ext      = filePath.split('.').pop() ?? '';
  const fileName = filePath.split('/').pop() ?? filePath;

  // ── Load via REST (avoids all WebSocket timing issues) ──────────────────────
  useEffect(() => {
    if (!filePath) {
      setStatus('error');
      setErrorMsg('Caminho do arquivo não definido.');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setIsDirty(false);

    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(({ content, error }: { content: string; error?: string }) => {
        if (cancelled) return;

        if (error) {
          setStatus('error');
          setErrorMsg(error);
          return;
        }

        const lang = langFor(ext);
        const state = EditorState.create({
          doc: content ?? '',
          extensions: [
            history(), indentOnInput(),
            bracketMatching(), drawSelection(),
            lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
            syntaxHighlighting(defaultHighlightStyle),
            oneDark, EDITOR_THEME,
            keymap.of([
              ...defaultKeymap,
              ...historyKeymap,
              indentWithTab,
              { key: 'Mod-s', run: () => { doSave(); return true; } },
            ]),
            EditorView.updateListener.of(upd => {
              if (upd.docChanged) {
                setIsDirty(true);
                updateNodeData(nodeId, { isDirty: true });
              }
            }),
            ...(lang ? [lang] : []),
          ] as import('@codemirror/state').Extension[],
        });

        // Destroy any previous view first
        viewRef.current?.destroy();
        viewRef.current = null;

        if (containerRef.current) {
          viewRef.current = new EditorView({ state, parent: containerRef.current });
        }

        setStatus('ready');
      })
      .catch(err => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(String(err));
      });

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [filePath]);

  // ── Save via REST ────────────────────────────────────────────────────────────
  function doSave() {
    const view = viewRef.current;
    if (!view || !filePath) return;
    const content = view.state.doc.toString();
    setStatus('saving');

    fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    })
      .then(r => r.json())
      .then(({ error }) => {
        if (error) {
          setStatus('error');
          setErrorMsg(error);
        } else {
          setStatus('ready');
          setIsDirty(false);
          updateNodeData(nodeId, { isDirty: false });
          setSaveMsg('Salvo');
          setTimeout(() => setSaveMsg(''), 2000);
        }
      })
      .catch(err => {
        setStatus('error');
        setErrorMsg(String(err));
      });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,8,20,0.88)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        padding: '0 12px', height: 34,
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', flexShrink: 0 }}>
          {langLabel(ext)}
        </span>
        <span style={{
          flex: 1, fontSize: 12, fontFamily: 'monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: isDirty ? 'rgba(220,230,245,0.9)' : 'rgba(170,190,225,0.65)',
        }}>
          {fileName}{isDirty ? ' ●' : ''}
        </span>
        {saveMsg && <span style={{ fontSize: 10, color: '#4ade80', fontFamily: 'monospace' }}>{saveMsg}</span>}
        {status === 'saving' && <span style={{ fontSize: 10, color: 'rgba(255,200,80,0.8)', fontFamily: 'monospace' }}>Salvando…</span>}
        <button
          onClick={doSave}
          disabled={!isDirty || status === 'saving' || status === 'loading'}
          title="Salvar (Ctrl+S / ⌘S)"
          style={{
            background: isDirty ? 'rgba(100,180,255,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isDirty ? 'rgba(100,180,255,0.3)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 5, padding: '2px 9px', fontSize: 11, fontFamily: 'monospace',
            color: isDirty ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.2)',
            cursor: isDirty ? 'pointer' : 'default', transition: 'all 0.15s',
          }}
        >
          Salvar
        </button>
      </div>

      {/* Editor area — container always in DOM so CodeMirror can measure */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          ref={containerRef}
          data-node-content
          style={{ position: 'absolute', inset: 0 }}
        />

        {status === 'loading' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(5,8,20,0.9)',
            color: 'rgba(255,255,255,0.25)', fontSize: 13, fontFamily: 'monospace',
          }}>
            Carregando…
          </div>
        )}

        {status === 'error' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            padding: 20, overflow: 'auto',
            background: 'rgba(5,8,20,0.94)',
            color: 'rgba(248,113,113,0.85)', fontSize: 12, fontFamily: 'monospace',
          }}>
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

function langLabel(ext: string): string {
  const m: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    json: 'JSON', css: 'CSS', html: 'HTML', md: 'Markdown',
    py: 'Python', rs: 'Rust', sh: 'Shell', txt: 'Text',
    gitignore: 'Git', env: 'Env',
  };
  return m[ext.toLowerCase()] ?? (ext.toUpperCase() || 'Text');
}
