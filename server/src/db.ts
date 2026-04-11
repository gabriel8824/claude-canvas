import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(os.homedir(), '.claude-canvas.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_state (
        id      INTEGER PRIMARY KEY CHECK(id = 1),
        payload TEXT    NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        name       TEXT PRIMARY KEY,
        state      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
  return db;
}

export function loadState(): object | null {
  // Backward compat: load from "default" workspace first, fall back to legacy table
  try {
    const ws = loadWorkspace('default');
    if (ws) return ws;
    const row = getDb()
      .prepare('SELECT payload FROM canvas_state WHERE id = 1')
      .get() as { payload: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export function saveState(state: object): void {
  saveWorkspace('default', state);
}

// ── Workspace functions ───────────────────────────────────────────────────────

export function listWorkspaces(): string[] {
  try {
    const rows = getDb()
      .prepare('SELECT name FROM workspaces ORDER BY updated_at ASC')
      .all() as { name: string }[];
    return rows.map(r => r.name);
  } catch {
    return [];
  }
}

export function loadWorkspace(name: string): any {
  try {
    const row = getDb()
      .prepare('SELECT state FROM workspaces WHERE name = ?')
      .get(name) as { state: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.state);
  } catch {
    return null;
  }
}

export function saveWorkspace(name: string, state: any): void {
  getDb()
    .prepare(`
      INSERT INTO workspaces (name, state, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        state      = excluded.state,
        updated_at = excluded.updated_at
    `)
    .run(name, JSON.stringify(state), Date.now());
}

export function deleteWorkspace(name: string): void {
  getDb()
    .prepare('DELETE FROM workspaces WHERE name = ?')
    .run(name);
}

export function renameWorkspace(oldName: string, newName: string): void {
  const row = getDb()
    .prepare('SELECT state, updated_at FROM workspaces WHERE name = ?')
    .get(oldName) as { state: string; updated_at: number } | undefined;
  if (!row) throw new Error(`Workspace "${oldName}" not found`);

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO workspaces (name, state, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      state      = excluded.state,
      updated_at = excluded.updated_at
  `);
  const del = db.prepare('DELETE FROM workspaces WHERE name = ?');

  const tx = db.transaction(() => {
    insert.run(newName, row.state, row.updated_at);
    del.run(oldName);
  });
  tx();
}
