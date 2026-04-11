import { useEffect, useState, useRef, useCallback } from 'react';
import { ws } from '../../ws';
import { FilesData, EditorData, EditorTab, TerminalData, PreviewData, CanvasNode } from '../../types';
import { useCanvasStore } from '../../store';
import { showToast } from '../Toast';

interface FItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  ext?: string;
}

// ── Icons & colors ────────────────────────────────────────────────────────────

const EXT_ICON: Record<string, string> = {
  ts: '🟦', tsx: '🟦', js: '🟨', jsx: '🟨', mjs: '🟨',
  json: '📋', md: '📝', css: '🎨', scss: '🎨', html: '🌐', htm: '🌐',
  py: '🐍', rs: '🦀', go: '🐹', sh: '⚙️', bash: '⚙️', zsh: '⚙️',
  env: '🔐', gitignore: '🙈', png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
  gif: '🖼️', svg: '🎭', pdf: '📄', zip: '📦', tar: '📦', gz: '📦',
  txt: '📄', xml: '📄', yaml: '📄', yml: '📄', toml: '📄',
  lock: '🔒', log: '📋',
};

const EXT_COLOR: Record<string, string> = {
  ts: '#4fc1ff', tsx: '#4fc1ff', js: '#f7df1e', jsx: '#f7df1e',
  json: '#f7df1e', md: '#c8c8c8', css: '#42a5f5', scss: '#c850c0',
  html: '#e34c26', py: '#3572a5', rs: '#dea584', go: '#00add8',
  sh: '#89e051', txt: '#c8c8c8',
};

function getFileColor(ext: string): string {
  return EXT_COLOR[ext?.toLowerCase() || ''] || 'rgba(200,215,240,0.8)';
}

function getIcon(item: FItem): string {
  if (item.type === 'dir') return '📁';
  return EXT_ICON[item.ext?.toLowerCase() || ''] || '📄';
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  nodeId: string;
  data: FilesData;
}

export function FileBrowserNode({ nodeId, data }: Props) {
  const [rootPath,      setRootPath]      = useState(data.currentPath || '~');
  const [inputPath,     setInputPath]     = useState(data.currentPath || '~');
  const [expandedDirs,  setExpandedDirs]  = useState<Set<string>>(() => new Set([data.currentPath || '~']));
  const [dirContents,   setDirContents]   = useState<Map<string, FItem[]>>(new Map());
  const [loadingDirs,   setLoadingDirs]   = useState<Set<string>>(new Set());
  const [selectedPath,  setSelectedPath]  = useState<string | null>(null);
  const [hoveredPath,   setHoveredPath]   = useState<string | null>(null);
  const [contextMenu,   setContextMenu]   = useState<{
    x: number; y: number; item: FItem | null; parentDir: string;
  } | null>(null);
  const [renaming,      setRenaming]      = useState<{ path: string; name: string } | null>(null);
  const [creating,      setCreating]      = useState<{ parentDir: string; type: 'file' | 'dir'; name: string } | null>(null);

  const reqCounter = useRef(0);
  const { updateNodeData, addNode, bringToFront, addNodeToGroup } = useCanvasStore();

  // ── Load a directory ────────────────────────────────────────────────────────
  const loadDir = useCallback((path: string) => {
    setLoadingDirs(prev => new Set(prev).add(path));
    const reqId = `files-${nodeId}-${++reqCounter.current}`;
    const unsub = ws.on('files:list', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub();
      const sorted = (msg.items as FItem[] || []).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setDirContents(prev => new Map(prev).set(path, sorted));
      setLoadingDirs(prev => { const s = new Set(prev); s.delete(path); return s; });
    });
    ws.send({ type: 'files:list', reqId, path });
  }, []);

  // ── Toggle folder expand ─────────────────────────────────────────────────
  function toggleDir(path: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!dirContents.has(path)) loadDir(path);
      }
      return next;
    });
  }

  // ── Change root path ────────────────────────────────────────────────────────
  function navigate(path: string) {
    setRootPath(path);
    setInputPath(path);
    setExpandedDirs(new Set([path]));
    setDirContents(new Map());
    updateNodeData(nodeId, { currentPath: path });
    loadDir(path);
  }

  // ── Open file in an editor node ─────────────────────────────────────────────
  function openFile(filePath: string) {
    setSelectedPath(filePath);
    const state = useCanvasStore.getState();

    // Find which group this file browser belongs to
    const group = state.groups.find(g => g.nodeIds.includes(nodeId));

    // Check if any existing editor node already has this file as a tab
    const existingWithFile = state.nodes.find(n => {
      if (n.type !== 'editor') return false;
      const d = n.data as EditorData;
      if (d.tabs && d.tabs.length > 0) {
        return d.tabs.some(t => t.filePath === filePath);
      }
      return d.filePath === filePath; // legacy
    });

    if (existingWithFile) {
      bringToFront(existingWithFile.id);
      // Switch to that tab
      const d = existingWithFile.data as EditorData;
      if (d.tabs) {
        const tab = d.tabs.find(t => t.filePath === filePath);
        if (tab) {
          updateNodeData(existingWithFile.id, { activeTabId: tab.id } as Partial<EditorData>);
        }
      }
      return;
    }

    // Check if there's a group editor node to add a tab to
    if (group) {
      const groupEditorNode = state.nodes.find(n => n.type === 'editor' && group.nodeIds.includes(n.id));
      if (groupEditorNode) {
        bringToFront(groupEditorNode.id);
        const d = groupEditorNode.data as EditorData;
        const newTab: EditorTab = {
          id: `tab-${Date.now()}`,
          filePath,
          isDirty: false,
        };
        const currentTabs = d.tabs && d.tabs.length > 0
          ? d.tabs
          : (d.filePath ? [{ id: `tab-legacy-${Date.now()}`, filePath: d.filePath, isDirty: d.isDirty ?? false }] : []);
        updateNodeData(groupEditorNode.id, {
          tabs: [...currentTabs, newTab],
          activeTabId: newTab.id,
        } as Partial<EditorData>);
        // Update title to show filename
        const store = useCanvasStore.getState();
        store.updateNode(groupEditorNode.id, { title: filePath.split('/').pop() || filePath });
        return;
      }
    }

    // No existing editor in group, create new node
    let position: { x: number; y: number } | undefined;
    if (group) {
      const groupNodes = group.nodeIds
        .map(id => state.nodes.find(n => n.id === id))
        .filter(Boolean) as typeof state.nodes;
      const maxX = Math.max(...groupNodes.map(n => n.x + n.width));
      const minY = Math.min(...groupNodes.map(n => n.y));
      position = { x: maxX + 32, y: minY };
    }

    const fileName = filePath.split('/').pop() || filePath;
    const tabId = `tab-${Date.now()}`;
    const newNode = addNode('editor', position, {
      title: fileName,
      data: {
        tabs: [{ id: tabId, filePath, isDirty: false }],
        activeTabId: tabId,
        openedFromNodeId: nodeId,
      } as EditorData,
    });

    if (group) addNodeToGroup(group.id, newNode.id);
  }

  // ── Context menu close on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // ── Context menu actions ─────────────────────────────────────────────────────
  async function createItem(parentDir: string, name: string, type: 'file' | 'dir') {
    const newPath = parentDir.replace(/\/$/, '') + '/' + name;
    const res = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath, type }),
    });
    const d = await res.json();
    if (d.error) { showToast(d.error, 'error'); }
    else {
      showToast(`${type === 'dir' ? 'Pasta' : 'Arquivo'} criado: ${name}`, 'success');
      setDirContents(prev => { const m = new Map(prev); m.delete(parentDir); return m; });
      loadDir(parentDir);
      if (!expandedDirs.has(parentDir)) {
        setExpandedDirs(prev => new Set(prev).add(parentDir));
      }
    }
    setContextMenu(null);
    setCreating(null);
  }

  async function renameItem(oldPath: string, newName: string) {
    const parts = oldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    const res = await fetch('/api/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    });
    const d = await res.json();
    if (d.error) { showToast(d.error, 'error'); }
    else {
      showToast(`Renomeado para: ${newName}`, 'success');
      const parentDir = oldPath.split('/').slice(0, -1).join('/');
      setDirContents(prev => { const m = new Map(prev); m.delete(parentDir); return m; });
      loadDir(parentDir);
    }
    setRenaming(null);
  }

  async function deleteItem(itemPath: string, itemName: string) {
    if (!confirm(`Deletar "${itemName}"? Esta ação não pode ser desfeita.`)) return;
    const res = await fetch(`/api/files/delete?path=${encodeURIComponent(itemPath)}`, {
      method: 'DELETE',
    });
    const d = await res.json();
    if (d.error) { showToast(d.error, 'error'); }
    else {
      showToast(`Deletado: ${itemName}`, 'success');
      const parentDir = itemPath.split('/').slice(0, -1).join('/');
      setDirContents(prev => { const m = new Map(prev); m.delete(parentDir); return m; });
      loadDir(parentDir);
    }
    setContextMenu(null);
  }

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => { loadDir(rootPath); }, [rootPath]);

  // ── Tree rendering ───────────────────────────────────────────────────────────
  function renderItems(items: FItem[], depth: number): React.ReactNode {
    return items.map(item => {
      const isExpanded = expandedDirs.has(item.path);
      const isLoading  = loadingDirs.has(item.path);
      const isSelected = selectedPath === item.path;
      const children   = dirContents.get(item.path);
      const indent     = 8 + depth * 16;
      const isDir      = item.type === 'dir';

      const isHovered = hoveredPath === item.path;
      const showActions = isHovered || isSelected;

      return (
        <div key={item.path}>
          <div
            onClick={() => { if (isDir) toggleDir(item.path); else setSelectedPath(item.path); }}
            onMouseEnter={() => setHoveredPath(item.path)}
            onMouseLeave={() => setHoveredPath(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: e.clientX, y: e.clientY,
                item,
                parentDir: isDir ? item.path : item.path.split('/').slice(0, -1).join('/'),
              });
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              paddingLeft: indent, paddingRight: 6,
              height: 24,
              cursor: 'pointer',
              background: isSelected
                ? 'rgba(100,150,255,0.18)'
                : isHovered ? 'rgba(255,255,255,0.05)' : 'transparent',
              borderLeft: isSelected ? '2px solid rgba(100,160,255,0.6)' : '2px solid transparent',
              userSelect: 'none',
            }}
          >
            {/* Expand arrow (dirs only) */}
            <span style={{
              fontSize: 9, width: 12, textAlign: 'center', flexShrink: 0,
              color: 'rgba(255,255,255,0.3)',
              transform: isDir && isExpanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
              display: 'inline-block',
            }}>
              {isDir ? (isLoading ? '⟳' : '▶') : ''}
            </span>

            {/* Icon */}
            <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1 }}>
              {isDir ? (isExpanded ? '📂' : '📁') : getIcon(item)}
            </span>

            {/* Name (inline rename) */}
            {renaming && renaming.path === item.path ? (
              <input
                autoFocus
                defaultValue={renaming.name}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(100,160,255,0.5)',
                  borderRadius: 4, color: 'rgba(220,230,245,0.9)',
                  fontSize: 12, padding: '1px 5px', fontFamily: 'monospace', outline: 'none',
                }}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameItem(renaming.path, (e.target as HTMLInputElement).value); }
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={e => renameItem(renaming.path, e.target.value)}
              />
            ) : (
              <span style={{
                fontSize: 13, flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: isDir ? 'rgba(200,215,245,0.85)' : getFileColor(item.ext || ''),
                fontFamily: 'monospace',
              }}>
                {item.name}
              </span>
            )}

            {/* Hover actions */}
            {showActions && !isDir && (
              <button
                onClick={e => { e.stopPropagation(); openFile(item.path); }}
                title="Abrir no editor"
                style={{
                  flexShrink: 0,
                  background: 'rgba(100,160,255,0.15)',
                  border: '1px solid rgba(100,160,255,0.3)',
                  borderRadius: 4,
                  color: 'rgba(140,190,255,0.9)',
                  cursor: 'pointer',
                  fontSize: 10, padding: '1px 6px',
                  fontFamily: 'monospace',
                  lineHeight: 1.4,
                }}
              >
                editar
              </button>
            )}
            {showActions && isDir && (
              <button
                onClick={e => { e.stopPropagation(); navigate(item.path); }}
                title="Abrir como raiz"
                style={{
                  flexShrink: 0,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 4,
                  color: 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  fontSize: 10, padding: '1px 6px',
                  fontFamily: 'monospace',
                  lineHeight: 1.4,
                }}
              >
                →
              </button>
            )}

            {/* Size (files only, hidden when actions shown) */}
            {!isDir && !showActions && item.size !== undefined && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', flexShrink: 0, fontFamily: 'monospace' }}>
                {formatSize(item.size)}
              </span>
            )}
          </div>

          {/* Children */}
          {isDir && isExpanded && children && renderItems(children, depth + 1)}
          {isDir && isExpanded && !children && !isLoading && (
            <div style={{ paddingLeft: indent + 28, height: 22, fontSize: 11, color: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center' }}>
              vazio
            </div>
          )}
        </div>
      );
    });
  }

  const rootItems = dirContents.get(rootPath);
  const isRootLoading = loadingDirs.has(rootPath);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(5,7,18,0.82)', color: 'rgba(220,230,245,0.9)' }}>
      {/* Path bar */}
      <div style={{
        display: 'flex', gap: 4, padding: '5px 6px', flexShrink: 0,
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button
          onClick={() => {
            if (rootPath === '~' || rootPath === '/') return;
            const parts = rootPath.replace(/\/$/, '').split('/');
            parts.pop();
            navigate(parts.join('/') || '/');
          }}
          title="Subir um nível"
          style={btn}
        >
          ↑
        </button>
        <button onClick={() => { setDirContents(new Map()); loadDir(rootPath); }} title="Atualizar" style={btn}>↺</button>
        <input
          value={inputPath}
          onChange={e => setInputPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(inputPath); }}
          style={{
            flex: 1, background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5, color: 'rgba(140,190,255,0.9)',
            fontSize: 11, padding: '2px 7px', fontFamily: 'monospace', outline: 'none',
          }}
        />
      </div>

      {/* Tree */}
      <div data-node-content style={{ flex: 1, overflow: 'auto', paddingTop: 4, minHeight: 0 }}>
        {isRootLoading && (
          <div style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.25)', fontSize: 12, fontFamily: 'monospace' }}>
            Carregando…
          </div>
        )}
        {!isRootLoading && rootItems?.length === 0 && (
          <div style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.2)', fontSize: 12, fontFamily: 'monospace' }}>
            Pasta vazia
          </div>
        )}
        {!isRootLoading && rootItems && renderItems(rootItems, 0)}
      </div>

      {/* Inline create row */}
      {creating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(100,160,255,0.06)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 12 }}>{creating.type === 'dir' ? '📁' : '📄'}</span>
          <input
            autoFocus
            value={creating.name}
            placeholder={creating.type === 'dir' ? 'Nova pasta…' : 'Novo arquivo…'}
            onChange={e => setCreating(prev => prev ? { ...prev, name: e.target.value } : null)}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(100,160,255,0.4)',
              borderRadius: 4, color: 'rgba(220,230,245,0.9)',
              fontSize: 12, padding: '2px 6px', fontFamily: 'monospace', outline: 'none',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && creating.name.trim()) {
                createItem(creating.parentDir, creating.name.trim(), creating.type);
              }
              if (e.key === 'Escape') setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        </div>
      )}

      {/* NPM Scripts panel */}
      <ScriptsPanel rootPath={rootPath} fileBrowserNodeId={nodeId} />

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x, top: contextMenu.y,
            zIndex: 99999,
            background: 'rgba(8,12,28,0.97)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '4px 0',
            minWidth: 180,
            boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div
            style={ctxItemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setCreating({ parentDir: contextMenu.parentDir, type: 'file', name: '' });
              setContextMenu(null);
            }}
          >
            📄 Novo arquivo
          </div>
          <div
            style={ctxItemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setCreating({ parentDir: contextMenu.parentDir, type: 'dir', name: '' });
              setContextMenu(null);
            }}
          >
            📁 Nova pasta
          </div>
          {contextMenu.item && (
            <>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' }} />
              <div
                style={ctxItemStyle}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  if (contextMenu.item) {
                    setRenaming({ path: contextMenu.item.path, name: contextMenu.item.name });
                  }
                  setContextMenu(null);
                }}
              >
                ✏️ Renomear
              </div>
              <div
                style={{ ...ctxItemStyle, color: 'rgba(255,100,100,0.85)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,80,80,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  if (contextMenu.item) deleteItem(contextMenu.item.path, contextMenu.item.name);
                }}
              >
                🗑️ Deletar
              </div>
              <div
                style={ctxItemStyle}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  if (contextMenu.item) {
                    navigator.clipboard.writeText(contextMenu.item.path).then(() => {
                      showToast('Caminho copiado!', 'success');
                    });
                  }
                  setContextMenu(null);
                }}
              >
                📋 Copiar caminho
              </div>
              {contextMenu.item.type === 'file' && (
                <>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' }} />
                  <div
                    style={ctxItemStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => {
                      if (contextMenu.item) openFile(contextMenu.item.path);
                      setContextMenu(null);
                    }}
                  >
                    📝 Abrir no editor
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5, color: 'rgba(255,255,255,0.4)',
  cursor: 'pointer', padding: '2px 7px', fontSize: 12, flexShrink: 0,
};

const ctxItemStyle: React.CSSProperties = {
  padding: '6px 14px', cursor: 'pointer', color: 'rgba(220,230,245,0.85)',
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'transparent',
};

// ── NPM Scripts panel ────────────────────────────────────────────────────────

const SCRIPT_ICONS: Record<string, string> = {
  dev: '⚡', start: '⚡', serve: '⚡', watch: '⚡',
  build: '🔨', compile: '🔨', bundle: '🔨',
  test: '🧪', lint: '🔍', format: '✨', typecheck: '🔵',
};

function scriptIcon(name: string): string {
  for (const [key, icon] of Object.entries(SCRIPT_ICONS)) {
    if (name.includes(key)) return icon;
  }
  return '▶';
}

function isDevScript(name: string) { return /dev|start|serve|watch/.test(name); }
function isBuildScript(name: string) { return /build|compile|bundle/.test(name); }

function scriptColor(name: string): string {
  if (isDevScript(name))   return '#4ade80';
  if (isBuildScript(name)) return '#fb923c';
  if (/test/.test(name))   return '#60a5fa';
  return 'rgba(255,255,255,0.45)';
}

/** Detect dev server port from script command + package.json deps */
function detectPort(scriptCmd: string, allDeps: Record<string, string>): number {
  // Explicit --port / -p flag in the script command
  const portMatch = scriptCmd.match(/(?:--port|-p)\s+(\d+)/);
  if (portMatch) return Number(portMatch[1]);

  // Framework defaults
  if ('vite' in allDeps) return 5173;
  if ('next' in allDeps) return 3000;
  if ('nuxt' in allDeps) return 3000;
  if ('react-scripts' in allDeps) return 3000;
  if ('@angular/cli' in allDeps) return 4200;
  if ('webpack' in allDeps || 'webpack-dev-server' in allDeps) return 8080;
  if ('parcel' in allDeps) return 1234;
  return 3000;
}

function ScriptsPanel({ rootPath, fileBrowserNodeId }: { rootPath: string; fileBrowserNodeId: string }) {
  const [scripts,  setScripts]  = useState<Record<string, string>>({});
  const [allDeps,  setAllDeps]  = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(true);
  const [running,  setRunning]  = useState<string | null>(null);

  const { addNode, addNodeToGroup } = useCanvasStore();

  useEffect(() => {
    setScripts({});
    const pkgPath = rootPath.replace(/\/$/, '') + '/package.json';
    fetch(`/api/files/read?path=${encodeURIComponent(pkgPath)}`)
      .then(r => r.json())
      .then(({ content, error }) => {
        if (error || !content) return;
        const pkg = JSON.parse(content);
        setScripts(pkg.scripts ?? {});
        setAllDeps({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      })
      .catch(() => {});
  }, [rootPath]);

  if (!Object.keys(scripts).length) return null;

  function runScript(name: string) {
    if (running) return;
    setRunning(name);
    setTimeout(() => setRunning(null), 3000);

    const state  = useCanvasStore.getState();
    const group  = state.groups.find(g => g.nodeIds.includes(fileBrowserNodeId));

    // Position: to the right of the current group's nodes
    let baseX = 80, baseY = 100;
    if (group) {
      const members = group.nodeIds
        .map(id => state.nodes.find(n => n.id === id))
        .filter(Boolean) as CanvasNode[];
      if (members.length) {
        baseX = Math.max(...members.map(n => n.x + n.width)) + 36;
        baseY = Math.min(...members.map(n => n.y));
      }
    }

    const termW = 660, termH = 420;
    const isDev = isDevScript(name);
    const termNode = addNode('terminal', { x: baseX, y: baseY }, {
      title: `npm run ${name}`,
      width: termW, height: termH,
      data: {
        cwd: rootPath,
        status: 'idle',
        autoRun: `npm run ${name}`,
        autoPreview: isDev,  // terminal will auto-create preview once URL is detected
      } as TerminalData,
    });
    if (group) addNodeToGroup(group.id, termNode.id);
  }

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', cursor: 'pointer', userSelect: 'none',
          background: 'rgba(255,255,255,0.02)',
          fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.07em',
          color: 'rgba(255,255,255,0.35)',
        }}
      >
        <span style={{
          fontSize: 7, display: 'inline-block',
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
        }}>▶</span>
        NPM SCRIPTS
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>
          {Object.keys(scripts).length}
        </span>
      </div>

      {expanded && (
        <div data-node-content style={{ maxHeight: 180, overflow: 'auto' }}>
          {Object.entries(scripts).map(([name, cmd]) => {
            const color  = scriptColor(name);
            const icon   = scriptIcon(name);
            const isDev  = isDevScript(name);
            const active = running === name;

            return (
              <div
                key={name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px 4px 10px',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: active ? 'rgba(100,255,150,0.05)' : 'transparent',
                }}
              >
                {/* Run button */}
                <button
                  onClick={() => runScript(name)}
                  disabled={!!running}
                  title={`Executar: ${cmd}`}
                  style={{
                    flexShrink: 0, width: 22, height: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? `rgba(74,222,128,0.15)` : `rgba(255,255,255,0.04)`,
                    border: `1px solid ${active ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.09)'}`,
                    borderRadius: 5, cursor: running ? 'default' : 'pointer',
                    color, fontSize: active ? 12 : 11,
                    transition: 'all 0.15s',
                  }}
                >
                  {active ? '⟳' : icon}
                </button>

                {/* Script name */}
                <span style={{
                  flex: 1, fontSize: 12, fontFamily: 'monospace',
                  color: 'rgba(200,215,240,0.85)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>

                {/* Cmd preview */}
                <span style={{
                  fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.18)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: 90,
                }}>
                  {cmd}
                </span>

                {/* Dev badge */}
                {isDev && (
                  <span style={{
                    flexShrink: 0, fontSize: 9, fontFamily: 'monospace',
                    color: '#4ade80',
                    background: 'rgba(74,222,128,0.1)',
                    border: '1px solid rgba(74,222,128,0.2)',
                    borderRadius: 3, padding: '0 4px',
                  }}>
                    +preview
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
