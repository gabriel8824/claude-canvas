import { useState, useEffect } from 'react';
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

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const {
    addNode, hydrate, nodes,
    activeWorkspace,
    loadWorkspaceList,
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
      {/* Drag region: macOS=traffic lights safe zone, Windows=titlebar drag area */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        WebkitAppRegion: 'drag',
        zIndex: 9999,
        pointerEvents: 'auto',
      } as React.CSSProperties} />
      <Toolbar
        onOpenProject={() => setShowOpenProject(true)}
        onGitHub={() => setShowGitHub(true)}
        onAddGit={() => addNode('git', { x: 120, y: 120 })}
        onShowShortcuts={() => setShowShortcuts(true)}
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
