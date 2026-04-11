import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage, FileItem, GitFileStatus, GitCommit } from './ws-types';

// ---------------------------------------------------------------------------
// Helpers – narrow a union by its `type` discriminant and assert the result
// ---------------------------------------------------------------------------

function narrowClient<T extends ClientMessage['type']>(
  msg: ClientMessage,
  t: T,
): Extract<ClientMessage, { type: T }> | undefined {
  return msg.type === t ? (msg as Extract<ClientMessage, { type: T }>) : undefined;
}

function narrowServer<T extends ServerMessage['type']>(
  msg: ServerMessage,
  t: T,
): Extract<ServerMessage, { type: T }> | undefined {
  return msg.type === t ? (msg as Extract<ServerMessage, { type: T }>) : undefined;
}

// ---------------------------------------------------------------------------
// ClientMessage variants
// ---------------------------------------------------------------------------

describe('ClientMessage – terminal variants', () => {
  it('terminal:create narrows correctly', () => {
    const msg: ClientMessage = { type: 'terminal:create', id: 't1', cwd: '/home', cols: 80, rows: 24 };
    const narrowed = narrowClient(msg, 'terminal:create');
    expect(narrowed).toBeDefined();
    expect(narrowed!.type).toBe('terminal:create');
    expect(narrowed!.id).toBe('t1');
    expect(narrowed!.cols).toBe(80);
    expect(narrowed!.rows).toBe(24);
  });

  it('terminal:input narrows correctly', () => {
    const msg: ClientMessage = { type: 'terminal:input', id: 't1', data: 'ls\n' };
    const narrowed = narrowClient(msg, 'terminal:input');
    expect(narrowed).toBeDefined();
    expect(narrowed!.data).toBe('ls\n');
  });

  it('terminal:resize narrows correctly', () => {
    const msg: ClientMessage = { type: 'terminal:resize', id: 't1', cols: 120, rows: 40 };
    const narrowed = narrowClient(msg, 'terminal:resize');
    expect(narrowed).toBeDefined();
    expect(narrowed!.cols).toBe(120);
  });

  it('terminal:kill narrows correctly', () => {
    const msg: ClientMessage = { type: 'terminal:kill', id: 't1' };
    const narrowed = narrowClient(msg, 'terminal:kill');
    expect(narrowed).toBeDefined();
    expect(narrowed!.id).toBe('t1');
  });

  it('a different type does NOT narrow to terminal:create', () => {
    const msg: ClientMessage = { type: 'terminal:kill', id: 't1' };
    const narrowed = narrowClient(msg, 'terminal:create');
    expect(narrowed).toBeUndefined();
  });
});

describe('ClientMessage – files variants', () => {
  it('files:list narrows correctly', () => {
    const msg: ClientMessage = { type: 'files:list', reqId: 'r1', path: '/tmp' };
    const narrowed = narrowClient(msg, 'files:list');
    expect(narrowed).toBeDefined();
    expect(narrowed!.reqId).toBe('r1');
    expect(narrowed!.path).toBe('/tmp');
  });

  it('files:read narrows correctly', () => {
    const msg: ClientMessage = { type: 'files:read', reqId: 'r2', path: '/tmp/foo.txt' };
    const narrowed = narrowClient(msg, 'files:read');
    expect(narrowed).toBeDefined();
    expect(narrowed!.path).toBe('/tmp/foo.txt');
  });
});

describe('ClientMessage – git variants', () => {
  it('git:status narrows correctly', () => {
    const msg: ClientMessage = { type: 'git:status', reqId: 'r3', path: '/repo' };
    const narrowed = narrowClient(msg, 'git:status');
    expect(narrowed).toBeDefined();
    expect(narrowed!.path).toBe('/repo');
  });

  it('git:commit narrows correctly and exposes message field', () => {
    const msg: ClientMessage = { type: 'git:commit', reqId: 'r4', path: '/repo', message: 'init' };
    const narrowed = narrowClient(msg, 'git:commit');
    expect(narrowed).toBeDefined();
    expect(narrowed!.message).toBe('init');
  });

  it('git:diff narrows correctly and exposes staged field', () => {
    const msg: ClientMessage = { type: 'git:diff', reqId: 'r5', path: '/repo', staged: true };
    const narrowed = narrowClient(msg, 'git:diff');
    expect(narrowed).toBeDefined();
    expect(narrowed!.staged).toBe(true);
  });

  it('git:clone narrows correctly', () => {
    const msg: ClientMessage = { type: 'git:clone', reqId: 'r6', url: 'https://github.com/x/y', targetDir: '/tmp/y' };
    const narrowed = narrowClient(msg, 'git:clone');
    expect(narrowed).toBeDefined();
    expect(narrowed!.url).toBe('https://github.com/x/y');
  });
});

// ---------------------------------------------------------------------------
// ServerMessage variants
// ---------------------------------------------------------------------------

describe('ServerMessage – terminal variants', () => {
  it('terminal:ready narrows correctly', () => {
    const msg: ServerMessage = { type: 'terminal:ready', id: 't1' };
    const narrowed = narrowServer(msg, 'terminal:ready');
    expect(narrowed).toBeDefined();
    expect(narrowed!.id).toBe('t1');
  });

  it('terminal:output narrows correctly', () => {
    const msg: ServerMessage = { type: 'terminal:output', id: 't1', data: 'hello' };
    const narrowed = narrowServer(msg, 'terminal:output');
    expect(narrowed).toBeDefined();
    expect(narrowed!.data).toBe('hello');
  });

  it('terminal:exit narrows correctly', () => {
    const msg: ServerMessage = { type: 'terminal:exit', id: 't1', code: 0 };
    const narrowed = narrowServer(msg, 'terminal:exit');
    expect(narrowed).toBeDefined();
    expect(narrowed!.code).toBe(0);
  });

  it('terminal:exit accepts null code', () => {
    const msg: ServerMessage = { type: 'terminal:exit', id: 't1', code: null };
    const narrowed = narrowServer(msg, 'terminal:exit');
    expect(narrowed!.code).toBeNull();
  });
});

describe('ServerMessage – files variants', () => {
  it('files:list narrows correctly and exposes items', () => {
    const items: FileItem[] = [{ name: 'foo.txt', path: '/tmp/foo.txt', type: 'file', ext: 'txt', size: 5 }];
    const msg: ServerMessage = { type: 'files:list', reqId: 'r1', path: '/tmp', items };
    const narrowed = narrowServer(msg, 'files:list');
    expect(narrowed).toBeDefined();
    expect(narrowed!.items).toHaveLength(1);
    expect(narrowed!.items[0].name).toBe('foo.txt');
  });

  it('files:read narrows correctly with optional error', () => {
    const msg: ServerMessage = { type: 'files:read', reqId: 'r2', path: '/tmp/foo.txt', error: 'not found' };
    const narrowed = narrowServer(msg, 'files:read');
    expect(narrowed).toBeDefined();
    expect(narrowed!.error).toBe('not found');
  });
});

describe('ServerMessage – git variants', () => {
  it('git:status narrows correctly', () => {
    const files: GitFileStatus[] = [{ status: 'M', file: 'README.md', staged: false }];
    const msg: ServerMessage = { type: 'git:status', reqId: 'r3', branch: 'main', ahead: 0, behind: 0, files };
    const narrowed = narrowServer(msg, 'git:status');
    expect(narrowed).toBeDefined();
    expect(narrowed!.branch).toBe('main');
    expect(narrowed!.files[0].file).toBe('README.md');
  });

  it('git:log narrows correctly and exposes commits array', () => {
    const commits: GitCommit[] = [{ hash: 'abc123', message: 'init', author: 'Alice', date: '2024-01-01' }];
    const msg: ServerMessage = { type: 'git:log', reqId: 'r4', commits };
    const narrowed = narrowServer(msg, 'git:log');
    expect(narrowed).toBeDefined();
    expect(narrowed!.commits[0].hash).toBe('abc123');
  });

  it('git:commit narrows correctly with optional hash', () => {
    const msg: ServerMessage = { type: 'git:commit', reqId: 'r5', ok: true, hash: 'def456' };
    const narrowed = narrowServer(msg, 'git:commit');
    expect(narrowed).toBeDefined();
    expect(narrowed!.ok).toBe(true);
    expect(narrowed!.hash).toBe('def456');
  });

  it('git:push narrows correctly with streaming chunk', () => {
    const msg: ServerMessage = { type: 'git:push', reqId: 'r6', chunk: 'Counting objects...', done: false };
    const narrowed = narrowServer(msg, 'git:push');
    expect(narrowed).toBeDefined();
    expect(narrowed!.chunk).toBe('Counting objects...');
    expect(narrowed!.done).toBe(false);
  });

  it('git:init narrows correctly', () => {
    const msg: ServerMessage = { type: 'git:init', reqId: 'r7', ok: true };
    const narrowed = narrowServer(msg, 'git:init');
    expect(narrowed).toBeDefined();
    expect(narrowed!.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Supporting interfaces
// ---------------------------------------------------------------------------

describe('FileItem interface', () => {
  it('can be constructed with required fields only', () => {
    const item: FileItem = { name: 'dir', path: '/tmp/dir', type: 'dir' };
    expect(item.type).toBe('dir');
    expect(item.size).toBeUndefined();
    expect(item.ext).toBeUndefined();
  });
});

describe('GitFileStatus interface', () => {
  it('holds status, file, and staged', () => {
    const s: GitFileStatus = { status: 'A', file: 'new.ts', staged: true };
    expect(s.staged).toBe(true);
  });
});

describe('GitCommit interface', () => {
  it('holds hash, message, author, and date', () => {
    const c: GitCommit = { hash: '0000000', message: 'fix', author: 'Bob', date: '2024-06-01' };
    expect(c.hash).toBe('0000000');
  });
});
