// Store simples para toggle do personagem Claude (persiste em localStorage)

const KEY = 'cc-show-character';

function load(): boolean {
  try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; }
}
function save(v: boolean) {
  try { localStorage.setItem(KEY, v ? 'true' : 'false'); } catch {}
}

let visible = load();
const listeners = new Set<() => void>();
function notify() { listeners.forEach(l => l()); }

export function isCharacterVisible(): boolean { return visible; }

export function toggleCharacter() {
  visible = !visible;
  save(visible);
  notify();
}

export function subscribeCharacter(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getCharacterSnapshot(): boolean { return visible; }
