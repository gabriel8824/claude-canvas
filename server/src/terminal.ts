import * as pty from 'node-pty';
import os from 'os';
import path from 'path';
import fs from 'fs';

const SCROLLBACK_MAX = 100 * 1024; // 100 KB

interface Session {
  pty: pty.IPty;
  cwd: string;
  startedAt: string;
  scrollback: string;
}

export class TerminalManager {
  private sessions = new Map<string, Session>();

  create(
    id: string,
    cwd: string,
    cols: number,
    rows: number,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ): void {
    if (this.sessions.has(id)) this.kill(id);

    const isWin = os.platform() === 'win32';
    const shell = isWin
      ? (process.env.COMSPEC || 'cmd.exe')
      : (process.env.SHELL || '/bin/sh');
    const termName = isWin ? 'windows-ansi' : 'xterm-256color';

    const safeCwd = this.resolveCwd(cwd);

    let proc: pty.IPty;
    try {
      proc = pty.spawn(shell, [], {
        name: termName,
        cols: cols || 80,
        rows: rows || 24,
        cwd: safeCwd,
        env: { ...process.env } as Record<string, string>,
      });
    } catch (err) {
      console.error(`[terminal] Failed to spawn shell for session ${id}:`, err);
      return;
    }

    const session: Session = { pty: proc, cwd: safeCwd, startedAt: new Date().toISOString(), scrollback: '' };
    this.sessions.set(id, session);

    proc.onData((data) => {
      session.scrollback += data;
      if (session.scrollback.length > SCROLLBACK_MAX) {
        session.scrollback = session.scrollback.slice(-SCROLLBACK_MAX);
      }
      onData(data);
    });

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      onExit(exitCode ?? 0);
    });
  }

  getScrollback(id: string): string {
    return this.sessions.get(id)?.scrollback ?? '';
  }

  write(id: string, data: string) {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.pty.resize(cols, rows);
  }

  kill(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      try { s.pty.kill(); } catch {}
      this.sessions.delete(id);
    }
  }

  killAll() {
    for (const id of this.sessions.keys()) this.kill(id);
  }

  listProcesses() {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      pid: s.pty?.pid,
      cwd: s.cwd || '~',
      startedAt: s.startedAt,
      status: 'running',
    }));
  }

  private resolveCwd(cwd: string): string {
    if (!cwd || cwd === '~') return os.homedir();
    if (cwd.startsWith('~/') || cwd.startsWith('~\\')) {
      return path.join(os.homedir(), cwd.slice(2).replace(/\\/g, path.sep));
    }
    try {
      if (fs.existsSync(cwd)) return path.normalize(cwd);
    } catch {}
    return os.homedir();
  }
}
