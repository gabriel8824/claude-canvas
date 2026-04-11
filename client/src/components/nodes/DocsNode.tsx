import { useState, useEffect, useRef, useCallback } from 'react';
import { Marked } from 'marked';
import { DocsData } from '../../types';
import { useCanvasStore } from '../../store';
import { GraphView } from './GraphView';

interface MdFile { path: string; name: string; rel: string; }

interface SearchResult {
  file: string;
  name: string;
  rel: string;
  snippet: string;
  line: number;
}

interface Props {
  nodeId: string;
  data: DocsData;
  width: number;
  height: number;
}

// ─── Isolated marked instance (no global state, HMR-safe) ────────────────────

const md = new Marked({
  breaks: true,
  gfm: true,
  renderer: {
    link({ href, title, text }) {
      if (href?.startsWith('#wiki:'))
        return `<a href="${href}" class="wiki-link" title="${title ?? ''}">${text}</a>`;
      return `<a href="${href ?? ''}" title="${title ?? ''}" target="_blank" rel="noopener">${text}</a>`;
    },
    code({ text, lang }) {
      if (lang === 'mermaid') {
        return `<div class="mermaid-block" data-code="${encodeURIComponent(text)}"></div>`;
      }
      const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<div class="code-block"><div class="code-lang">${lang ?? 'text'}</div><pre><code>${escaped}</code></pre></div>`;
    },
  },
});

function buildHtml(raw: string): string {
  const withWiki = raw.replace(/\[\[([^\]]+)\]\]/g, (_, t) => {
    const label = t.split('|').pop()!.trim();
    const href  = t.split('|')[0].trim();
    return `<a href="#wiki:${encodeURIComponent(href)}" class="wiki-link">${label}</a>`;
  });
  return md.parse(withWiki) as string;
}

// ─── File tree helpers ────────────────────────────────────────────────────────

interface TreeNode { name: string; rel: string; path?: string; children?: TreeNode[]; }

function buildTree(files: MdFile[]): TreeNode[] {
  const root: TreeNode = { name: '', rel: '', children: [] };
  for (const f of files) {
    const parts = f.rel.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur.children!.push({ name: p, rel: f.rel, path: f.path });
      } else {
        let child = cur.children!.find(c => c.name === p && !c.path);
        if (!child) { child = { name: p, rel: parts.slice(0, i+1).join('/'), children: [] }; cur.children!.push(child); }
        cur = child;
      }
    }
  }
  return root.children!;
}

// ─── Flat tree (no recursive components — avoids call stack overflow) ─────────

interface FlatItem { node: TreeNode; depth: number; }

function flattenTree(nodes: TreeNode[], openDirs: Set<string>, depth = 0): FlatItem[] {
  const out: FlatItem[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (!node.path && openDirs.has(node.rel) && node.children?.length) {
      for (const item of flattenTree(node.children, openDirs, depth + 1)) out.push(item);
    }
  }
  return out;
}

// ─── CSS injected once ────────────────────────────────────────────────────────

const DOCS_CSS = `
.docs-content { color: rgba(210,225,245,0.92); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.75; }
.docs-content h1,.docs-content h2,.docs-content h3,.docs-content h4,.docs-content h5,.docs-content h6 { color: rgba(230,240,255,0.98); font-weight: 600; margin: 1.5em 0 0.5em; line-height: 1.3; }
.docs-content h1 { font-size: 1.9em; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.3em; }
.docs-content h2 { font-size: 1.45em; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 0.2em; }
.docs-content h3 { font-size: 1.2em; }
.docs-content p  { margin: 0.75em 0; }
.docs-content a  { color: #7eb6ff; text-decoration: none; }
.docs-content a:hover { text-decoration: underline; }
.docs-content a.wiki-link { color: #c084fc; border-bottom: 1px dashed rgba(192,132,252,0.4); }
.docs-content a.wiki-link:hover { border-bottom-style: solid; }
.docs-content code { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 1px 5px; font-family: "JetBrains Mono","Fira Code",monospace; font-size: 0.87em; color: rgba(240,200,140,0.9); }
.docs-content .code-block { background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; overflow: hidden; margin: 1em 0; }
.docs-content .code-lang { background: rgba(255,255,255,0.05); padding: 3px 12px; font-size: 11px; font-family: monospace; color: rgba(255,255,255,0.35); border-bottom: 1px solid rgba(255,255,255,0.07); text-transform: uppercase; letter-spacing: 0.06em; }
.docs-content .code-block pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.docs-content .code-block code { background: none; border: none; padding: 0; color: rgba(200,230,200,0.92); font-size: 13px; }
.docs-content blockquote { border-left: 3px solid rgba(126,182,255,0.45); margin: 1em 0; padding: 6px 14px; background: rgba(126,182,255,0.06); border-radius: 0 6px 6px 0; color: rgba(190,210,245,0.8); }
.docs-content ul,.docs-content ol { padding-left: 1.6em; margin: 0.6em 0; }
.docs-content li { margin: 0.25em 0; }
.docs-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 1.5em 0; }
.docs-content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
.docs-content th { background: rgba(255,255,255,0.06); color: rgba(220,235,255,0.9); font-weight: 600; text-align: left; padding: 7px 12px; border: 1px solid rgba(255,255,255,0.08); }
.docs-content td { padding: 6px 12px; border: 1px solid rgba(255,255,255,0.07); color: rgba(200,215,240,0.85); }
.docs-content tr:hover td { background: rgba(255,255,255,0.03); }
.docs-content img { max-width: 100%; border-radius: 6px; margin: 0.5em 0; }
.docs-content input[type=checkbox] { margin-right: 6px; }
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('docs-style')) return;
  const s = document.createElement('style');
  s.id = 'docs-style';
  s.textContent = DOCS_CSS;
  document.head.appendChild(s);
}

// ─── Main component ───────────────────────────────────────────────────────────

const SIDEBAR_W = 220;

export function DocsNode({ nodeId, data, width }: Props) {
  const { updateNodeData } = useCanvasStore();
  const [files, setFiles]           = useState<MdFile[]>([]);
  const [tree,  setTree]            = useState<TreeNode[]>([]);
  const [openDirs, setOpenDirs]     = useState<Set<string>>(new Set());
  const [viewMode, setViewMode]     = useState<'tree' | 'graph'>('tree');
  const [html,  setHtml]            = useState('');
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [history, setHistory]       = useState<string[]>(data.history || []);
  const [histIdx, setHistIdx]       = useState(-1);
  const [rootInput, setRootInput]   = useState(data.rootPath || '~');
  const contentRef                  = useRef<HTMLDivElement>(null);

  // Full-text search state
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [showSearch,    setShowSearch]    = useState(false);

  // Backlinks state
  const [backlinks, setBacklinks] = useState<Array<{ file: string; name: string; rel: string }>>([]);

  useEffect(() => { injectCss(); }, []);

  // Dynamically load mermaid from CDN
  useEffect(() => {
    if ((window as any).mermaid) return;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
      (window as any).mermaid?.initialize({ startOnLoad: false, theme: 'dark' });
    };
    document.head.appendChild(script);
  }, []);

  // Render mermaid blocks after HTML content changes
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const tryRender = () => {
      if (!(window as any).mermaid) return;
      const blocks = container.querySelectorAll('.mermaid-block');
      blocks.forEach(async (block: Element) => {
        const el = block as HTMLElement;
        if (el.dataset.rendered) return;
        el.dataset.rendered = 'true';
        const code = decodeURIComponent(el.dataset.code || '');
        try {
          const id = `m${Date.now()}${Math.random().toString(36).slice(2)}`;
          const { svg } = await (window as any).mermaid.render(id, code);
          el.innerHTML = svg;
          el.style.cssText = 'background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; margin: 8px 0; overflow: auto;';
        } catch (e) {
          el.textContent = `Mermaid error: ${e}`;
          el.style.color = '#f87171';
        }
      });
    };
    // Try immediately, and retry after a short delay in case mermaid hasn't loaded yet
    tryRender();
    const timer = setTimeout(tryRender, 800);
    return () => clearTimeout(timer);
  }, [html]);

  // Load file list
  const loadFiles = useCallback((root: string) => {
    fetch(`/api/docs/list?path=${encodeURIComponent(root)}`)
      .then(r => r.json())
      .then(({ files: f }: { files: MdFile[] }) => {
        const t = buildTree(f);
        setFiles(f);
        setTree(t);
        // Open only top-level dirs by default
        setOpenDirs(new Set(t.filter(n => !n.path).map(n => n.rel)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadFiles(data.rootPath || '~'); }, [data.rootPath]);

  // Full-text search
  async function doSearch(q: string) {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/docs/search?path=${encodeURIComponent(data.rootPath || '~')}&q=${encodeURIComponent(q)}`);
      const { results } = await res.json();
      setSearchResults(results || []);
    } catch {}
    finally { setSearching(false); }
  }

  // Load backlinks when currentFile changes
  useEffect(() => {
    if (!data.currentFile || !data.rootPath) { setBacklinks([]); return; }
    fetch(`/api/docs/backlinks?rootPath=${encodeURIComponent(data.rootPath)}&file=${encodeURIComponent(data.currentFile)}`)
      .then(r => r.json())
      .then(({ backlinks: bl }) => setBacklinks(bl || []))
      .catch(() => setBacklinks([]));
  }, [data.currentFile, data.rootPath]);

  // Open a file
  const openFile = useCallback((filePath: string) => {
    if (!filePath) return;
    setLoading(true);
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(({ content, error }: { content: string; error?: string }) => {
        setLoading(false);
        if (error || content == null) { setHtml(`<p style="color:#f87171">${error ?? 'Arquivo não encontrado'}</p>`); return; }
        setHtml(buildHtml(content));
        updateNodeData(nodeId, { currentFile: filePath, history });
        // Scroll to top
        setTimeout(() => contentRef.current?.scrollTo({ top: 0 }), 50);
      })
      .catch(() => setLoading(false));
  }, [nodeId, history]);

  // Navigate to file (with history)
  function navigate(filePath: string) {
    const newHist = [...history.slice(0, histIdx + 1), filePath];
    setHistory(newHist);
    setHistIdx(newHist.length - 1);
    updateNodeData(nodeId, { currentFile: filePath, history: newHist });
    openFile(filePath);
  }

  function goBack() {
    if (histIdx <= 0) return;
    const idx = histIdx - 1;
    setHistIdx(idx);
    openFile(history[idx]);
  }

  function goForward() {
    if (histIdx >= history.length - 1) return;
    const idx = histIdx + 1;
    setHistIdx(idx);
    openFile(history[idx]);
  }

  // Open wiki link target by fuzzy-matching filename
  function openWikiLink(target: string) {
    const norm = target.toLowerCase().replace(/\.mdx?$/, '');
    const match = files.find(f => f.name.toLowerCase().replace(/\.mdx?$/, '') === norm
      || f.rel.toLowerCase().replace(/\.mdx?$/, '') === norm);
    if (match) navigate(match.path);
  }

  // Load initial file
  useEffect(() => {
    if (data.currentFile) { setHistIdx(0); setHistory([data.currentFile]); openFile(data.currentFile); }
  }, []);

  // Intercept wiki-link clicks in rendered HTML
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#wiki:')) {
        e.preventDefault();
        openWikiLink(decodeURIComponent(href.slice(6)));
      }
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [files, histIdx]);

  const currentFile = history[histIdx] ?? '';
  const filteredFiles = search
    ? files.filter(f => f.rel.toLowerCase().includes(search.toLowerCase()))
    : null;

  const sidebarW = Math.min(SIDEBAR_W, width * 0.3);

  return (
    <div style={{ display: 'flex', height: '100%', background: 'rgba(5,8,20,0.95)', overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{
        width: sidebarW, flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(4,6,15,0.7)',
      }}>
        {/* Root path input */}
        <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <input
            value={rootInput}
            onChange={e => setRootInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                updateNodeData(nodeId, { rootPath: rootInput });
                loadFiles(rootInput);
              }
            }}
            placeholder="Caminho do projeto"
            title="Pressione Enter para recarregar"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 5, padding: '3px 7px', fontSize: 11,
              color: 'rgba(140,190,255,0.85)', outline: 'none', fontFamily: 'monospace',
            }}
          />
        </div>

        {/* Search */}
        <div style={{ padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Buscar docs…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 5, padding: '3px 7px', fontSize: 11,
              color: 'rgba(200,215,240,0.85)', outline: 'none',
            }}
          />
        </div>

        {/* File tree / search results — flat list, no recursive components */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredFiles ? (
            filteredFiles.length === 0 ? (
              <div style={{ padding: '12px 10px', fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
                Nenhum resultado
              </div>
            ) : (
              filteredFiles.map(f => (
                <div
                  key={f.path}
                  onClick={() => navigate(f.path)}
                  style={{
                    padding: '4px 10px', cursor: 'pointer', fontSize: 11,
                    color: f.path === currentFile ? 'rgba(140,190,255,0.95)' : 'rgba(200,215,240,0.7)',
                    background: f.path === currentFile ? 'rgba(126,182,255,0.1)' : 'transparent',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { if (f.path !== currentFile) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (f.path !== currentFile) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  title={f.rel}
                >
                  📄 {f.rel}
                </div>
              ))
            )
          ) : tree.length === 0 ? (
            <div style={{ padding: '20px 10px', fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', lineHeight: 1.6 }}>
              Nenhum arquivo .md encontrado<br />
              <span style={{ fontSize: 10, opacity: 0.6 }}>Configure o caminho acima</span>
            </div>
          ) : (
            flattenTree(tree, openDirs).map(({ node, depth }) => {
              const isDir = !node.path;
              const isOpen = isDir && openDirs.has(node.rel);
              const active = node.path === currentFile;
              const indent = 12 + depth * 14;
              return (
                <div
                  key={node.rel + (node.path ?? '')}
                  onClick={() => {
                    if (isDir) {
                      setOpenDirs(prev => {
                        const next = new Set(prev);
                        next.has(node.rel) ? next.delete(node.rel) : next.add(node.rel);
                        return next;
                      });
                    } else {
                      navigate(node.path!);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: `3px 8px 3px ${indent}px`,
                    cursor: 'pointer', userSelect: 'none', fontSize: 12,
                    background: active ? 'rgba(126,182,255,0.12)' : 'transparent',
                    color: isDir
                      ? 'rgba(255,255,255,0.45)'
                      : active ? 'rgba(140,190,255,0.95)' : 'rgba(200,215,240,0.7)',
                    borderRight: active ? '2px solid rgba(126,182,255,0.7)' : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = active ? 'rgba(126,182,255,0.12)' : 'transparent'; }}
                >
                  {isDir && (
                    <span style={{ fontSize: 9, opacity: 0.6, display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
                  )}
                  <span style={{ fontSize: 11, opacity: isDir ? 1 : 0.7 }}>{isDir ? '📁' : '📄'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isDir ? node.name : node.name.replace(/\.mdx?$/, '')}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* File count */}
        <div style={{ padding: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'right', flexShrink: 0 }}>
          {files.length} arquivo{files.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Nav bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
          background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}>
          <NavBtn onClick={goBack}    disabled={histIdx <= 0}                   title="Voltar">←</NavBtn>
          <NavBtn onClick={goForward} disabled={histIdx >= history.length - 1}  title="Avançar">→</NavBtn>
          <span style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'rgba(140,190,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>
            {currentFile ? currentFile.split('/').pop()?.replace(/\.mdx?$/, '') : '—'}
          </span>
          <NavBtn onClick={() => loadFiles(data.rootPath || '~')} title="Recarregar">↺</NavBtn>
          <button
            onClick={() => { setShowSearch(s => !s); }}
            title="Busca full-text"
            style={{
              background: showSearch ? 'rgba(140,100,255,0.25)' : 'rgba(255,255,255,0.04)',
              border: showSearch ? '1px solid rgba(140,100,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 5, cursor: 'pointer',
              color: showSearch ? 'rgba(200,170,255,0.95)' : 'rgba(255,255,255,0.5)',
              width: 24, height: 24, fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            🔍
          </button>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <ObsidianBtn rootPath={data.rootPath} currentFile={currentFile} />
        </div>

        {/* Full-text search panel */}
        {showSearch && (
          <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ padding: '6px 10px', display: 'flex', gap: 6 }}>
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doSearch(searchQuery); if (e.key === 'Escape') setShowSearch(false); }}
                placeholder="Buscar em todos os documentos…"
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6, padding: '5px 8px', fontSize: 12,
                  color: 'rgba(215,230,250,0.9)', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={() => doSearch(searchQuery)}
                disabled={searching}
                style={{
                  background: 'rgba(140,100,255,0.2)', border: '1px solid rgba(140,100,255,0.35)',
                  borderRadius: 6, color: 'rgba(200,170,255,0.95)', cursor: 'pointer',
                  padding: '5px 12px', fontSize: 11, fontWeight: 600,
                  opacity: searching ? 0.5 : 1,
                }}
              >
                {searching ? '…' : 'Buscar'}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div style={{ maxHeight: 240, overflow: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {searchResults.map((r, i) => (
                  <div
                    key={`${r.file}-${r.line}-${i}`}
                    onClick={() => { navigate(r.file); setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                    style={{
                      padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.03)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: 'rgba(140,190,255,0.85)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {r.name.replace(/\.mdx?$/, '')}
                      </span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', flexShrink: 0 }}>
                        :{r.line}
                      </span>
                    </div>
                    <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', color: 'rgba(200,215,240,0.55)', whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: 48, overflow: 'hidden' }}>
                      {r.snippet}
                    </pre>
                  </div>
                ))}
              </div>
            )}
            {searchResults.length === 0 && searchQuery && !searching && (
              <div style={{ padding: '6px 10px', fontSize: 11, color: 'rgba(255,255,255,0.25)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                Nenhum resultado para "{searchQuery}"
              </div>
            )}
          </div>
        )}

        {/* Rendered markdown or graph */}
        {viewMode === 'graph' ? (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <GraphView
              rootPath={data.rootPath || '~'}
              currentFile={currentFile}
              onSelect={navigate}
              width={width - Math.min(SIDEBAR_W, width * 0.3)}
              height={500}
            />
          </div>
        ) : (
          <div
            ref={contentRef}
            style={{ flex: 1, overflow: 'auto', padding: '20px 28px' }}
          >
            {loading ? (
              <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, padding: '20px 0' }}>Carregando…</div>
            ) : !html ? (
              <EmptyContent files={files} onSelect={navigate} />
            ) : (
              <>
                <div
                  className="docs-content"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {backlinks.length > 0 && (
                  <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: '0.08em', marginBottom: 10 }}>
                      BACKLINKS ({backlinks.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {backlinks.map(bl => (
                        <button
                          key={bl.file}
                          onClick={() => navigate(bl.file)}
                          style={{
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 6, padding: '5px 10px', cursor: 'pointer', textAlign: 'left',
                            color: 'rgba(140,190,255,0.8)', fontSize: 12, fontFamily: 'monospace',
                          }}
                        >
                          ← {bl.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyContent({ files, onSelect }: { files: MdFile[]; onSelect: (p: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'rgba(255,255,255,0.3)' }}>
      <span style={{ fontSize: 40, opacity: 0.4 }}>📚</span>
      <span style={{ fontSize: 14 }}>Selecione um documento</span>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 400 }}>
          {files.slice(0, 6).map(f => (
            <button key={f.path} onClick={() => onSelect(f.path)} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: 'rgba(140,190,255,0.8)', cursor: 'pointer',
              padding: '4px 10px', fontSize: 12,
            }}>
              {f.name.replace(/\.mdx?$/, '')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewToggle({ mode, onChange }: { mode: 'tree' | 'graph'; onChange: (m: 'tree' | 'graph') => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 5, padding: 2, flexShrink: 0 }}>
      {(['tree', 'graph'] as const).map(m => (
        <button key={m} onClick={() => onChange(m)} title={m === 'tree' ? 'Árvore de arquivos' : 'Grafo de links'} style={{
          background: mode === m ? 'rgba(140,100,255,0.3)' : 'transparent',
          border: mode === m ? '1px solid rgba(140,100,255,0.4)' : '1px solid transparent',
          borderRadius: 4, cursor: 'pointer', color: mode === m ? 'rgba(200,170,255,0.95)' : 'rgba(255,255,255,0.4)',
          fontSize: 12, padding: '1px 7px', lineHeight: '18px',
        }}>{m === 'tree' ? '≡' : '◎'}</button>
      ))}
    </div>
  );
}

function ObsidianBtn({ rootPath, currentFile }: { rootPath: string; currentFile: string }) {
  function openInObsidian() {
    let url: string;
    if (currentFile) {
      // Open the specific file in Obsidian by absolute path
      url = `obsidian://open?path=${encodeURIComponent(currentFile)}`;
    } else {
      // Open the vault by folder name
      const vaultName = rootPath.replace(/\/$/, '').split('/').filter(Boolean).pop() ?? rootPath;
      url = `obsidian://open?vault=${encodeURIComponent(vaultName)}`;
    }
    window.open(url, '_blank');
  }

  return (
    <button
      onClick={openInObsidian}
      title={currentFile ? 'Abrir arquivo no Obsidian' : 'Abrir vault no Obsidian'}
      style={{
        background: 'rgba(126,90,200,0.15)',
        border: '1px solid rgba(126,90,200,0.3)',
        borderRadius: 5, cursor: 'pointer',
        width: 24, height: 24, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, lineHeight: 1,
        color: 'rgba(192,150,255,0.85)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(126,90,200,0.3)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(192,150,255,0.5)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(126,90,200,0.15)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(126,90,200,0.3)';
      }}
    >
      🔮
    </button>
  );
}

function NavBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background: 'none', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 5, color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)',
      cursor: disabled ? 'default' : 'pointer', width: 24, height: 24,
      fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {children}
    </button>
  );
}
