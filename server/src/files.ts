import fs from 'fs';
import path from 'path';
import os from 'os';

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  ext?: string;
}

function safePath(p: string): string {
  if (!p || p === '~') return os.homedir();
  if (p.startsWith('~/')) return p.replace('~', os.homedir());
  return p;
}

export function listDir(dirPath: string): FileItem[] {
  const resolved = safePath(dirPath);
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.') || e.name === '.env')
      .map(e => {
        const full = path.join(resolved, e.name);
        const isDir = e.isDirectory();
        const item: FileItem = {
          name: e.name,
          path: full,
          type: isDir ? 'dir' : 'file',
        };
        if (!isDir) {
          item.ext = path.extname(e.name).slice(1);
          try { item.size = fs.statSync(full).size; } catch {}
        }
        return item;
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

export function readFile(filePath: string): { content: string; error?: string } {
  const resolved = safePath(filePath);
  try {
    const stat = fs.statSync(resolved);
    if (stat.size > 1024 * 512) {
      return { content: '', error: 'File too large (>512KB)' };
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    return { content };
  } catch (e: any) {
    return { content: '', error: e.message };
  }
}
