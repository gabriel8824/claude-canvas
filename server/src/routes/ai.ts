import express from 'express';
import fs from 'fs';
import path from 'path';
import { toUnix } from '../files';
import { resolvePath } from '../utils';

const router = express.Router();

// HTTP proxy (to avoid CORS in HttpClientNode)
router.post('/api/proxy', async (req, res) => {
  const { url, method, headers: reqHeaders, body: reqBody } = req.body as {
    url: string; method: string;
    headers?: Record<string, string>;
    body?: string;
  };
  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'Invalid URL' }); return;
  }
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30_000);
    const fetchRes = await fetch(url, {
      method: method || 'GET',
      headers: reqHeaders,
      body: reqBody || undefined,
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const responseText = await fetchRes.text();
    const responseHeaders: Record<string, string> = {};
    fetchRes.headers.forEach((value, key) => { responseHeaders[key] = value; });
    res.json({
      status: fetchRes.status,
      statusText: fetchRes.statusText,
      body: responseText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, status: 0, statusText: 'Network Error', body: err.message, headers: {} });
  }
});

// AI Code Review (streaming SSE)
router.post('/api/ai/review', async (req, res) => {
  const { code, language } = req.body as { code: string; language?: string };
  if (!code) { res.status(400).json({ error: 'missing code' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const lang = language && language !== 'auto' ? ` (${language})` : '';
  const prompt = `You are an expert code reviewer. Review the following code${lang} for bugs, security issues, performance, and code quality. Be specific, cite line numbers when possible, and suggest concrete improvements. Format your response in clear sections.\n\nCode:\n\`\`\`${language || ''}\n${code.slice(0, 8000)}\n\`\`\``;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json() as any;
      res.write(`data: ${JSON.stringify({ error: err.error?.message ?? 'API error' })}\n\n`);
      res.end(); return;
    }

    const reader = response.body?.getReader();
    if (!reader) { res.end(); return; }
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(data) as any;
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ delta: parsed.delta.text })}\n\n`);
          }
        } catch {}
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Project-wide file search
router.get('/api/search', (req, res) => {
  const root = resolvePath(req.query.path as string);
  const q = (req.query.q as string || '').trim();
  const caseSensitive = req.query.caseSensitive === 'true';
  const useRegex = req.query.regex === 'true';

  if (!q) { res.json({ results: [] }); return; }

  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__', '.cache']);
  const results: Array<{
    file: string; rel: string; line: number; lineText: string; matchStart: number; matchEnd: number;
  }> = [];

  let pattern: RegExp;
  try {
    pattern = useRegex
      ? new RegExp(q, caseSensitive ? 'g' : 'gi')
      : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch {
    res.json({ results: [], error: 'Invalid regex' }); return;
  }

  function walk(dir: string) {
    if (results.length >= 200) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= 200) return;
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.mdx', '.css', '.scss', '.html', '.htm', '.py', '.go', '.rs', '.sh', '.env', '.yaml', '.yml', '.toml', '.txt', '.sql', '.graphql', '.prisma', '.vue', '.svelte']);
      if (!TEXT_EXTS.has(ext) && ext !== '') continue;

      let content: string;
      try { content = fs.readFileSync(full, 'utf-8'); } catch { continue; }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < 200; i++) {
        pattern.lastIndex = 0;
        const match = pattern.exec(lines[i]);
        if (match) {
          results.push({
            file: toUnix(full),
            rel: toUnix(path.relative(root, full)),
            line: i + 1,
            lineText: lines[i],
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
          });
        }
      }
    }
  }

  walk(root);
  res.json({ results });
});

export default router;
