import { useState, useEffect, useRef } from 'react';
import { Canvas } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { OpenProjectModal } from './components/OpenProjectModal';
import { GitHubModal } from './components/GitHubModal';
import { ToastContainer } from './components/Toast';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { FuzzyFinder } from './components/FuzzyFinder';
import { CommandPalette } from './components/CommandPalette';
import { CanvasTemplates } from './components/CanvasTemplates';
import { SearchModal } from './components/SearchModal';
import { useCanvasStore, SerializedState } from './store';
import { EditorData } from './types';

function getCurrentProjectRoot(): string {
  const state = useCanvasStore.getState();
  for (const node of state.nodes) {
    const d = node.data as any;
    const folder = d?.currentPath ?? d?.cwd ?? d?.repoPath;
    if (folder && folder !== '~') return folder;
  }
  return '~';
}

// ── WorkspaceTabBar ───────────────────────────────────────────────────────────

interface WorkspaceTabBarProps {
  workspaces: string[];
  activeWorkspace: string;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}

function WorkspaceTabBar({
  workspaces,
  activeWorkspace,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: WorkspaceTabBarProps) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Focus inputs when they appear
  useEffect(() => {
    if (creatingNew && newInputRef.current) newInputRef.current.focus();
  }, [creatingNew]);

  useEffect(() => {
    if (renamingTab && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingTab]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    function handler(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  function handleNewKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const name = newName.trim();
      if (name) onCreate(name);
      setCreatingNew(false);
      setNewName('');
    } else if (e.key === 'Escape') {
      setCreatingNew(false);
      setNewName('');
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const name = renameValue.trim();
      if (name && renamingTab) onRename(renamingTab, name);
      setRenamingTab(null);
      setRenameValue('');
    } else if (e.key === 'Escape') {
      setRenamingTab(null);
      setRenameValue('');
    }
  }

  function handleTabContextMenu(e: React.MouseEvent, name: string) {
    e.preventDefault();
    setContextMenu({ name, x: e.clientX, y: e.clientY });
  }

  function handleMenuRename() {
    if (!contextMenu) return;
    setRenamingTab(contextMenu.name);
    setRenameValue(contextMenu.name);
    setContextMenu(null);
  }

  function handleMenuDelete() {
    if (!contextMenu) return;
    onDelete(contextMenu.name);
    setContextMenu(null);
  }

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '0 8px',
        height: '36px',
        background: 'rgba(10,14,32,0.92)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(28px) saturate(200%)',
        WebkitBackdropFilter: 'blur(28px) saturate(200%)',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        userSelect: 'none',
        scrollbarWidth: 'none',
      } as React.CSSProperties}>
        {workspaces.map(name => (
          <div key={name} style={{ position: 'relative', flexShrink: 0 }}>
            {renamingTab === name ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={() => { setRenamingTab(null); setRenameValue(''); }}
                style={{
                  height: '26px',
                  padding: '0 8px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-sans)',
                  background: 'rgba(140,190,255,0.12)',
                  border: '1px solid rgba(140,185,255,0.45)',
                  borderRadius: '6px',
                  color: '#e6edf3',
                  outline: 'none',
                  width: `${Math.max(60, renameValue.length * 8 + 20)}px`,
                }}
              />
            ) : (
              <button
                onClick={() => onSwitch(name)}
                onContextMenu={e => handleTabContextMenu(e, name)}
                style={{
                  height: '26px',
                  padding: '0 12px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-sans)',
                  background: name === activeWorkspace
                    ? 'rgba(140,190,255,0.15)'
                    : 'transparent',
                  border: name === activeWorkspace
                    ? '1px solid rgba(140,185,255,0.35)'
                    : '1px solid transparent',
                  borderRadius: '6px',
                  color: name === activeWorkspace
                    ? 'rgba(140,190,255,0.9)'
                    : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => {
                  if (name !== activeWorkspace) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                    (e.currentTarget as HTMLButtonElement).style.color = '#e6edf3';
                  }
                }}
                onMouseLeave={e => {
                  if (name !== activeWorkspace) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)';
                  }
                }}
              >
                {name}
              </button>
            )}
          </div>
        ))}

        {/* Inline new workspace input */}
        {creatingNew && (
          <input
            ref={newInputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={handleNewKeyDown}
            onBlur={() => { setCreatingNew(false); setNewName(''); }}
            placeholder="workspace name"
            style={{
              height: '26px',
              padding: '0 8px',
              fontSize: '12px',
              fontFamily: 'var(--font-sans)',
              background: 'rgba(140,190,255,0.08)',
              border: '1px solid rgba(140,185,255,0.35)',
              borderRadius: '6px',
              color: '#e6edf3',
              outline: 'none',
              width: '130px',
            }}
          />
        )}

        {/* + button */}
        <button
          onClick={() => setCreatingNew(true)}
          title="New workspace"
          style={{
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            lineHeight: 1,
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: '6px',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)';
            (e.currentTarget as HTMLButtonElement).style.color = '#e6edf3';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)';
          }}
        >
          +
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            background: 'rgba(18,22,40,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            padding: '4px',
            minWidth: '140px',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          } as React.CSSProperties}
        >
          <button
            onClick={handleMenuRename}
            style={ctxItemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Rename
          </button>
          <button
            onClick={handleMenuDelete}
            disabled={workspaces.length <= 1}
            style={{
              ...ctxItemStyle,
              color: workspaces.length <= 1 ? 'rgba(255,255,255,0.2)' : 'rgba(248,113,113,0.85)',
              cursor: workspaces.length <= 1 ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={e => {
              if (workspaces.length > 1) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.1)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
}

const ctxItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '7px 12px',
  fontSize: '13px',
  fontFamily: 'var(--font-sans)',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: '#e6edf3',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.1s',
};

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const {
    addNode, hydrate, nodes,
    workspaces, activeWorkspace,
    loadWorkspaceList, switchWorkspace, createWorkspace, deleteWorkspace, renameWorkspace,
  } = useCanvasStore();
  const [showOpenProject,    setShowOpenProject]    = useState(false);
  const [showGitHub,         setShowGitHub]         = useState(false);
  const [showShortcuts,      setShowShortcuts]      = useState(false);
  const [showFuzzyFinder,    setShowFuzzyFinder]    = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTemplates,      setShowTemplates]      = useState(false);
  const [templatesDismissed, setTemplatesDismissed] = useState(false);
  const [loaded,             setLoaded]             = useState(false);

  useEffect(() => {
    const LS_KEY = 'claude-canvas:state';
    function tryLoadLS() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw) as SerializedState;
        if (state && Array.isArray(state.nodes) && state.nodes.length > 0) {
          hydrate(state);
          return true;
        }
      } catch {}
      return false;
    }

    // Load workspace list first (handles migration from old format)
    loadWorkspaceList().then(async () => {
      const { activeWorkspace: ws } = useCanvasStore.getState();
      try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(ws)}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { state } = await res.json() as { state: SerializedState | null };
        if (state && Array.isArray((state as SerializedState).nodes) && (state as SerializedState).nodes.length > 0) {
          hydrate(state as SerializedState);
        } else if (!tryLoadLS()) {
          setShowTemplates(true);
        }
      } catch {
        if (!tryLoadLS()) {
          setShowTemplates(true);
        }
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setShowShortcuts(s => !s);
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        setShowCommandPalette(false);
        setShowSearch(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowFuzzyFinder(s => !s);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowCommandPalette(s => !s);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setShowSearch(s => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const [showSearch, setShowSearch] = useState(false);

  // Show templates when canvas becomes empty after initial load (and not already dismissed)
  useEffect(() => {
    if (loaded && nodes.length === 0 && !templatesDismissed) {
      setShowTemplates(true);
    }
  }, [loaded, nodes.length, templatesDismissed]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      <Toolbar
        onOpenProject={() => setShowOpenProject(true)}
        onGitHub={() => setShowGitHub(true)}
        onAddGit={() => addNode('git', { x: 120, y: 120 })}
        onShowShortcuts={() => setShowShortcuts(true)}
      />
      <WorkspaceTabBar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        onSwitch={switchWorkspace}
        onCreate={createWorkspace}
        onRename={renameWorkspace}
        onDelete={deleteWorkspace}
      />
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Canvas />
      </div>
      {showOpenProject && <OpenProjectModal onClose={() => setShowOpenProject(false)} />}
      {showGitHub      && <GitHubModal      onClose={() => setShowGitHub(false)} />}
      {showShortcuts   && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showFuzzyFinder && (
        <FuzzyFinder
          rootPath={getCurrentProjectRoot()}
          onSelect={(filePath) => {
            const { addNode } = useCanvasStore.getState();
            const fileName = filePath.split('/').pop() || filePath;
            const tabId = `tab-${Date.now()}`;
            addNode('editor', undefined, {
              title: fileName,
              data: {
                tabs: [{ id: tabId, filePath, isDirty: false }],
                activeTabId: tabId,
              } as unknown as EditorData,
            });
            setShowFuzzyFinder(false);
          }}
          onClose={() => setShowFuzzyFinder(false)}
        />
      )}
      {showCommandPalette && (
        <CommandPalette onClose={() => setShowCommandPalette(false)} />
      )}
      {showSearch && (
        <SearchModal
          rootPath={getCurrentProjectRoot()}
          onOpenFile={(filePath) => {
            const { addNode } = useCanvasStore.getState();
            const fileName = filePath.split('/').pop() || filePath;
            const tabId = `tab-${Date.now()}`;
            addNode('editor', undefined, {
              title: fileName,
              data: {
                tabs: [{ id: tabId, filePath, isDirty: false }],
                activeTabId: tabId,
              } as unknown as EditorData,
            });
            setShowSearch(false);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showTemplates && !templatesDismissed && nodes.length === 0 && (
        <CanvasTemplates onDismiss={() => { setShowTemplates(false); setTemplatesDismissed(true); }} />
      )}
      <ToastContainer />
    </div>
  );
}
