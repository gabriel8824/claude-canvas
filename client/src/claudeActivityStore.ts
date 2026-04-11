// Store mínimo para compartilhar atividade do Claude Code entre ClaudeCodeNode e Canvas.
// Usa useSyncExternalStore — sem Zustand extra, sem props drilling.

export type ActivityKind = 'idle' | 'thinking' | 'tool' | 'agent' | 'done' | 'error';

export interface ClaudeActivity {
  kind: ActivityKind;
  label: string;
  tool?: string;
  agents: number;
}

const state = new Map<string, ClaudeActivity>();
const listeners = new Set<() => void>();

let snap = new Map<string, ClaudeActivity>();

function notify() {
  snap = new Map(state);
  listeners.forEach(l => l());
}

export function setClaudeActivity(nodeId: string, activity: ClaudeActivity) {
  const prev = state.get(nodeId);
  if (prev?.kind === activity.kind && prev?.agents === activity.agents && prev?.tool === activity.tool) return;
  state.set(nodeId, activity);
  notify();
}

export function clearClaudeActivity(nodeId: string) {
  if (!state.has(nodeId)) return;
  state.delete(nodeId);
  notify();
}

export function subscribeClaudeActivity(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getClaudeActivitySnapshot(): Map<string, ClaudeActivity> {
  return snap;
}
