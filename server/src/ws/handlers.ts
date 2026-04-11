import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import type { WebSocketServer, WebSocket } from 'ws';
import type { TerminalManager } from '../terminal';
import { listDir, readFile, toUnix } from '../files';
import { resolvePath } from '../utils';
import { send, type Msg } from './types';

// ─── Git helpers ──────────────────────────────────────────────────────────────

/** Run a git command, collect stdout+stderr, call back on close. Returns the process so callers can track it. */
function runGit(
  args: string[],
  onClose: (code: number, out: string, err: string) => void,
  env?: Record<string, string>
): ChildProcess {
  const proc = spawn('git', args, env ? { env: { ...process.env, ...env } } : undefined);
  let out = '', err = '';
  proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
  proc.on('close', (code) => onClose(code ?? 1, out, err));
  return proc;
}

/** Stream git output line-by-line, emitting output/done/error messages. */
function streamGit(
  ws: WebSocket,
  reqId: string,
  type: string,
  args: string[],
  env?: Record<string, string>
): ChildProcess {
  const proc = spawn('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
  const fwd = (d: Buffer) => send(ws, { type: `${type}:output`, reqId, data: d.toString() });
  proc.stdout.on('data', fwd);
  proc.stderr.on('data', fwd);
  proc.on('error', (e) => send(ws, { type: `${type}:error`, reqId, message: e.message }));
  proc.on('close', (code) => send(ws, { type: `${type}:done`, reqId, code }));
  return proc;
}

// ─── Handler registration ─────────────────────────────────────────────────────

export function registerWsHandlers(wss: WebSocketServer, termManager: TerminalManager): void {
  wss.on('connection', (ws: WebSocket) => {
    const clientTerminals = new Set<string>();
    const activeProcs     = new Set<ChildProcess>();

    function track(proc: ChildProcess): ChildProcess {
      activeProcs.add(proc);
      proc.on('close', () => activeProcs.delete(proc));
      return proc;
    }

    ws.on('message', (raw) => {
      let msg: Msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {

        // ── Terminal ────────────────────────────────────────────────────────
        case 'terminal:create': {
          const { id, cwd, cols, rows } = msg;
          clientTerminals.add(id);
          const scrollback = termManager.getScrollback(id);
          termManager.create(
            id, cwd || '~', cols || 80, rows || 24,
            (data) => send(ws, { type: 'terminal:output', id, data }),
            (code) => send(ws, { type: 'terminal:exit',   id, code })
          );
          send(ws, { type: 'terminal:ready', id, scrollback });
          break;
        }
        case 'terminal:input':  { termManager.write(msg.id, msg.data);               break; }
        case 'terminal:resize': { termManager.resize(msg.id, msg.cols, msg.rows);    break; }
        case 'terminal:kill':   { termManager.kill(msg.id); clientTerminals.delete(msg.id); break; }

        // ── Files ───────────────────────────────────────────────────────────
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
        case 'files:write': {
          const { reqId, path: p, content } = msg;
          const expanded = resolvePath(p as string);
          try {
            fs.writeFileSync(expanded, content as string, 'utf-8');
            send(ws, { type: 'files:write', reqId, error: null });
          } catch (err: any) {
            send(ws, { type: 'files:write', reqId, error: err.message });
          }
          break;
        }

        // ── Git: simple commands ─────────────────────────────────────────────
        case 'git:status': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'status', '--porcelain=v1', '-b'], (code, out, err) => {
            send(ws, { type: 'git:status', reqId,
              raw: code === 0 ? out : '', error: code !== 0 ? (err.trim() || `exit ${code}`) : null });
          }));
          break;
        }

        case 'git:add': {
          const { reqId, path: p, file } = msg;
          const cwd = resolvePath(p as string);
          const args = file === '.' ? ['-C', cwd, 'add', '.'] : ['-C', cwd, 'add', '--', file as string];
          track(runGit(args, (code, _out, err) => {
            send(ws, { type: 'git:add', reqId, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:restore': {
          const { reqId, path: p, file, staged } = msg;
          const cwd = resolvePath(p as string);
          const args = staged
            ? ['-C', cwd, 'restore', '--staged', '--', file as string]
            : ['-C', cwd, 'restore', '--', file as string];
          track(runGit(args, (code, _out, err) => {
            send(ws, { type: 'git:restore', reqId, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:commit': {
          const { reqId, path: p, message } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'commit', '-m', message as string], (code, out, err) => {
            send(ws, { type: 'git:commit', reqId, output: out, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:log': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'log', '--oneline', '--decorate', '-20'], (code, out, err) => {
            send(ws, { type: 'git:log', reqId,
              output: code === 0 ? out : '', error: code !== 0 ? (err.trim() || `exit ${code}`) : null });
          }));
          break;
        }

        case 'git:diff': {
          const { reqId, path: p, file, staged } = msg;
          const cwd = resolvePath(p as string);
          const args = staged
            ? ['-C', cwd, 'diff', '--staged', '--', file as string]
            : ['-C', cwd, 'diff', '--', file as string];
          track(runGit(args, (code, out, err) => {
            send(ws, { type: 'git:diff', reqId,
              output: code === 0 ? out : '', error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:init': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'init'], (code, out, err) => {
            send(ws, { type: 'git:init', reqId,
              output: out, error: code !== 0 ? (err.trim() || `exit ${code}`) : null });
          }));
          break;
        }

        case 'git:branches': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'branch', '-a', '--format=%(refname:short)|%(HEAD)'], (code, out, err) => {
            if (code !== 0) { send(ws, { type: 'git:branches', reqId, branches: [], error: err.trim() }); return; }
            const branches = out.trim().split('\n').filter(Boolean).map(line => {
              const [name, current] = line.split('|');
              return { name: name.trim(), current: current === '*' };
            });
            send(ws, { type: 'git:branches', reqId, branches, error: null });
          }));
          break;
        }

        case 'git:branch:create': {
          const { reqId, path: p, name } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'checkout', '-b', name as string], (code, _out, err) => {
            send(ws, { type: 'git:branch:create', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:branch:checkout': {
          const { reqId, path: p, name } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'checkout', name as string], (code, _out, err) => {
            send(ws, { type: 'git:branch:checkout', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:branch:delete': {
          const { reqId, path: p, name } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'branch', '-d', name as string], (code, _out, err) => {
            send(ws, { type: 'git:branch:delete', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:stash:list': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'stash', 'list', '--format=%gd|%s|%ci'], (code, out, err) => {
            if (code !== 0) { send(ws, { type: 'git:stash:list', reqId, stashes: [], error: err.trim() }); return; }
            const stashes = out.trim().split('\n').filter(Boolean).map(line => {
              const [ref, message, date] = line.split('|');
              return { ref: ref?.trim(), message: message?.trim(), date: date?.trim() };
            });
            send(ws, { type: 'git:stash:list', reqId, stashes, error: null });
          }));
          break;
        }

        case 'git:stash:save': {
          const { reqId, path: p, message } = msg;
          const cwd = resolvePath(p as string);
          const args = message
            ? ['-C', cwd, 'stash', 'push', '-m', message as string]
            : ['-C', cwd, 'stash', 'push'];
          track(runGit(args, (code, _out, err) => {
            send(ws, { type: 'git:stash:save', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:stash:pop': {
          const { reqId, path: p, ref } = msg;
          const cwd = resolvePath(p as string);
          const args = ref ? ['-C', cwd, 'stash', 'pop', ref as string] : ['-C', cwd, 'stash', 'pop'];
          track(runGit(args, (code, _out, err) => {
            send(ws, { type: 'git:stash:pop', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        case 'git:stash:drop': {
          const { reqId, path: p, ref } = msg;
          const cwd = resolvePath(p as string);
          track(runGit(['-C', cwd, 'stash', 'drop', ref as string], (code, _out, err) => {
            send(ws, { type: 'git:stash:drop', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          }));
          break;
        }

        // ── Git: streaming commands ──────────────────────────────────────────
        case 'git:push':
        case 'git:pull': {
          const op = msg.type === 'git:push' ? 'push' : 'pull';
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          track(streamGit(ws, reqId, `git:${op}`, ['-C', cwd, op]));
          break;
        }

        case 'git:clone': {
          const { reqId, url, targetDir } = msg;
          if (!url || typeof url !== 'string') {
            send(ws, { type: 'git:clone:error', reqId, message: 'URL inválida' });
            break;
          }
          const expanded = resolvePath(targetDir as string);
          const parent = path.dirname(expanded);
          try { fs.mkdirSync(parent, { recursive: true }); } catch {}
          track(streamGit(ws, reqId, 'git:clone', ['clone', '--progress', url, expanded]));
          break;
        }
      }
    });

    ws.on('close', () => {
      // Kill all git processes spawned by this connection
      for (const proc of activeProcs) { try { proc.kill(); } catch {} }
      activeProcs.clear();
      // Kill all terminals owned by this connection
      for (const id of clientTerminals) termManager.kill(id);
      clientTerminals.clear();
    });
  });
}
