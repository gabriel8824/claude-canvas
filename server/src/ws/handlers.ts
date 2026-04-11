import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { WebSocketServer, WebSocket } from 'ws';
import type { TerminalManager } from '../terminal';
import { listDir, readFile, toUnix } from '../files';
import { resolvePath } from '../utils';
import { send, type Msg } from './types';

export function registerWsHandlers(wss: WebSocketServer, termManager: TerminalManager): void {
  wss.on('connection', (ws: WebSocket) => {
    const clientTerminals = new Set<string>();

    ws.on('message', (raw) => {
      let msg: Msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'terminal:create': {
          const { id, cwd, cols, rows } = msg;
          clientTerminals.add(id);
          // Capture scrollback from the previous session before create() kills it
          const scrollback = termManager.getScrollback(id);
          termManager.create(
            id,
            cwd || '~',
            cols || 80,
            rows || 24,
            (data) => send(ws, { type: 'terminal:output', id, data }),
            (code) => send(ws, { type: 'terminal:exit', id, code })
          );
          send(ws, { type: 'terminal:ready', id, scrollback });
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
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'status', '--porcelain=v1', '-b']);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            if (code !== 0) send(ws, { type: 'git:status', reqId, raw: '', error: err.trim() || `exit ${code}` });
            else send(ws, { type: 'git:status', reqId, raw: out, error: null });
          });
          break;
        }

        case 'git:add': {
          const { reqId, path: p, file } = msg;
          const cwd = resolvePath(p as string);
          const args = file === '.' ? ['-C', cwd, 'add', '.'] : ['-C', cwd, 'add', '--', file as string];
          const proc = spawn('git', args);
          let stderr = '';
          proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          proc.on('close', (code) => send(ws, { type: 'git:add', reqId, error: code !== 0 ? stderr : null }));
          break;
        }

        case 'git:restore': {
          const { reqId, path: p, file, staged } = msg;
          const cwd = resolvePath(p as string);
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
          const cwd = resolvePath(p as string);
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
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, op], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
          const fwd = (d: Buffer) => send(ws, { type: `git:${op}:output`, reqId, data: d.toString() });
          proc.stdout.on('data', fwd);
          proc.stderr.on('data', fwd);
          proc.on('close', (code) => send(ws, { type: `git:${op}:done`, reqId, code }));
          break;
        }

        case 'git:log': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'log', '--oneline', '--decorate', '-20']);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            if (code !== 0) send(ws, { type: 'git:log', reqId, output: '', error: err.trim() || `exit ${code}` });
            else send(ws, { type: 'git:log', reqId, output: out, error: null });
          });
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

        case 'git:diff': {
          const { reqId, path: p, file, staged } = msg;
          const cwd = resolvePath(p as string);
          const args = staged
            ? ['-C', cwd, 'diff', '--staged', '--', file as string]
            : ['-C', cwd, 'diff', '--', file as string];
          const proc = spawn('git', args);
          let output = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:diff', reqId, output: code === 0 ? output : '', error: code !== 0 ? err.trim() : null });
          });
          break;
        }

        case 'git:init': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'init']);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:init', reqId, output: out, error: code !== 0 ? (err.trim() || `exit ${code}`) : null });
          });
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

          const proc = spawn('git', ['clone', '--progress', url, expanded], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          });
          const fwd = (d: Buffer) => send(ws, { type: 'git:clone:output', reqId, data: d.toString() });
          proc.stdout.on('data', fwd);
          proc.stderr.on('data', fwd);
          proc.on('error', (err) => send(ws, { type: 'git:clone:error', reqId, message: err.message }));
          proc.on('close', (code) => {
            if (code === 0) send(ws, { type: 'git:clone:done',  reqId, targetDir: toUnix(expanded) });
            else             send(ws, { type: 'git:clone:error', reqId, message: `git clone saiu com código ${code}` });
          });
          break;
        }

        case 'git:branches': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'branch', '-a', '--format=%(refname:short)|%(HEAD)']);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            if (code !== 0) send(ws, { type: 'git:branches', reqId, branches: [], error: err.trim() });
            else {
              const branches = out.trim().split('\n').filter(Boolean).map(line => {
                const [name, current] = line.split('|');
                return { name: name.trim(), current: current === '*' };
              });
              send(ws, { type: 'git:branches', reqId, branches, error: null });
            }
          });
          break;
        }

        case 'git:branch:create': {
          const { reqId, path: p, name } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'checkout', '-b', name as string]);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:branch:create', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          });
          break;
        }

        case 'git:branch:checkout': {
          const { reqId, path: p, name } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'checkout', name as string]);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:branch:checkout', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          });
          break;
        }

        case 'git:branch:delete': {
          const { reqId, path: p, name } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'branch', '-d', name as string]);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:branch:delete', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          });
          break;
        }

        case 'git:stash:list': {
          const { reqId, path: p } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'stash', 'list', '--format=%gd|%s|%ci']);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            if (code !== 0) send(ws, { type: 'git:stash:list', reqId, stashes: [], error: err.trim() });
            else {
              const stashes = out.trim().split('\n').filter(Boolean).map(line => {
                const [ref, message, date] = line.split('|');
                return { ref: ref?.trim(), message: message?.trim(), date: date?.trim() };
              });
              send(ws, { type: 'git:stash:list', reqId, stashes, error: null });
            }
          });
          break;
        }

        case 'git:stash:save': {
          const { reqId, path: p, message } = msg;
          const cwd = resolvePath(p as string);
          const args = message
            ? ['-C', cwd, 'stash', 'push', '-m', message as string]
            : ['-C', cwd, 'stash', 'push'];
          const proc = spawn('git', args);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:stash:save', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          });
          break;
        }

        case 'git:stash:pop': {
          const { reqId, path: p, ref } = msg;
          const cwd = resolvePath(p as string);
          const args = ref ? ['-C', cwd, 'stash', 'pop', ref as string] : ['-C', cwd, 'stash', 'pop'];
          const proc = spawn('git', args);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:stash:pop', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          });
          break;
        }

        case 'git:stash:drop': {
          const { reqId, path: p, ref } = msg;
          const cwd = resolvePath(p as string);
          const proc = spawn('git', ['-C', cwd, 'stash', 'drop', ref as string]);
          let out = '', err = '';
          proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('close', (code) => {
            send(ws, { type: 'git:stash:drop', reqId, ok: code === 0, error: code !== 0 ? err.trim() : null });
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      for (const id of clientTerminals) termManager.kill(id);
    });
  });
}
