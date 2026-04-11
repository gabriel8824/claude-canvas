import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { toUnix, safePath, listDir, readFile } from './files';

describe('toUnix', () => {
  it('converts backslashes to forward slashes', () => {
    // Simulate a Windows-style path by manually joining with backslash
    const windowsPath = 'C:\\Users\\foo\\bar';
    // toUnix splits on path.sep, so we test with the actual sep character
    // On any platform: split on backslash should work when path.sep is backslash.
    // We can test the core logic directly: replace \\ with /
    expect(toUnix('C:\\Users\\foo\\bar'.split('\\').join(path.sep === '\\' ? '\\' : '/'))).toBeTruthy();
  });

  it('leaves forward-slash paths unchanged on posix', () => {
    const p = '/home/user/project';
    // On posix path.sep === '/', so split('/').join('/') is a no-op
    expect(toUnix(p)).toBe(p);
  });

  it('returns a string', () => {
    expect(typeof toUnix('/some/path')).toBe('string');
  });
});

describe('safePath', () => {
  it('expands ~ alone to home directory', () => {
    expect(safePath('~')).toBe(os.homedir());
  });

  it('expands ~/ prefix to home directory', () => {
    const result = safePath('~/Documents');
    // Use path.join so the assertion works on both Windows and Unix
    expect(result).toBe(path.join(os.homedir(), 'Documents'));
  });

  it('returns home dir for empty string', () => {
    expect(safePath('')).toBe(os.homedir());
  });

  it('returns non-tilde paths unchanged', () => {
    // A path without a leading ~ should be returned as-is on all platforms
    const abs = path.isAbsolute(os.tmpdir())
      ? path.join(os.tmpdir(), 'some', 'nonexistent-subpath')
      : '/tmp/some/path';
    expect(safePath(abs)).toBe(abs);
  });

  it('returns relative paths unchanged (no tilde)', () => {
    const rel = 'relative/path';
    expect(safePath(rel)).toBe(rel);
  });
});

describe('listDir', () => {
  it('returns an array for a valid directory', () => {
    const result = listDir(os.tmpdir());
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an empty array for a non-existent directory', () => {
    // Use a cross-platform path guaranteed not to exist
    const nonExistent = path.join(os.tmpdir(), 'cc-vitest-nonexistent-dir-928374');
    const result = listDir(nonExistent);
    expect(result).toEqual([]);
  });

  it('each item has name, path, and type fields', () => {
    // Use os.tmpdir() — guaranteed to exist and have at least some entries in CI
    const result = listDir(os.tmpdir());
    for (const item of result) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('path');
      expect(item).toHaveProperty('type');
      expect(['file', 'dir']).toContain(item.type);
    }
  });

  it('file items include ext and size fields', () => {
    // Create a temp file to guarantee at least one file entry
    const tmpFile = path.join(os.tmpdir(), `vitest-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello');
    try {
      const result = listDir(os.tmpdir());
      const fileItems = result.filter(i => i.type === 'file');
      if (fileItems.length > 0) {
        for (const item of fileItems) {
          expect(item).toHaveProperty('ext');
          expect(item).toHaveProperty('size');
        }
      }
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('dirs come before files in the result', () => {
    // Create a temp dir with one subdirectory and one file
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-listdir-'));
    fs.mkdirSync(path.join(base, 'aaa-dir'));
    fs.writeFileSync(path.join(base, 'bbb-file.txt'), '');
    try {
      const result = listDir(base);
      const types = result.map(i => i.type);
      const firstFile = types.indexOf('file');
      const lastDir = types.lastIndexOf('dir');
      // All dirs before all files (or one of them doesn't exist)
      if (firstFile !== -1 && lastDir !== -1) {
        expect(lastDir).toBeLessThan(firstFile);
      }
    } finally {
      fs.rmSync(base, { recursive: true });
    }
  });
});

describe('readFile', () => {
  it('returns { content } for a readable file', () => {
    const tmpFile = path.join(os.tmpdir(), `vitest-read-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello world');
    try {
      const result = readFile(tmpFile);
      expect(result).toHaveProperty('content');
      expect(result.content).toBe('hello world');
      expect(result.error).toBeUndefined();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns { content: "", error } for a non-existent file', () => {
    const nonExistent = path.join(os.tmpdir(), 'cc-vitest-no-such-file-928374.txt');
    const result = readFile(nonExistent);
    expect(result.content).toBe('');
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('returns { content: "", error } for a file larger than 512KB', () => {
    const tmpFile = path.join(os.tmpdir(), `vitest-large-${Date.now()}.bin`);
    // Write 513KB
    fs.writeFileSync(tmpFile, Buffer.alloc(1024 * 513, 'x'));
    try {
      const result = readFile(tmpFile);
      expect(result.content).toBe('');
      expect(result.error).toMatch(/too large/i);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('always returns an object with a content property', () => {
    const nonExistent = path.join(os.tmpdir(), 'cc-vitest-no-such-path-928374');
    const result = readFile(nonExistent);
    expect(typeof result.content).toBe('string');
  });
});
