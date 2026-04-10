import { create } from 'zustand';
import { CanvasNode, NodeType, TerminalData, FilesData, PreviewData, GitData, EditorData, DocsData, Group } from './types';

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

interface CanvasStore {
  nodes: CanvasNode[];
  groups: Group[];
  canvasOffset: { x: number; y: number };
  zoom: number;
  saveStatus: SaveStatus;

  addNode: (type: NodeType, position?: { x: number; y: number }, overrides?: Partial<CanvasNode>) => CanvasNode;
  removeNode: (id: string) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  updateNodeData: (id: string, patch: Partial<TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData>) => void;
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

  openProject: (folderPath: string) => void;
  hydrate: (state: SerializedState) => void;
}

export interface SerializedState {
  nodes: CanvasNode[];
  groups: Group[];
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

function defaultData(type: NodeType): TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData {
  switch (type) {
    case 'terminal': return { cwd: DEFAULT_HOME, status: 'idle' } as TerminalData;
    case 'files':    return { currentPath: DEFAULT_HOME, history: [] } as FilesData;
    case 'preview':  return { url: '', inputUrl: 'http://localhost:3000' } as PreviewData;
    case 'git':      return { repoPath: DEFAULT_HOME } as GitData;
    case 'editor':   return { filePath: '', isDirty: false } as EditorData;
    case 'docs':     return { rootPath: DEFAULT_HOME, currentFile: '', history: [] } as DocsData;
  }
}

function defaultSize(type: NodeType): { width: number; height: number } {
  switch (type) {
    case 'terminal': return { width: 680, height: 480 };
    case 'files':    return { width: 300, height: 480 };
    case 'preview':  return { width: 800, height: 520 };
    case 'git':      return { width: 340, height: 540 };
    case 'editor':   return { width: 720, height: 520 };
    case 'docs':     return { width: 900, height: 600 };
  }
}

function defaultTitle(type: NodeType): string {
  switch (type) {
    case 'terminal': return 'Terminal';
    case 'files':    return 'Files';
    case 'preview':  return 'Preview';
    case 'git':      return 'Source Control';
    case 'editor':   return 'Editor';
    case 'docs':     return 'Docs';
  }
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  groups: [],
  canvasOffset: { x: 0, y: 0 },
  zoom: 1,
  saveStatus: 'idle',

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

  updateNodeData(id, patch) {
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

  removeGroup(groupId) {
    const group = get().groups.find(g => g.id === groupId);
    if (!group) return;
    set(s => ({
      nodes:  s.nodes.filter(n => !group.nodeIds.includes(n.id)),
      groups: s.groups.filter(g => g.id !== groupId),
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
    const termNode = get().addNode('terminal', { x: baseX + filesW + gap, y: baseY }, {
      title: name, width: termW, height,
      data: { cwd: folderPath, status: 'idle' } as TerminalData,
    });
    const gitNode = get().addNode('git', { x: baseX + filesW + gap + termW + gap, y: baseY }, {
      title: name, width: gitW, height,
      data: { repoPath: folderPath } as GitData,
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
      nodes:        state.nodes,
      groups:       state.groups,
      canvasOffset: state.canvasOffset ?? { x: 0, y: 0 },
      zoom:         state.zoom ?? 1,
      saveStatus:   'saved',
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
    nodes:        state.nodes,
    groups:       state.groups,
    canvasOffset: state.canvasOffset,
    zoom:         state.zoom,
  });
}

const LS_KEY = 'claude-canvas:state';

async function persistNow(serialized: string) {
  // Always keep localStorage in sync as a fallback
  try { localStorage.setItem(LS_KEY, serialized); } catch {}
  const res = await fetch('/api/state', {
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
      await persistNow(serialized);
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
    const serialized = serializeState(useCanvasStore.getState());
    if (serialized === lastSaved) return;
    // keepalive lets the request outlive the page
    navigator.sendBeacon('/api/state-beacon', serialized);
  });
}
