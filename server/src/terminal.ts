import * as pty from 'node-pty';
import os from 'os';

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
  ): boolean /* true = new session, false = reused */ {
    // If a live session already exists, kill it so we can respawn cleanly.
    // The caller should call getScrollback() before create() to capture history.
    if (this.sessions.has(id)) {
      this.kill(id);
    }

    const isWin = os.platform() === 'win32';
    // On Windows: prefer PowerShell, fall back to cmd.exe via COMSPEC env var.
    // On macOS/Linux: use SHELL env var, fall back to /bin/sh.
    const shell = isWin
      ? 'powershell.exe'
      : (process.env.SHELL || '/bin/sh');
    const safeCwd = this.resolveCwd(cwd);

    const proc = pty.spawn(shell, [], {
      // ConPTY on Windows ignores 'name', but xterm-256color works with modern PowerShell too
      name: isWin ? 'xterm-256color' : 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: safeCwd,
      env: { ...process.env } as Record<string, string>,
    });

    const session: Session = { pty: proc, cwd: safeCwd, startedAt: new Date().toISOString(), scrollback: '' };
    this.sessions.set(id, session);

    proc.onData((data) => {
      // Accumulate scrollback, capped at SCROLLBACK_MAX
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

    return true;
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

  listProcesses(): Array<{ id: string; pid?: number; cwd: string; startedAt: string; status: string }> {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      pid: session.pty?.pid,
      cwd: session.cwd || '~',
      startedAt: session.startedAt || new Date().toISOString(),
      status: session.pty ? 'running' : 'exited',
    }));
  }

  private resolveCwd(cwd: string): string {
    if (!cwd || cwd === '~') return os.homedir();
    // Use path.join for tilde expansion — handles both Unix (~/) and Windows (~\) separators
    if (cwd.startsWith('~/') || cwd.startsWith('~\\')) {
      return require('path').join(os.homedir(), cwd.slice(2));
    }
    try {
      const fs = require('fs');
      if (fs.existsSync(cwd)) return cwd;
    } catch {}
    return os.homedir();
  }
}
