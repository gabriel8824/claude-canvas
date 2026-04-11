import { useState, useRef, useEffect } from 'react';

interface SearchResult {
  file: string;
  rel: string;
  line: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

interface Props {
  rootPath: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

export function SearchModal({ rootPath, onClose, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(query), 400);
  }, [query, caseSensitive, useRegex]);

  async function doSearch(q: string) {
    setSearching(true);
    try {
      const params = new URLSearchParams({
        path: rootPath,
        q,
        caseSensitive: String(caseSensitive),
        regex: String(useRegex),
      });
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {}
    finally { setSearching(false); }
  }

  // Group results by file
  const byFile = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file)!.push(r);
  }

  function highlight(text: string, start: number, end: number): React.ReactNode {
    return (
      <>
        {text.slice(0, start)}
        <mark style={{ background: 'rgba(250,204,21,0.3)', color: 'rgba(250,230,100,0.95)', borderRadius: 2 }}>
          {text.slice(start, end)}
        </mark>
        {text.slice(end)}
      </>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99998, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '6vh' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'rgba(8,12,28,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar no projeto..."
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'rgba(220,230,245,0.9)', fontSize: 14, fontFamily: 'monospace' }}
            />
            {searching && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>⟳</span>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontFamily: 'monospace' }}>
              <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
              Aa maiúsculas
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontFamily: 'monospace' }}>
              <input type="checkbox" checked={useRegex} onChange={e => setUseRegex(e.target.checked)} />
              .* regex
            </label>
            {results.length > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                {results.length} resultados em {byFile.size} arquivos
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {!query && (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12, fontFamily: 'monospace' }}>
              Digite para buscar em todos os arquivos do projeto
            </div>
          )}
          {query && !searching && results.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12, fontFamily: 'monospace' }}>
              Nenhum resultado encontrado
            </div>
          )}
          {Array.from(byFile.entries()).map(([file, fileResults]) => (
            <div key={file} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div
                style={{ padding: '6px 16px', background: 'rgba(255,255,255,0.03)', fontSize: 11, color: 'rgba(140,190,255,0.8)', fontFamily: 'monospace', cursor: 'pointer' }}
                onClick={() => onOpenFile(file)}
              >
                {fileResults[0].rel} ({fileResults.length})
              </div>
              {fileResults.slice(0, 10).map((r, i) => (
                <div
                  key={i}
                  onClick={() => onOpenFile(r.file)}
                  style={{ padding: '5px 16px 5px 28px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline' }}
                >
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', flexShrink: 0, minWidth: 30, textAlign: 'right' }}>
                    {r.line}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(200,215,240,0.75)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {highlight(r.lineText.trim(), r.matchStart - (r.lineText.length - r.lineText.trimStart().length), r.matchEnd - (r.lineText.length - r.lineText.trimStart().length))}
                  </span>
                </div>
              ))}
              {fileResults.length > 10 && (
                <div style={{ padding: '3px 28px', fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                  +{fileResults.length - 10} mais resultados
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
          Enter para abrir arquivo · Esc fechar
        </div>
      </div>
    </div>
  );
}
