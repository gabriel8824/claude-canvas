import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { listDir, readFile, toUnix } from '../files';
import { resolvePath } from '../utils';

const router = express.Router();

// List directory
router.get('/api/files', (req, res) => {
  const dir = (req.query.path as string) || '~';
  res.json({ items: listDir(dir) });
});

// Read file
router.get('/api/files/read', (req, res) => {
  const filePath = (req.query.path as string) || '';
  res.json(readFile(filePath));
});

// Write file
router.post('/api/files/write', (req, res) => {
  const { path: p, content } = req.body as { path: string; content: string };
  if (!p || typeof content !== 'string') { res.status(400).json({ error: 'missing path or content' }); return; }
  try {
    fs.writeFileSync(resolvePath(p), content, 'utf-8');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stat file/dir
router.get('/api/files/stat', (req, res) => {
  const p = resolvePath(req.query.path as string);
  try {
    const stat = fs.statSync(p);
    res.json({ exists: true, isDir: stat.isDirectory() });
  } catch {
    res.json({ exists: false, isDir: false });
  }
});

// Create file or directory
router.post('/api/files/create', (req, res) => {
  const { path: p, type } = req.body as { path: string; type: 'file' | 'dir' };
  if (!p) { res.status(400).json({ error: 'missing path' }); return; }
  const fullPath = resolvePath(p);
  try {
    if (type === 'dir') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, '', 'utf-8');
      } else {
        res.status(400).json({ error: 'Arquivo já existe' }); return;
      }
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rename file or directory
router.post('/api/files/rename', (req, res) => {
  const { oldPath, newPath } = req.body as { oldPath: string; newPath: string };
  if (!oldPath || !newPath) { res.status(400).json({ error: 'missing oldPath or newPath' }); return; }
  try {
    const resolvedOld = resolvePath(oldPath);
    const resolvedNew = resolvePath(newPath);
    fs.renameSync(resolvedOld, resolvedNew);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file or directory (recursive)
router.delete('/api/files/delete', (req, res) => {
  const p = (req.query.path as string) || '';
  if (!p) { res.status(400).json({ error: 'missing path' }); return; }
  const fullPath = resolvePath(p);
  try {
    const homeDir = os.homedir();
    // Protect home dir, Unix root (/), Windows drive roots (C:\ or C:/), and suspiciously short paths
    const isRoot = fullPath === '/' || /^[A-Za-z]:[\\\/]?$/.test(fullPath);
    if (fullPath === homeDir || isRoot || fullPath.length < 4) {
      res.status(403).json({ error: 'Operação não permitida neste caminho' }); return;
    }
    fs.rmSync(fullPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List all files recursively (for fuzzy finder)
router.get('/api/files/list-all', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__', '.cache']);
  const results: { name: string; path: string; rel: string }[] = [];
  let count = 0;
  const MAX_FILES = 5000;

  function walk(dir: string) {
    if (count >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (count >= MAX_FILES) return;
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        results.push({
          name: e.name,
          path: toUnix(full),
          rel: toUnix(path.relative(root, full)),
        });
        count++;
      }
    }
  }

  try { walk(root); } catch {}
  res.json({ files: results });
});

// List all markdown files recursively
router.get('/api/docs/list', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const results: { path: string; name: string; rel: string }[] = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__']);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (e.isFile() && /\.(md|mdx)$/i.test(e.name)) {
        results.push({ path: toUnix(full), name: e.name, rel: toUnix(path.relative(root, full)) });
      }
    }
  }

  try { walk(root); } catch {}
  res.json({ files: results });
});

// Graph view: nodes + wiki-link edges for all .md files
router.get('/api/docs/graph', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__']);
  const mdFiles: { id: string; name: string }[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.(md|mdx)$/i.test(e.name))
        mdFiles.push({ id: toUnix(full), name: e.name.replace(/\.mdx?$/i, '') });
    }
  }
  walk(root);

  const nameMap = new Map<string, string>();
  for (const f of mdFiles) nameMap.set(f.name.toLowerCase(), f.id);

  const WIKI = /\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g;
  const linkSet = new Set<string>();
  const links: { source: string; target: string }[] = [];

  for (const f of mdFiles) {
    let content = '';
    try { content = fs.readFileSync(f.id, 'utf-8').slice(0, 50_000); } catch { continue; }
    WIKI.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI.exec(content)) !== null) {
      const target = nameMap.get(m[1].trim().toLowerCase());
      if (target && target !== f.id) {
        const key = f.id < target ? `${f.id}→${target}` : `${target}→${f.id}`;
        if (!linkSet.has(key)) { linkSet.add(key); links.push({ source: f.id, target }); }
      }
    }
  }

  res.json({ nodes: mdFiles, links });
});

// Full-text search in markdown files
router.get('/api/docs/search', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const query = (req.query.q as string || '').toLowerCase().trim();
  if (!query) { res.json({ results: [] }); return; }

  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__']);
  const results: { file: string; name: string; rel: string; snippet: string; line: number }[] = [];

  function walk(dir: string) {
    if (results.length >= 50) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= 50) return;
      if (e.name.startsWith('.')) continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.(md|mdx)$/i.test(e.name)) {
        let content = '';
        try { content = fs.readFileSync(full, 'utf-8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            const snippetStart = Math.max(0, i - 1);
            const snippetEnd = Math.min(lines.length, i + 2);
            const snippet = lines.slice(snippetStart, snippetEnd).join('\n');
            results.push({
              file: toUnix(full),
              name: e.name,
              rel: toUnix(path.relative(root, full)),
              snippet,
              line: i + 1,
            });
            if (results.length >= 50) break;
          }
        }
      }
    }
  }

  walk(root);
  res.json({ results });
});

// Backlinks: find all .md files that link to a given file
router.get('/api/docs/backlinks', (req, res) => {
  const root = resolvePath(req.query.rootPath as string);
  const targetFile = req.query.file as string;
  if (!targetFile) { res.json({ backlinks: [] }); return; }

  const targetName = path.basename(targetFile, path.extname(targetFile)).toLowerCase();
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__']);
  const WIKI = /\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g;
  const backlinks: { file: string; name: string; rel: string }[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.(md|mdx)$/i.test(e.name) && toUnix(full) !== targetFile) {
        let content = '';
        try { content = fs.readFileSync(full, 'utf-8').slice(0, 50_000); } catch { continue; }
        WIKI.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WIKI.exec(content)) !== null) {
          if (m[1].trim().toLowerCase() === targetName) {
            backlinks.push({ file: toUnix(full), name: e.name, rel: toUnix(path.relative(root, full)) });
            break;
          }
        }
      }
    }
  }

  walk(root);
  res.json({ backlinks });
});

export default router;
