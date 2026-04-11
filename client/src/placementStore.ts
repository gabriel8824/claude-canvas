// Store para modo de "arrastar para posicionar" nodes no canvas.
// Toolbar chama startPlacement() → Canvas mostra ghost → clique coloca o node.

import { NodeType } from './types';

export interface PendingPlacement {
  type: NodeType;
  label: string;
  icon: string;
  extra?: Record<string, unknown>; // dados extras (ex: cwd)
}

let pending: PendingPlacement | null = null;
const listeners = new Set<() => void>();

function notify() { listeners.forEach(l => l()); }

export function startPlacement(p: PendingPlacement) { pending = p; notify(); }
export function clearPlacement()                     { pending = null; notify(); }

export function subscribePlacement(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPlacementSnapshot(): PendingPlacement | null { return pending; }
