import { useState, useEffect, useRef } from 'react';

interface FileEntry {
  name: string;
  path: string;
  rel: string;
}

interface Props {
  rootPath: string;
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Exact match = highest score
  if (t.includes(q)) return 100 - t.indexOf(q);
  // Fuzzy match score based on proximity
  let score = 0, qi = 0, lastIdx = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += lastIdx === -1 ? 10 : Math.max(1, 10 - (i - lastIdx - 1));
      lastIdx = i;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

export function FuzzyFinder({ rootPath, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load all files
  useEffect(() => {
    setLoading(true);
    fetch(`/api/files/list-all?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(({ files: f }) => { setFiles(f || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [rootPath]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = files
    .filter(f => fuzzyMatch(query, f.rel))
    .map(f => ({ ...f, score: fuzzyScore(query, f.rel) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      onSelect(filtered[selectedIdx].path);
      onClose();
    }
  }

  // Keep selected item in view
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  function highlightMatch(text: string, query: string): React.ReactNode {
    if (!query) return text;
    const q = query.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIdx = 0, qi = 0;
    const indices: number[] = [];
    for (let i = 0; i < text.length && qi < q.length; i++) {
      if (text[i].toLowerCase() === q[qi]) { indices.push(i); qi++; }
    }
    for (const idx of indices) {
      if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
      parts.push(<mark key={idx} style={{ background: 'rgba(140,190,255,0.25)', color: 'rgba(200,230,255,0.95)', borderRadius: 2 }}>{text[idx]}</mark>);
      lastIdx = idx + 1;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return parts;
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(8,12,28,0.97)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          width: 560,
          maxHeight: 400,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar arquivos…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'rgba(220,230,245,0.9)', fontSize: 14, fontFamily: 'monospace',
            }}
          />
          {loading && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>carregando…</span>}
          {!loading && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{filtered.length} arquivos</span>}
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflow: 'auto', flex: 1 }}>
          {filtered.map((file, idx) => (
            <div
              key={file.path}
              onClick={() => { onSelect(file.path); onClose(); }}
              style={{
                padding: '8px 16px',
                background: idx === selectedIdx ? 'rgba(100,150,255,0.14)' : 'transparent',
                borderLeft: idx === selectedIdx ? '2px solid rgba(100,160,255,0.6)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(220,230,245,0.9)' }}>
                {highlightMatch(file.name, query)}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)' }}>
                {highlightMatch(file.rel, query)}
              </span>
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 12, fontFamily: 'monospace' }}>
              Nenhum arquivo encontrado
            </div>
          )}
        </div>

        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 16, fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Esc fechar</span>
        </div>
      </div>
    </div>
  );
}
