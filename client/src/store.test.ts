import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub browser globals accessed at module load time by the auto-save subscriber
// and the beforeunload listener, before importing the store.
Object.defineProperty(globalThis, 'localStorage', {
  value: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() },
  writable: true,
});
Object.defineProperty(globalThis, 'fetch', {
  value: vi.fn().mockResolvedValue({ ok: true }),
  writable: true,
});

import { useCanvasStore } from './store';

// Initial state snapshot used to reset the store between tests.
const initialState = {
  nodes: [],
  groups: [],
  canvasOffset: { x: 0, y: 0 },
  zoom: 1,
  saveStatus: 'idle' as const,
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
};

beforeEach(() => {
  useCanvasStore.setState(initialState);
  vi.clearAllMocks();
});

describe('addNode', () => {
  it('adds a node to the nodes array', () => {
    useCanvasStore.getState().addNode('terminal');
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });

  it('the added node has the correct type', () => {
    useCanvasStore.getState().addNode('editor');
    const node = useCanvasStore.getState().nodes[0];
    expect(node.type).toBe('editor');
  });

  it('respects an explicit position', () => {
    useCanvasStore.getState().addNode('notes', { x: 200, y: 300 });
    const node = useCanvasStore.getState().nodes[0];
    expect(node.x).toBe(200);
    expect(node.y).toBe(300);
  });

  it('the node has positive width and height', () => {
    useCanvasStore.getState().addNode('preview');
    const node = useCanvasStore.getState().nodes[0];
    expect(node.width).toBeGreaterThan(0);
    expect(node.height).toBeGreaterThan(0);
  });

  it('returns the created node', () => {
    const node = useCanvasStore.getState().addNode('files');
    expect(node).toBeDefined();
    expect(node.type).toBe('files');
    expect(typeof node.id).toBe('string');
  });

  it('applies overrides to the node', () => {
    useCanvasStore.getState().addNode('terminal', undefined, { title: 'My Terminal' });
    const node = useCanvasStore.getState().nodes[0];
    expect(node.title).toBe('My Terminal');
  });
});

describe('removeNode', () => {
  it('removes the node with the given id', () => {
    const node = useCanvasStore.getState().addNode('terminal');
    useCanvasStore.getState().removeNode(node.id);
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });

  it('leaves other nodes intact', () => {
    const a = useCanvasStore.getState().addNode('terminal');
    const b = useCanvasStore.getState().addNode('files');
    useCanvasStore.getState().removeNode(a.id);
    const ids = useCanvasStore.getState().nodes.map(n => n.id);
    expect(ids).not.toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('does nothing when given an unknown id', () => {
    useCanvasStore.getState().addNode('notes');
    useCanvasStore.getState().removeNode('non-existent-id');
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });
});

describe('undo / redo', () => {
  it('canUndo is false initially', () => {
    expect(useCanvasStore.getState().canUndo).toBe(false);
  });

  it('canRedo is false initially', () => {
    expect(useCanvasStore.getState().canRedo).toBe(false);
  });

  it('pushHistory sets canUndo to true', () => {
    useCanvasStore.getState().addNode('terminal');
    useCanvasStore.getState().pushHistory();
    expect(useCanvasStore.getState().canUndo).toBe(true);
  });

  it('undo reverts to the previous nodes snapshot', () => {
    // Push history with empty nodes, then add a node, then undo.
    useCanvasStore.getState().pushHistory(); // snapshot: []
    useCanvasStore.getState().addNode('git');
    expect(useCanvasStore.getState().nodes).toHaveLength(1);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });

  it('undo sets canRedo to true', () => {
    useCanvasStore.getState().pushHistory();
    useCanvasStore.getState().addNode('git');
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().canRedo).toBe(true);
  });

  it('redo re-applies the undone state', () => {
    useCanvasStore.getState().pushHistory(); // snapshot: []
    useCanvasStore.getState().addNode('terminal');
    useCanvasStore.getState().undo();
    // Now nodes is [] again; redo should bring the terminal back.
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });

  it('redo sets canRedo to false when future is exhausted', () => {
    useCanvasStore.getState().pushHistory();
    useCanvasStore.getState().addNode('notes');
    useCanvasStore.getState().undo();
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().canRedo).toBe(false);
  });

  it('pushHistory clears the future (redo) stack', () => {
    useCanvasStore.getState().pushHistory();
    useCanvasStore.getState().addNode('preview');
    useCanvasStore.getState().undo();
    // Now there is something in future. Push new history — future must clear.
    useCanvasStore.getState().pushHistory();
    expect(useCanvasStore.getState().canRedo).toBe(false);
  });

  it('undo does nothing when history is empty', () => {
    useCanvasStore.getState().addNode('terminal');
    const before = useCanvasStore.getState().nodes.length;
    useCanvasStore.getState().undo(); // no-op
    expect(useCanvasStore.getState().nodes).toHaveLength(before);
  });

  it('redo does nothing when future is empty', () => {
    useCanvasStore.getState().addNode('terminal');
    const before = useCanvasStore.getState().nodes.length;
    useCanvasStore.getState().redo(); // no-op
    expect(useCanvasStore.getState().nodes).toHaveLength(before);
  });
});
