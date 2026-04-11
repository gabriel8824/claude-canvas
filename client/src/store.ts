import { create } from 'zustand';
import { CanvasNode, NodeType, TerminalData, FilesData, PreviewData, GitData, EditorData, DocsData, NotesData, HttpClientData, AiReviewData, ProcessManagerData, DbInspectorData, Group, GroupConnection } from './types';

async function hasObsidianVault(folderPath: string): Promise<boolean> {
  try {
    // Strip trailing slash so path joining is clean
    const clean = folderPath.replace(/\/+$/, '');
    const statPath = clean + '/.obsidian';
    const r = await fetch(`/api/files/stat?path=${encodeURIComponent(statPath)}`);
    const json = await r.json();
    return !!(json.exists && json.isDir);
  } catch {
    return false;
  }
}

let nextZ = 10;
let nodeCounter = 0;
let groupCounter = 0;

function makeNodeId()  { return `node-${++nodeCounter}-${Date.now()}`; }
function makeGroupId() { return `grp-${++groupCounter}-${Date.now()}`; }

type SaveStatus = 'saved' | 'saving' | 'error' | 'idle';

interface HistoryState {
  nodes: CanvasNode[];
  groups: Group[];
}

const MAX_HISTORY = 50;

interface WorkspaceState {
  workspaces: string[];
  activeWorkspace: string;
}

interface CanvasStore {
  nodes: CanvasNode[];
  groups: Group[];
  groupConnections: GroupConnection[];
  canvasOffset: { x: number; y: number };
  zoom: number;
  saveStatus: SaveStatus;
  history: HistoryState[];
  future: HistoryState[];
  canUndo: boolean;
  canRedo: boolean;

  workspaces: string[];
  activeWorkspace: string;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  addNode: (type: NodeType, position?: { x: number; y: number }, overrides?: Partial<CanvasNode>) => CanvasNode;
  removeNode: (id: string) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  updateNodeData: (id: string, patch: Partial<TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData | NotesData | HttpClientData | AiReviewData | ProcessManagerData | DbInspectorData>) => void;
  bringToFront: (id: string) => void;
  toggleMinimize: (id: string) => void;

  setCanvasOffset: (offset: { x: number; y: number }) => void;
  setZoom: (zoom: number) => void;
  setSaveStatus: (status: SaveStatus) => void;

  createGroup: (nodeIds: string[], label: string) => string;
  addNodeToGroup: (groupId: string, nodeId: string) => void;
  removeNodeFromGroup: (groupId: string, nodeId: string) => void;
  removeGroup: (groupId: string) => void;
  updateGroup: (groupId: string, patch: Partial<Pick<Group, 'label' | 'color'>>) => void;
  setNodesPositions: (positions: { id: string; x: number; y: number }[]) => void;

  addGroupConnection: (fromGroupId: string, toGroupId: string) => void;
  removeGroupConnection: (id: string) => void;

  openProject: (folderPath: string) => void;
  hydrate: (state: SerializedState) => void;

  switchWorkspace: (name: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  deleteWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (oldName: string, newName: string) => Promise<void>;
  loadWorkspaceList: () => Promise<void>;
}

export interface SerializedState {
  nodes: CanvasNode[];
  groups: Group[];
  groupConnections?: GroupConnection[];
  canvasOffset: { x: number; y: number };
  zoom: number;
}

const DEFAULT_HOME = '~';
const TITLE_H = 36;

// Returns a Y coordinate that clears all existing nodes, with horizontal padding.
function findFreePosition(nodes: CanvasNode[], newWidth: number): { x: number; y: number } {
  if (nodes.length === 0) return { x: 80, y: 100 };
  const bottom = Math.max(...nodes.map(n => n.y + (n.minimized ? TITLE_H : n.height)));
  const left   = Math.min(...nodes.map(n => n.x));
  // Try to align to the leftmost existing node; fall back to 80
  const x = Math.max(80, Math.min(left, 80));
  return { x, y: bottom + 48 };
}

function defaultData(type: NodeType): TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData | NotesData | HttpClientData | AiReviewData | ProcessManagerData | DbInspectorData {
  switch (type) {
    case 'terminal':         return { cwd: DEFAULT_HOME, status: 'idle' } as TerminalData;
    case 'claude-code':      return { cwd: DEFAULT_HOME, status: 'idle', autoRun: 'claude' } as TerminalData;
    case 'files':            return { currentPath: DEFAULT_HOME, history: [] } as FilesData;
    case 'preview':          return { url: '', inputUrl: 'http://localhost:3000' } as PreviewData;
    case 'git':              return { repoPath: DEFAULT_HOME } as GitData;
    case 'editor':           return { tabs: [], activeTabId: '', openedFromNodeId: undefined } as EditorData;
    case 'docs':             return { rootPath: DEFAULT_HOME, currentFile: '', history: [] } as DocsData;
    case 'notes':            return { content: '', renderMarkdown: false } as NotesData;
    case 'http':             return { url: '', method: 'GET', headers: [], body: '' } as HttpClientData;
    case 'ai-review':        return { filePath: '', code: '', review: '', loading: false, language: '' } as AiReviewData;
    case 'process-manager':  return {} as ProcessManagerData;
    case 'db-inspector':     return { connectionType: 'sqlite', connectionString: '', selectedTable: '', query: 'SELECT * FROM sqlite_master WHERE type="table";' } as DbInspectorData;
  }
}

function defaultSize(type: NodeType): { width: number; height: number } {
  switch (type) {
    case 'terminal':         return { width: 680, height: 480 };
    case 'claude-code':      return { width: 720, height: 520 };
    case 'files':            return { width: 300, height: 480 };
    case 'preview':          return { width: 800, height: 520 };
    case 'git':              return { width: 340, height: 540 };
    case 'editor':           return { width: 720, height: 520 };
    case 'docs':             return { width: 900, height: 600 };
    case 'notes':            return { width: 400, height: 320 };
    case 'http':             return { width: 680, height: 520 };
    case 'ai-review':        return { width: 600, height: 480 };
    case 'process-manager':  return { width: 560, height: 400 };
    case 'db-inspector':     return { width: 720, height: 500 };
  }
}

function defaultTitle(type: NodeType): string {
  switch (type) {
    case 'terminal':         return 'Terminal';
    case 'claude-code':      return 'Claude Code';
    case 'files':            return 'Files';
    case 'preview':          return 'Preview';
    case 'git':              return 'Source Control';
    case 'editor':           return 'Editor';
    case 'docs':             return 'Docs';
    case 'notes':            return 'Notes';
    case 'http':             return 'HTTP Client';
    case 'ai-review':        return 'AI Review';
    case 'process-manager':  return 'Process Manager';
    case 'db-inspector':     return 'DB Inspector';
  }
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  groups: [],
  groupConnections: [],
  canvasOffset: { x: 0, y: 0 },
  zoom: 1,
  saveStatus: 'idle',
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  workspaces: ['default'],
  activeWorkspace: 'default',

  pushHistory() {
    const { nodes, groups, history } = get();
    const snapshot: HistoryState = {
      nodes: nodes.map(n => ({ ...n })),
      groups: groups.map(g => ({ ...g, nodeIds: [...g.nodeIds] })),
    };
    const next = [...history, snapshot].slice(-MAX_HISTORY);
    set({ history: next, future: [], canUndo: next.length > 0, canRedo: false });
  },

  undo() {
    const { history, future, nodes, groups } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const currentSnapshot: HistoryState = {
      nodes: nodes.map(n => ({ ...n })),
      groups: groups.map(g => ({ ...g, nodeIds: [...g.nodeIds] })),
    };
    const newFuture = [currentSnapshot, ...future];
    set({
      nodes: prev.nodes,
      groups: prev.groups,
      history: newHistory,
      future: newFuture,
      canUndo: newHistory.length > 0,
      canRedo: true,
    });
  },

  redo() {
    const { history, future, nodes, groups } = get();
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const currentSnapshot: HistoryState = {
      nodes: nodes.map(n => ({ ...n })),
      groups: groups.map(g => ({ ...g, nodeIds: [...g.nodeIds] })),
    };
    const newHistory = [...history, currentSnapshot].slice(-MAX_HISTORY);
    set({
      nodes: next.nodes,
      groups: next.groups,
      history: newHistory,
      future: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
    });
  },

  addNode(type, position, overrides) {
    const { width, height } = defaultSize(type);
    const free = findFreePosition(get().nodes, width);
    const node: CanvasNode = {
      id: makeNodeId(),
      type,
      title: defaultTitle(type),
      x: position?.x ?? free.x,
      y: position?.y ?? free.y,
      width,
      height,
      zIndex: ++nextZ,
      minimized: false,
      data: defaultData(type),
      ...overrides,
    };
    set(s => ({ nodes: [...s.nodes, node] }));
    return node;
  },

  removeNode(id) {
    set(s => ({
      nodes: s.nodes.filter(n => n.id !== id),
      groups: s.groups
        .map(g => ({ ...g, nodeIds: g.nodeIds.filter(nid => nid !== id) }))
        .filter(g => g.nodeIds.length > 0),
    }));
  },

  updateNode(id, patch) {
    set(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }));
  },

  updateNodeData(id: string, patch: Partial<TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData | NotesData | HttpClientData | AiReviewData | ProcessManagerData | DbInspectorData>) {
    set(s => ({
      nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n),
    }));
  },

  bringToFront(id) {
    const z = ++nextZ;
    set(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, zIndex: z } : n) }));
  },

  toggleMinimize(id) {
    set(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, minimized: !n.minimized } : n) }));
  },

  setCanvasOffset(offset) { set({ canvasOffset: offset }); },
  setZoom(zoom) { set({ zoom }); },
  setSaveStatus(saveStatus) { set({ saveStatus }); },

  createGroup(nodeIds, label) {
    const id = makeGroupId();
    set(s => ({ groups: [...s.groups, { id, label, nodeIds: [...nodeIds] }] }));
    return id;
  },

  addNodeToGroup(groupId, nodeId) {
    set(s => ({
      groups: s.groups.map(g =>
        g.id === groupId && !g.nodeIds.includes(nodeId)
          ? { ...g, nodeIds: [...g.nodeIds, nodeId] }
          : g
      ),
    }));
  },

  removeNodeFromGroup(groupId, nodeId) {
    set(s => ({
      groups: s.groups
        .map(g => g.id === groupId ? { ...g, nodeIds: g.nodeIds.filter(id => id !== nodeId) } : g)
        .filter(g => g.nodeIds.length > 0),
    }));
  },

  addGroupConnection(fromGroupId, toGroupId) {
    // Prevent duplicates
    const exists = get().groupConnections.some(
      c => (c.fromGroupId === fromGroupId && c.toGroupId === toGroupId) ||
           (c.fromGroupId === toGroupId   && c.toGroupId === fromGroupId)
    );
    if (exists) return;
    const id = `gc-${Date.now()}`;
    set(s => ({ groupConnections: [...s.groupConnections, { id, fromGroupId, toGroupId }] }));
  },

  removeGroupConnection(id) {
    set(s => ({ groupConnections: s.groupConnections.filter(c => c.id !== id) }));
  },

  removeGroup(groupId) {
    const group = get().groups.find(g => g.id === groupId);
    if (!group) return;
    set(s => ({
      nodes:  s.nodes.filter(n => !group.nodeIds.includes(n.id)),
      groups: s.groups.filter(g => g.id !== groupId),
      groupConnections: s.groupConnections.filter(
        c => c.fromGroupId !== groupId && c.toGroupId !== groupId
      ),
    }));
  },

  updateGroup(groupId, patch) {
    set(s => ({
      groups: s.groups.map(g => g.id === groupId ? { ...g, ...patch } : g),
    }));
  },

  setNodesPositions(positions) {
    const posMap = new Map(positions.map(p => [p.id, p]));
    set(s => ({
      nodes: s.nodes.map(n => {
        const pos = posMap.get(n.id);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
      }),
    }));
  },

  openProject(folderPath) {
    const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
    // Place below all existing content, never overlapping
    const { x: baseX, y: baseY } = findFreePosition(get().nodes, 300);

    const filesW = 300, termW = 660, gitW = 340, docsW = 900, height = 480, gap = 32;

    const filesNode = get().addNode('files', { x: baseX, y: baseY }, {
      title: name, width: filesW, height,
      data: { currentPath: folderPath, history: [] } as FilesData,
    });
    const termNode = get().addNode('claude-code', { x: baseX + filesW + gap, y: baseY }, {
      title: name, width: termW, height,
      data: { cwd: folderPath, status: 'idle', autoRun: 'claude', linkedFilesNodeId: filesNode.id } as TerminalData,
    });
    const gitNode = get().addNode('git', { x: baseX + filesW + gap + termW + gap, y: baseY }, {
      title: name, width: gitW, height,
      data: { repoPath: folderPath, linkedClaudeNodeId: termNode.id } as GitData,
    });

    const groupId = get().createGroup([filesNode.id, termNode.id, gitNode.id], name);

    // Async: if this project has an Obsidian vault, add a Docs node
    hasObsidianVault(folderPath).then(hasVault => {
      if (!hasVault) return;
      const docsX = baseX + filesW + gap + termW + gap + gitW + gap;
      const docsNode = get().addNode('docs', { x: docsX, y: baseY }, {
        title: `${name} Docs`,
        width: docsW,
        height,
        data: { rootPath: folderPath, currentFile: '', history: [] } as DocsData,
      });
      get().addNodeToGroup(groupId, docsNode.id);
    });
  },

  async loadWorkspaceList() {
    try {
      // Try to get list from server
      const res = await fetch('/api/workspaces');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { workspaces } = await res.json() as { workspaces: string[] };

      if (!workspaces || workspaces.length === 0) {
        // Migration: load old state and save as "default"
        const oldRes = await fetch('/api/state');
        if (oldRes.ok) {
          const { state } = await oldRes.json();
          if (state) {
            await fetch('/api/workspaces/default', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(state),
            });
          }
        }
        set({ workspaces: ['default'], activeWorkspace: 'default' });
        return;
      }

      const active = get().activeWorkspace;
      const resolvedActive = workspaces.includes(active) ? active : workspaces[0];
      set({ workspaces, activeWorkspace: resolvedActive });
    } catch {
      set({ workspaces: ['default'], activeWorkspace: 'default' });
    }
  },

  async switchWorkspace(name: string) {
    const { nodes, groups, canvasOffset, zoom, activeWorkspace } = get();

    // Save current workspace state first
    const currentState: SerializedState = { nodes, groups, canvasOffset, zoom };
    try {
      await fetch(`/api/workspaces/${encodeURIComponent(activeWorkspace)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentState),
      });
    } catch {}

    // Load target workspace
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { state } = await res.json() as { state: SerializedState | null };
      set({ activeWorkspace: name });
      if (state && Array.isArray(state.nodes)) {
        get().hydrate(state);
      } else {
        // Empty workspace
        set({
          nodes: [],
          groups: [],
          canvasOffset: { x: 0, y: 0 },
          zoom: 1,
          history: [],
          future: [],
          canUndo: false,
          canRedo: false,
          saveStatus: 'saved',
        });
      }
    } catch {
      set({ activeWorkspace: name });
    }
  },

  async createWorkspace(name: string) {
    const emptyState: SerializedState = {
      nodes: [],
      groups: [],
      canvasOffset: { x: 0, y: 0 },
      zoom: 1,
    };
    try {
      await fetch(`/api/workspaces/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emptyState),
      });
      const { workspaces } = get();
      if (!workspaces.includes(name)) {
        set({ workspaces: [...workspaces, name] });
      }
      await get().switchWorkspace(name);
    } catch {}
  },

  async deleteWorkspace(name: string) {
    const { workspaces, activeWorkspace } = get();
    if (workspaces.length <= 1) return;

    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) return;
      const next = workspaces.filter(w => w !== name);
      set({ workspaces: next });
      if (activeWorkspace === name) {
        await get().switchWorkspace(next[0]);
      }
    } catch {}
  },

  async renameWorkspace(oldName: string, newName: string) {
    if (!newName.trim() || oldName === newName) return;
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(oldName)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: newName.trim() }),
      });
      if (!res.ok) return;
      const { workspaces, activeWorkspace } = get();
      set({
        workspaces: workspaces.map(w => w === oldName ? newName.trim() : w),
        activeWorkspace: activeWorkspace === oldName ? newName.trim() : activeWorkspace,
      });
    } catch {}
  },

  hydrate(state) {
    // Restore module-level counters from saved data so new IDs don't collide
    const maxNodeNum = state.nodes.reduce((m, n) => {
      const match = n.id.match(/^node-(\d+)-/);
      return match ? Math.max(m, parseInt(match[1], 10)) : m;
    }, 0);
    const maxGroupNum = state.groups.reduce((m, g) => {
      const match = g.id.match(/^grp-(\d+)-/);
      return match ? Math.max(m, parseInt(match[1], 10)) : m;
    }, 0);
    const maxZ = state.nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 10), 10);

    nodeCounter  = maxNodeNum;
    groupCounter = maxGroupNum;
    nextZ        = maxZ;

    set({
      nodes:            state.nodes,
      groups:           state.groups,
      groupConnections: state.groupConnections ?? [],
      canvasOffset:     state.canvasOffset ?? { x: 0, y: 0 },
      zoom:             state.zoom ?? 1,
      saveStatus:       'saved',
    });
  },
}));

// ── Auto-save ────────────────────────────────────────────────────────────────
// pendingSerialized prevents the subscriber from re-entering when setSaveStatus
// fires a store update (which would cancel the debounce timer endlessly).

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: string | null = null;
let pendingSerialized: string | null = null;

function serializeState(state: ReturnType<typeof useCanvasStore.getState>): string {
  return JSON.stringify({
    nodes:            state.nodes,
    groups:           state.groups,
    groupConnections: state.groupConnections,
    canvasOffset:     state.canvasOffset,
    zoom:             state.zoom,
  });
}

const LS_KEY = 'claude-canvas:state';

async function persistNow(serialized: string, workspace: string) {
  // Always keep localStorage in sync as a fallback
  try { localStorage.setItem(LS_KEY, serialized); } catch {}
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    serialized,
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
}

useCanvasStore.subscribe((state) => {
  const serialized = serializeState(state);

  // Skip if nothing changed from last save or from what's already queued
  if (serialized === lastSaved || serialized === pendingSerialized) return;

  pendingSerialized = serialized;
  if (saveTimer) clearTimeout(saveTimer);
  useCanvasStore.getState().setSaveStatus('saving');

  saveTimer = setTimeout(async () => {
    try {
      const workspace = useCanvasStore.getState().activeWorkspace;
      await persistNow(serialized, workspace);
      lastSaved         = serialized;
      pendingSerialized = null;
      useCanvasStore.getState().setSaveStatus('saved');
    } catch {
      pendingSerialized = null;
      useCanvasStore.getState().setSaveStatus('error');
    }
  }, 800);
});

// Flush immediately before the tab closes / reloads so no data is lost
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const storeState = useCanvasStore.getState();
    const serialized = serializeState(storeState);
    if (serialized === lastSaved) return;
    // Save to active workspace via beacon; fall back to legacy endpoint
    const workspace = storeState.activeWorkspace;
    const url = `/api/workspaces/${encodeURIComponent(workspace)}`;
    // keepalive lets the request outlive the page
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
        keepalive: true,
      }).catch(() => {});
    } catch {
      navigator.sendBeacon('/api/state-beacon', serialized);
    }
  });
}
