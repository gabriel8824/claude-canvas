import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import { spawn, exec } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { TerminalManager } from './terminal';
import { listDir, readFile } from './files';
import { loadState, saveState } from './db';

const PORT = Number(process.env.PORT || 3001);

const app = express();
app.use(cors());
app.use(express.json());

// Serve client build
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// REST: file listing
app.get('/api/files', (req, res) => {
  const dir = (req.query.path as string) || '~';
  res.json({ items: listDir(dir) });
});

app.get('/api/files/read', (req, res) => {
  const filePath = (req.query.path as string) || '';
  res.json(readFile(filePath));
});

app.post('/api/files/write', (req, res) => {
  const { path: p, content } = req.body as { path: string; content: string };
  if (!p || typeof content !== 'string') { res.status(400).json({ error: 'missing path or content' }); return; }
  const expanded = p.startsWith('~/') ? p.replace('~', os.homedir()) : p;
  try {
    fs.writeFileSync(expanded, content, 'utf-8');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List all markdown files recursively under a root path
app.get('/api/docs/list', (req, res) => {
  let root = (req.query.path as string) || '~';
  if (!root || root === '~') root = os.homedir();
  if (root.startsWith('~/')) root = root.replace('~', os.homedir());

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
        results.push({ path: full, name: e.name, rel: path.relative(root, full) });
      }
    }
  }

  try { walk(root); } catch {}
  res.json({ files: results });
});

// Graph view: returns nodes + wiki-link edges for all .md files under a root
app.get('/api/docs/graph', (req, res) => {
  let root = (req.query.path as string) || '~';
  if (!root || root === '~') root = os.homedir();
  if (root.startsWith('~/')) root = root.replace('~', os.homedir());

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
        mdFiles.push({ id: full, name: e.name.replace(/\.mdx?$/i, '') });
    }
  }
  walk(root);

  // name (lowercase) → file id for wiki-link resolution
  const nameMap = new Map<string, string>();
  for (const f of mdFiles) nameMap.set(f.name.toLowerCase(), f.id);

  // Parse [[wiki links]] from each file
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

app.get('/api/files/stat', (req, res) => {
  let p = (req.query.path as string) || '';
  if (!p || p === '~') p = os.homedir();
  if (p.startsWith('~/')) p = p.replace('~', os.homedir());
  try {
    const stat = fs.statSync(p);
    res.json({ exists: true, isDir: stat.isDirectory() });
  } catch {
    res.json({ exists: false, isDir: false });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const termManager = new TerminalManager();

type Msg = Record<string, any>;

function send(ws: WebSocket, msg: Msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws) => {
  const clientTerminals = new Set<string>();

  ws.on('message', (raw) => {
    let msg: Msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'terminal:create': {
        const { id, cwd, cols, rows } = msg;
        clientTerminals.add(id);
        termManager.create(
          id,
          cwd || '~',
          cols || 80,
          rows || 24,
          (data) => send(ws, { type: 'terminal:output', id, data }),
          (code) => send(ws, { type: 'terminal:exit', id, code })
        );
        send(ws, { type: 'terminal:ready', id });
        break;
      }

      case 'terminal:input': {
        termManager.write(msg.id, msg.data);
        break;
      }

      case 'terminal:resize': {
        termManager.resize(msg.id, msg.cols, msg.rows);
        break;
      }

      case 'terminal:kill': {
        termManager.kill(msg.id);
        clientTerminals.delete(msg.id);
        break;
      }

      case 'files:list': {
        const items = listDir(msg.path || '~');
        send(ws, { type: 'files:list', reqId: msg.reqId, path: msg.path, items });
        break;
      }

      case 'files:read': {
        const result = readFile(msg.path);
        send(ws, { type: 'files:read', reqId: msg.reqId, path: msg.path, ...result });
        break;
      }

      case 'git:status': {
        const { reqId, path: p } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        exec(`git -C "${cwd}" status --porcelain=v1 -b`, (err, stdout, stderr) => {
          if (err) {
            send(ws, { type: 'git:status', reqId, raw: '', error: stderr.trim() || err.message });
          } else {
            send(ws, { type: 'git:status', reqId, raw: stdout, error: null });
          }
        });
        break;
      }

      case 'git:add': {
        const { reqId, path: p, file } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        const args = file === '.' ? ['-C', cwd, 'add', '.'] : ['-C', cwd, 'add', '--', file as string];
        const proc = spawn('git', args);
        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => send(ws, { type: 'git:add', reqId, error: code !== 0 ? stderr : null }));
        break;
      }

      case 'git:restore': {
        const { reqId, path: p, file, staged } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        const args = staged
          ? ['-C', cwd, 'restore', '--staged', '--', file as string]
          : ['-C', cwd, 'restore', '--', file as string];
        const proc = spawn('git', args);
        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => send(ws, { type: 'git:restore', reqId, error: code !== 0 ? stderr : null }));
        break;
      }

      case 'git:commit': {
        const { reqId, path: p, message } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        const proc = spawn('git', ['-C', cwd, 'commit', '-m', message as string]);
        let out = '', err = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
        proc.on('close', (code) => send(ws, { type: 'git:commit', reqId, output: out, error: code !== 0 ? err : null }));
        break;
      }

      case 'git:push':
      case 'git:pull': {
        const op = msg.type === 'git:push' ? 'push' : 'pull';
        const { reqId, path: p } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        const proc = spawn('git', ['-C', cwd, op], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        const fwd = (d: Buffer) => send(ws, { type: `git:${op}:output`, reqId, data: d.toString() });
        proc.stdout.on('data', fwd);
        proc.stderr.on('data', fwd);
        proc.on('close', (code) => send(ws, { type: `git:${op}:done`, reqId, code }));
        break;
      }

      case 'git:log': {
        const { reqId, path: p } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        exec(`git -C "${cwd}" log --oneline --decorate -20`, (err, stdout, stderr) => {
          if (err) {
            send(ws, { type: 'git:log', reqId, output: '', error: stderr.trim() || err.message });
          } else {
            send(ws, { type: 'git:log', reqId, output: stdout, error: null });
          }
        });
        break;
      }

      case 'files:write': {
        const { reqId, path: p, content } = msg;
        const expanded = (p as string).replace(/^~/, os.homedir());
        try {
          fs.writeFileSync(expanded, content as string, 'utf-8');
          send(ws, { type: 'files:write', reqId, error: null });
        } catch (err: any) {
          send(ws, { type: 'files:write', reqId, error: err.message });
        }
        break;
      }

      case 'git:init': {
        const { reqId, path: p } = msg;
        const cwd = (p as string).replace(/^~/, os.homedir());
        exec(`git -C "${cwd}" init`, (err, stdout, stderr) => {
          send(ws, { type: 'git:init', reqId, output: stdout, error: err ? (stderr.trim() || err.message) : null });
        });
        break;
      }

      case 'git:clone': {
        const { reqId, url, targetDir } = msg;
        if (!url || typeof url !== 'string') {
          send(ws, { type: 'git:clone:error', reqId, message: 'URL inválida' });
          break;
        }
        // Expand ~ and ensure parent dir exists
        const expanded = (targetDir as string).replace(/^~/, os.homedir());
        const parent = path.dirname(expanded);
        try { fs.mkdirSync(parent, { recursive: true }); } catch {}

        const proc = spawn('git', ['clone', '--progress', url, expanded], {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        const fwd = (d: Buffer) => send(ws, { type: 'git:clone:output', reqId, data: d.toString() });
        proc.stdout.on('data', fwd);
        proc.stderr.on('data', fwd);
        proc.on('error', (err) => send(ws, { type: 'git:clone:error', reqId, message: err.message }));
        proc.on('close', (code) => {
          if (code === 0) send(ws, { type: 'git:clone:done',  reqId, targetDir: expanded });
          else             send(ws, { type: 'git:clone:error', reqId, message: `git clone saiu com código ${code}` });
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const id of clientTerminals) termManager.kill(id);
  });
});

// Native folder picker (macOS)
app.get('/api/pick-folder', (_req, res) => {
  exec(
    `osascript -e 'tell app "Finder" to POSIX path of (choose folder with prompt "Selecione uma pasta")'`,
    { timeout: 120_000 },
    (err, stdout) => res.json({ path: err ? null : stdout.trim() })
  );
});

// Probe: check if a URL is reachable (used by preview to wait for dev server)
app.get('/api/probe', async (req, res) => {
  const url = (req.query.url as string) || '';
  if (!url || !url.startsWith('http')) { res.json({ ok: false }); return; }
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { method: 'GET', signal: ctrl.signal });
    clearTimeout(tid);
    res.json({ ok: r.status > 0 });
  } catch {
    res.json({ ok: false });
  }
});

// AI commit message generation
app.post('/api/git/generate-commit', (req, res) => {
  const { path: p } = req.body as { path: string };
  if (!p) { res.status(400).json({ error: 'missing path' }); return; }
  const cwd = p.replace(/^~/, os.homedir());

  exec(`git -C "${cwd}" diff --staged`, async (err, diff) => {
    if (err) { res.status(500).json({ error: err.message }); return; }

    const trimmedDiff = diff.slice(0, 12000); // cap at ~12k chars

    if (!trimmedDiff.trim()) {
      res.json({ error: 'Nenhuma alteração staged para gerar mensagem.' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' });
      return;
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `You are a Git commit message generator. Given the following diff, write a concise, descriptive commit message following conventional commits format (e.g. "feat: add user login", "fix: resolve null pointer in auth"). Output ONLY the commit message, no explanation, no quotes.\n\nDiff:\n${trimmedDiff}`,
          }],
        }),
      });

      const data = await response.json() as any;
      if (data.error) {
        res.json({ error: data.error.message ?? 'Erro da API Anthropic' });
        return;
      }

      const message = data.content?.[0]?.text?.trim() ?? '';
      res.json({ message });
    } catch (fetchErr: any) {
      res.status(500).json({ error: fetchErr.message });
    }
  });
});

// Canvas state persistence
app.get('/api/state', (_req, res) => {
  const state = loadState();
  res.json({ state });
});

app.post('/api/state', (req, res) => {
  try {
    saveState(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Beacon endpoint: called by navigator.sendBeacon on page unload (body is text/plain)
app.post('/api/state-beacon', express.text({ type: '*/*' }), (req, res) => {
  try {
    const state = JSON.parse(req.body as string);
    saveState(state);
    res.status(204).end();
  } catch {
    res.status(204).end(); // always 204 — browser ignores beacon responses
  }
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Claude Canvas server running. Open the dev client at http://localhost:5173');
  });
});

server.listen(PORT, () => {
  console.log(`\n🎨 Claude Canvas server running at http://localhost:${PORT}\n`);
});

process.on('SIGTERM', () => { termManager.killAll(); process.exit(0); });
process.on('SIGINT', () => { termManager.killAll(); process.exit(0); });
