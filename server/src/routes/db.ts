import express from 'express';
import { resolvePath } from '../utils';

const router = express.Router();

// Database inspection (SQLite) — list tables
router.get('/api/db/tables', (req, res) => {
  const dbPath = resolvePath(req.query.path as string);
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    db.close();
    res.json({ tables: (tables as any[]).map((t: any) => t.name) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Database inspection (SQLite) — run query
router.post('/api/db/query', (req, res) => {
  const { path: dbPath, query } = req.body as { path: string; query: string };
  if (!dbPath || !query) { res.status(400).json({ error: 'missing path or query' }); return; }
  const resolved = resolvePath(dbPath);

  // Basic SQL injection prevention: only allow SELECT statements
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA') && !trimmed.startsWith('EXPLAIN')) {
    res.status(403).json({ error: 'Only SELECT, PRAGMA, and EXPLAIN queries are allowed' }); return;
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(resolved, { readonly: true });
    const stmt = db.prepare(query);
    const rows = stmt.all();
    const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
    db.close();
    res.json({ rows: rows.slice(0, 500), columns, truncated: rows.length > 500 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
