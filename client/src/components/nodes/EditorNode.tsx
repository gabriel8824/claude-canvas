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
import { EditorData, EditorTab } from '../../types';
import { useCanvasStore } from '../../store';

interface Props {
  nodeId: string;
  data: EditorData;
}

let tabCounter = 0;
function makeTabId() { return `tab-${++tabCounter}-${Date.now()}`; }

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

function langLabel(ext: string): string {
  const m: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    json: 'JSON', css: 'CSS', html: 'HTML', md: 'Markdown',
    py: 'Python', rs: 'Rust', sh: 'Shell', txt: 'Text',
    gitignore: 'Git', env: 'Env',
  };
  return m[ext.toLowerCase()] ?? (ext.toUpperCase() || 'Text');
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

// Per-tab editor view cache: tabId → EditorView
const tabViewCache = new Map<string, EditorView>();

export function EditorNode({ nodeId, data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { updateNodeData } = useCanvasStore();

  // Normalize data: handle legacy single-file format
  const tabs: EditorTab[] = (() => {
    if (data.tabs && data.tabs.length > 0) return data.tabs;
    // Legacy: migrate single filePath to tabs
    if (data.filePath) {
      return [{ id: makeTabId(), filePath: data.filePath, isDirty: data.isDirty ?? false }];
    }
    return [];
  })();

  const activeTabId = data.activeTabId || tabs[0]?.id || '';
  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0] ?? null;

  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  // ── Switch active tab ──────────────────────────────────────────────────────
  function switchTab(tabId: string) {
    // Detach current view from DOM before switching
    if (activeTabId) {
      const currentView = tabViewCache.get(activeTabId);
      if (currentView && containerRef.current?.contains(currentView.dom)) {
        currentView.dom.remove();
      }
    }
    updateNodeData(nodeId, { activeTabId: tabId } as Partial<EditorData>);
  }

  // ── Close tab ─────────────────────────────────────────────────────────────
  function closeTab(tabId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.isDirty) {
      if (!confirm(`Fechar ${tab.filePath.split('/').pop()} sem salvar?`)) return;
    }
    // Destroy cached view
    const view = tabViewCache.get(tabId);
    if (view) { view.destroy(); tabViewCache.delete(tabId); }

    const newTabs = tabs.filter(t => t.id !== tabId);
    const newActiveId = tabId === activeTabId
      ? (newTabs[newTabs.length - 1]?.id || '')
      : activeTabId;

    updateNodeData(nodeId, { tabs: newTabs, activeTabId: newActiveId } as Partial<EditorData>);
  }

  // ── Load file into CodeMirror ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeTab || !activeTab.filePath) {
      setStatus('error');
      setErrorMsg(tabs.length === 0 ? 'Nenhum arquivo aberto.' : 'Arquivo não definido.');
      return;
    }

    const { filePath } = activeTab;
    const ext = filePath.split('.').pop() ?? '';

    // Check if we have a cached view for this tab
    const cachedView = tabViewCache.get(activeTab.id);
    if (cachedView && containerRef.current) {
      // Re-attach cached view
      if (!containerRef.current.contains(cachedView.dom)) {
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(cachedView.dom);
      }
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(({ content, error }: { content: string; error?: string }) => {
        if (cancelled) return;
        if (error) { setStatus('error'); setErrorMsg(error); return; }

        const lang = langFor(ext);
        const tabId = activeTab.id;

        function doSave() {
          const view = tabViewCache.get(tabId);
          if (!view) return;
          const currentContent = view.state.doc.toString();
          setStatus('saving');
          fetch('/api/files/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: currentContent }),
          })
            .then(r => r.json())
            .then(({ error: e }) => {
              if (e) { setStatus('error'); setErrorMsg(e); }
              else {
                setStatus('ready');
                // Mark tab as clean
                const st = useCanvasStore.getState();
                const d = st.nodes.find(n => n.id === nodeId)?.data as EditorData | undefined;
                if (d) {
                  const updatedTabs = (d.tabs || []).map(t =>
                    t.id === tabId ? { ...t, isDirty: false } : t
                  );
                  st.updateNodeData(nodeId, { tabs: updatedTabs } as Partial<EditorData>);
                }
                setSaveMsg('Salvo');
                setTimeout(() => setSaveMsg(''), 2000);
              }
            })
            .catch(err => { setStatus('error'); setErrorMsg(String(err)); });
        }

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
                // Mark active tab as dirty
                const st = useCanvasStore.getState();
                const d = st.nodes.find(n => n.id === nodeId)?.data as EditorData | undefined;
                if (d) {
                  const updatedTabs = (d.tabs || []).map(t =>
                    t.id === tabId ? { ...t, isDirty: true } : t
                  );
                  st.updateNodeData(nodeId, { tabs: updatedTabs } as Partial<EditorData>);
                }
              }
            }),
            ...(lang ? [lang] : []),
          ] as import('@codemirror/state').Extension[],
        });

        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          const view = new EditorView({ state, parent: containerRef.current });
          tabViewCache.set(tabId, view);
        }
        setStatus('ready');
      })
      .catch(err => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(String(err));
      });

    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.filePath]);

  // ── Save current active tab ────────────────────────────────────────────────
  function doSaveActive() {
    if (!activeTab) return;
    const view = tabViewCache.get(activeTab.id);
    if (!view) return;
    const content = view.state.doc.toString();
    setStatus('saving');
    fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: activeTab.filePath, content }),
    })
      .then(r => r.json())
      .then(({ error: e }) => {
        if (e) { setStatus('error'); setErrorMsg(e); }
        else {
          setStatus('ready');
          const st = useCanvasStore.getState();
          const d = st.nodes.find(n => n.id === nodeId)?.data as EditorData | undefined;
          if (d) {
            const updatedTabs = (d.tabs || []).map(t =>
              t.id === activeTab.id ? { ...t, isDirty: false } : t
            );
            st.updateNodeData(nodeId, { tabs: updatedTabs } as Partial<EditorData>);
          }
          setSaveMsg('Salvo');
          setTimeout(() => setSaveMsg(''), 2000);
        }
      })
      .catch(err => { setStatus('error'); setErrorMsg(String(err)); });
  }

  if (tabs.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: 'rgba(5,8,20,0.88)',
        alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: 'monospace',
        gap: 8,
      }}>
        <span style={{ fontSize: 32 }}>✏️</span>
        <span>Nenhum arquivo aberto</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.12)' }}>
          Clique em um arquivo no File Browser
        </span>
      </div>
    );
  }

  const ext = activeTab?.filePath?.split('.').pop() ?? '';
  const isDirtyActive = activeTab?.isDirty ?? false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,8,20,0.88)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'stretch', flexShrink: 0,
        overflowX: 'auto', overflowY: 'hidden',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        height: 34, minHeight: 34,
      }}>
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const fileName = tab.filePath.split('/').pop() ?? tab.filePath;
          return (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '0 8px 0 12px',
                borderRight: '1px solid rgba(255,255,255,0.05)',
                background: isActive ? 'rgba(140,190,255,0.06)' : 'transparent',
                borderBottom: isActive ? '1px solid rgba(140,190,255,0.4)' : '1px solid transparent',
                cursor: 'pointer',
                minWidth: 0, maxWidth: 160,
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              <span style={{
                fontSize: 12, fontFamily: 'monospace',
                color: isActive
                  ? (tab.isDirty ? 'rgba(220,230,245,0.95)' : 'rgba(170,190,225,0.85)')
                  : 'rgba(255,255,255,0.35)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {fileName}{tab.isDirty ? ' ●' : ''}
              </span>
              <button
                onClick={e => closeTab(tab.id, e)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: isActive ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
                  fontSize: 14, lineHeight: 1, padding: '0 2px',
                  flexShrink: 0, display: 'flex', alignItems: 'center',
                }}
              >
                ×
              </button>
            </div>
          );
        })}

        {/* Right side: language + save status */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 8px' }}>
          {saveMsg && <span style={{ fontSize: 10, color: '#4ade80', fontFamily: 'monospace' }}>{saveMsg}</span>}
          {status === 'saving' && <span style={{ fontSize: 10, color: 'rgba(255,200,80,0.8)', fontFamily: 'monospace' }}>Salvando…</span>}
          {activeTab && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
              {langLabel(ext)}
            </span>
          )}
          <button
            onClick={doSaveActive}
            disabled={!isDirtyActive || status === 'saving' || status === 'loading'}
            title="Salvar (Ctrl+S / ⌘S)"
            style={{
              background: isDirtyActive ? 'rgba(100,180,255,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isDirtyActive ? 'rgba(100,180,255,0.3)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 5, padding: '2px 9px', fontSize: 11, fontFamily: 'monospace',
              color: isDirtyActive ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.2)',
              cursor: isDirtyActive ? 'pointer' : 'default', transition: 'all 0.15s',
            }}
          >
            Salvar
          </button>
        </div>
      </div>

      {/* Editor area */}
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
