import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const DB_PATH = path.join(os.homedir(), '.claude-canvas.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_state (
        id      INTEGER PRIMARY KEY CHECK(id = 1),
        payload TEXT    NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }
  return db;
}

export function loadState(): object | null {
  try {
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
  getDb()
    .prepare(`
      INSERT INTO canvas_state (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload    = excluded.payload,
        updated_at = excluded.updated_at
    `)
    .run(JSON.stringify(state), Date.now());
}
