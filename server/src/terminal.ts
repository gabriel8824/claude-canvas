import * as pty from 'node-pty';
import os from 'os';

interface Session {
  pty: pty.IPty;
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
  ) {
    if (this.sessions.has(id)) {
      this.kill(id);
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const safeCwd = this.resolveCwd(cwd);

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: safeCwd,
      env: { ...process.env } as Record<string, string>,
    });

    proc.onData(onData);
    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      onExit(exitCode ?? 0);
    });

    this.sessions.set(id, { pty: proc });
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

  private resolveCwd(cwd: string): string {
    if (!cwd || cwd === '~') return os.homedir();
    if (cwd.startsWith('~/')) return cwd.replace('~', os.homedir());
    try {
      const fs = require('fs');
      if (fs.existsSync(cwd)) return cwd;
    } catch {}
    return os.homedir();
  }
}
