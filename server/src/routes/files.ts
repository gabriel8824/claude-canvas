import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { listDir, readFile, toUnix } from '../files';
import { resolvePath } from '../utils';

const router = express.Router();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__', '.cache']);
const WIKI_LINK = /\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g;

// ─── Shared recursive walker ───────────────────────────────────────────────────

interface WalkOptions {
  /** Return true to include a file, false to skip */
  fileFilter?: (entry: fs.Dirent) => boolean;
  /** Return true to skip a directory */
  dirSkip?: (name: string) => boolean;
  /** Return true to skip a file/dir by name (dotfiles etc.) */
  nameSkip?: (name: string) => boolean;
  /** Stop walking when this returns true */
  done?: () => boolean;
  maxDepth?: number;
}

function walkDir(
  dir: string,
  onFile: (full: string, entry: fs.Dirent) => void,
  opts: WalkOptions = {},
  depth = 0
): void {
  if (opts.done?.()) return;
  if (opts.maxDepth !== undefined && depth > opts.maxDepth) return;

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const e of entries) {
    if (opts.done?.()) return;
    if (opts.nameSkip?.(e.name)) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (opts.dirSkip?.(e.name)) continue;
      walkDir(path.join(dir, e.name), onFile, opts, depth + 1);
    } else if (e.isFile()) {
      if (!opts.fileFilter || opts.fileFilter(e)) {
        onFile(path.join(dir, e.name), e);
      }
    }
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/api/files', (req, res) => {
  res.json({ items: listDir((req.query.path as string) || '~') });
});

router.get('/api/files/read', (req, res) => {
  res.json(readFile((req.query.path as string) || ''));
});

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

router.get('/api/files/stat', (req, res) => {
  try {
    const stat = fs.statSync(resolvePath(req.query.path as string));
    res.json({ exists: true, isDir: stat.isDirectory() });
  } catch {
    res.json({ exists: false, isDir: false });
  }
});

router.post('/api/files/create', (req, res) => {
  const { path: p, type } = req.body as { path: string; type: 'file' | 'dir' };
  if (!p) { res.status(400).json({ error: 'missing path' }); return; }
  const fullPath = resolvePath(p);
  try {
    if (type === 'dir') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (fs.existsSync(fullPath)) { res.status(400).json({ error: 'Arquivo já existe' }); return; }
      fs.writeFileSync(fullPath, '', 'utf-8');
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/files/rename', (req, res) => {
  const { oldPath, newPath } = req.body as { oldPath: string; newPath: string };
  if (!oldPath || !newPath) { res.status(400).json({ error: 'missing oldPath or newPath' }); return; }
  try {
    fs.renameSync(resolvePath(oldPath), resolvePath(newPath));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/files/delete', (req, res) => {
  const p = (req.query.path as string) || '';
  if (!p) { res.status(400).json({ error: 'missing path' }); return; }
  const fullPath = resolvePath(p);
  const homeDir = os.homedir();
  const isRoot = fullPath === '/' || /^[A-Za-z]:[\\\/]?$/.test(fullPath);
  if (fullPath === homeDir || isRoot || fullPath.length < 4) {
    res.status(403).json({ error: 'Operação não permitida neste caminho' }); return;
  }
  try {
    fs.rmSync(fullPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fuzzy finder: all files recursively
router.get('/api/files/list-all', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const MAX = 5000;
  const results: { name: string; path: string; rel: string }[] = [];

  walkDir(root, (full, e) => {
    results.push({ name: e.name, path: toUnix(full), rel: toUnix(path.relative(root, full)) });
  }, {
    nameSkip: (n) => n.startsWith('.') && n !== '.env',
    done: () => results.length >= MAX,
  });

  res.json({ files: results });
});

// List all markdown files
router.get('/api/docs/list', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const results: { path: string; name: string; rel: string }[] = [];

  walkDir(root, (full, e) => {
    results.push({ path: toUnix(full), name: e.name, rel: toUnix(path.relative(root, full)) });
  }, {
    fileFilter: (e) => /\.(md|mdx)$/i.test(e.name),
    nameSkip: (n) => n.startsWith('.'),
  });

  res.json({ files: results });
});

// Graph view: nodes + wiki-link edges for all .md files
router.get('/api/docs/graph', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const mdFiles: { id: string; name: string }[] = [];

  walkDir(root, (full, e) => {
    mdFiles.push({ id: toUnix(full), name: e.name.replace(/\.mdx?$/i, '') });
  }, {
    fileFilter: (e) => /\.(md|mdx)$/i.test(e.name),
    nameSkip: (n) => n.startsWith('.'),
  });

  const nameMap = new Map<string, string>(mdFiles.map(f => [f.name.toLowerCase(), f.id]));
  const linkSet = new Set<string>();
  const links: { source: string; target: string }[] = [];

  for (const f of mdFiles) {
    let content = '';
    try { content = fs.readFileSync(f.id, 'utf-8').slice(0, 50_000); } catch { continue; }
    WIKI_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK.exec(content)) !== null) {
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
  const query = ((req.query.q as string) || '').toLowerCase().trim();
  if (!query) { res.json({ results: [] }); return; }

  const results: { file: string; name: string; rel: string; snippet: string; line: number }[] = [];

  walkDir(root, (full, e) => {
    let content = '';
    try { content = fs.readFileSync(full, 'utf-8'); } catch { return; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < 50; i++) {
      if (lines[i].toLowerCase().includes(query)) {
        const snippet = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join('\n');
        results.push({ file: toUnix(full), name: e.name, rel: toUnix(path.relative(root, full)), snippet, line: i + 1 });
      }
    }
  }, {
    fileFilter: (e) => /\.(md|mdx)$/i.test(e.name),
    nameSkip: (n) => n.startsWith('.'),
    done: () => results.length >= 50,
  });

  res.json({ results });
});

// Backlinks: find all .md files that link to a given file
router.get('/api/docs/backlinks', (req, res) => {
  const root = resolvePath(req.query.rootPath as string);
  const targetFile = req.query.file as string;
  if (!targetFile) { res.json({ backlinks: [] }); return; }

  const targetName = path.basename(targetFile, path.extname(targetFile)).toLowerCase();
  const backlinks: { file: string; name: string; rel: string }[] = [];

  walkDir(root, (full, e) => {
    if (toUnix(full) === targetFile) return;
    let content = '';
    try { content = fs.readFileSync(full, 'utf-8').slice(0, 50_000); } catch { return; }
    WIKI_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK.exec(content)) !== null) {
      if (m[1].trim().toLowerCase() === targetName) {
        backlinks.push({ file: toUnix(full), name: e.name, rel: toUnix(path.relative(root, full)) });
        break;
      }
    }
  }, {
    fileFilter: (e) => /\.(md|mdx)$/i.test(e.name),
    nameSkip: (n) => n.startsWith('.'),
  });

  res.json({ backlinks });
});

export default router;
