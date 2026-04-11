import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import crypto from 'crypto';
import { execSync } from 'child_process';

// ── Session limits via Claude app cookies (macOS only) ────────────────────────

interface RateWindow {
  utilization: number;   // 0–100
  resetsAt: string | null;
}

interface ClaudeLimits {
  fiveHour: RateWindow;
  sevenDay: RateWindow;
  sevenDayOpus: RateWindow | null;
  accountEmail: string | null;
}

let limitsCache: { data: ClaudeLimits; at: number } | null = null;
const LIMITS_TTL = 60_000; // re-fetch every 60s

function decryptElectronCookie(encryptedValue: Buffer, key: Buffer): string {
  let enc = encryptedValue;
  if (enc.slice(0, 3).toString('ascii') === 'v10') enc = enc.slice(3);
  const iv = Buffer.alloc(16, 0x20); // 16 space chars — Chrome/Electron default
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([decipher.update(enc), decipher.final()]);

  // The decrypted bytes contain: [garbage first block][backtick 0x60][actual value]
  // Find the backtick separator that Chrome/Electron Cookies use as a value prefix
  const backtick = raw.indexOf(0x60); // 0x60 = '`'
  if (backtick !== -1) {
    return raw.slice(backtick + 1).toString('utf8').replace(/\x00/g, '').trim();
  }

  // Fallback: skip the first corrupted AES block (16 bytes)
  return raw.slice(16).toString('utf8').replace(/\x00/g, '').trim();
}

function getCookieValue(cookieDbPath: string, name: string, key: Buffer): string | null {
  const tmp = path.join(os.tmpdir(), `cc-cookie-${Date.now()}.db`);
  try {
    fs.copyFileSync(cookieDbPath, tmp);
    const Database = require('better-sqlite3');
    const db = new Database(tmp, { readonly: true });
    const row = db.prepare(
      "SELECT encrypted_value FROM cookies WHERE host_key LIKE '%claude.ai%' AND name=? LIMIT 1"
    ).get(name) as any;
    db.close();
    if (!row?.encrypted_value) return null;
    const enc = Buffer.isBuffer(row.encrypted_value)
      ? row.encrypted_value
      : Buffer.from(row.encrypted_value);
    return decryptElectronCookie(enc, key);
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ── Swift-based HTTP fetch (bypasses Cloudflare bot detection on macOS) ───────

function swiftGet(url: string, cookieHeader: string): string | null {
  // Cloudflare blocks Node.js/curl TLS fingerprints; Swift URLSession uses the
  // macOS/Safari TLS stack which passes the Cloudflare challenge.
  const script = `
import Foundation
let url = URL(string: "${url}")!
var req = URLRequest(url: url)
req.setValue("${cookieHeader.replace(/"/g, '\\"')}", forHTTPHeaderField: "Cookie")
req.setValue("application/json", forHTTPHeaderField: "Accept")
req.setValue("https://claude.ai", forHTTPHeaderField: "Referer")
req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
let sem = DispatchSemaphore(value: 0)
URLSession.shared.dataTask(with: req) { data, resp, _ in
  if let r = resp as? HTTPURLResponse, r.statusCode == 200,
     let d = data, let s = String(data: d, encoding: .utf8) { print(s) }
  sem.signal()
}.resume()
sem.wait()
`;
  const tmpFile = path.join(os.tmpdir(), `cc-swift-${Date.now()}.swift`);
  try {
    fs.writeFileSync(tmpFile, script, 'utf8');
    const out = execSync(`swift ${tmpFile}`, { encoding: 'utf8', timeout: 10000 }).trim();
    return out || null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function fetchClaudeLimits(): Promise<ClaudeLimits | null> {
  if (process.platform !== 'darwin') return null;

  const cookiePath = path.join(
    os.homedir(), 'Library', 'Application Support', 'Claude', 'Cookies'
  );
  if (!fs.existsSync(cookiePath)) return null;

  try {
    // Get decryption key from macOS Keychain
    const safeKey = execSync(
      "security find-generic-password -s 'Claude Safe Storage' -a 'Claude' -w 2>/dev/null",
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    const aesKey = crypto.pbkdf2Sync(
      Buffer.from(safeKey), Buffer.from('saltysalt'), 1003, 16, 'sha1'
    );

    const sessionKey = getCookieValue(cookiePath, 'sessionKey', aesKey);
    const lastActiveOrg = getCookieValue(cookiePath, 'lastActiveOrg', aesKey);

    // Extract clean sk-ant-* token
    const tokenMatch = (sessionKey ?? '').match(/(sk-ant-[A-Za-z0-9\-_]+)/);
    if (!tokenMatch) return null;
    const token = tokenMatch[1];

    const cookieHeader = `sessionKey=${token}`;

    // Get org id from cached lastActiveOrg cookie
    let orgId = (lastActiveOrg ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
    if (!orgId) {
      // Fallback: fetch from API via Swift
      const orgsBody = swiftGet('https://claude.ai/api/organizations', cookieHeader);
      if (!orgsBody) return null;
      const orgs = JSON.parse(orgsBody) as any[];
      orgId = orgs?.[0]?.uuid ?? null;
    }
    if (!orgId) return null;

    // Fetch usage limits via Swift (Cloudflare-safe)
    const usageBody = swiftGet(`https://claude.ai/api/organizations/${orgId}/usage`, cookieHeader);
    if (!usageBody) return null;
    const usage = JSON.parse(usageBody) as any;

    // Get account email (best-effort)
    let email: string | null = null;
    try {
      const membersBody = swiftGet(`https://claude.ai/api/organizations/${orgId}/members`, cookieHeader);
      if (membersBody) {
        const members = JSON.parse(membersBody) as any[];
        email = members?.[0]?.user?.email ?? null;
      }
    } catch {}

    return {
      fiveHour: {
        utilization: usage.five_hour?.utilization ?? 0,
        resetsAt: usage.five_hour?.resets_at ?? null,
      },
      sevenDay: {
        utilization: usage.seven_day?.utilization ?? 0,
        resetsAt: usage.seven_day?.resets_at ?? null,
      },
      sevenDayOpus: usage.seven_day_opus ? {
        utilization: usage.seven_day_opus?.utilization ?? 0,
        resetsAt: usage.seven_day_opus?.resets_at ?? null,
      } : null,
      accountEmail: email,
    };
  } catch {
    return null;
  }
}

// Cache wrapper
async function getLimits(): Promise<ClaudeLimits | null> {
  if (limitsCache && Date.now() - limitsCache.at < LIMITS_TTL) return limitsCache.data;
  const data = await fetchClaudeLimits();
  if (data) limitsCache = { data, at: Date.now() };
  return data;
}

const router = Router();

// ── Pricing table (USD per 1M tokens) ────────────────────────────────────────
// Based on CodexBar + official Anthropic pricing

interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number; // 1.25× input
  cacheRead: number;  // 0.10× input
}

function sonnetPrice(inputM: number, outputM: number): ModelPrice {
  return { input: inputM, output: outputM, cacheWrite: inputM * 1.25, cacheRead: inputM * 0.1 };
}

const PRICING: Record<string, ModelPrice> = {
  // Sonnet 4.6
  'claude-sonnet-4-6': sonnetPrice(3, 15),
  // Sonnet 4.5 variants
  'claude-sonnet-4-5': sonnetPrice(3, 15),
  'claude-sonnet-4-5-20250929': sonnetPrice(3, 15),
  'claude-sonnet-4-5-20251101': sonnetPrice(3, 15),
  // Opus 4.6
  'claude-opus-4-6': sonnetPrice(5, 25),
  // Opus 4.5
  'claude-opus-4-5': sonnetPrice(5, 25),
  'claude-opus-4-5-20251101': sonnetPrice(5, 25),
  // Opus 4.1 (legacy)
  'claude-opus-4-1': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-1-20250805': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  // Haiku 4.5
  'claude-haiku-4-5': sonnetPrice(1, 5),
  'claude-haiku-4-5-20251001': sonnetPrice(1, 5),
};

const DEFAULT_PRICE = sonnetPrice(3, 15);

function getPrice(model: string): ModelPrice {
  if (!model) return DEFAULT_PRICE;
  // Exact match
  if (PRICING[model]) return PRICING[model];
  // Prefix match (e.g. "claude-sonnet-4-6-20260101")
  const key = Object.keys(PRICING).find(k => model.startsWith(k));
  return key ? PRICING[key] : DEFAULT_PRICE;
}

function calcCost(p: ModelPrice, u: UsageEntry): number {
  const M = 1_000_000;
  return (
    (u.inputTokens        / M) * p.input      +
    (u.outputTokens       / M) * p.output     +
    (u.cacheWriteTokens   / M) * p.cacheWrite +
    (u.cacheReadTokens    / M) * p.cacheRead
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface UsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

interface DayModel {
  model: string;
  usage: UsageEntry;
  costUSD: number;
}

interface DaySummary {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number;
  models: DayModel[];
}

// ── Parse a single JSONL file ─────────────────────────────────────────────────

async function parseSession(
  filePath: string,
  dayMap: Map<string, Map<string, UsageEntry>>  // date → model → usage
): Promise<void> {
  return new Promise((resolve) => {
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    } catch {
      resolve();
      return;
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.includes('"usage"')) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'assistant') return;

        const usage = obj.message?.usage ?? obj.usage;
        if (!usage) return;

        const ts: string = obj.timestamp ?? obj.message?.timestamp;
        if (!ts) return;

        const date = ts.slice(0, 10); // YYYY-MM-DD
        const model: string = obj.message?.model ?? obj.model ?? 'unknown';

        const entry: UsageEntry = {
          inputTokens:      (usage.input_tokens        ?? usage.inputTokens        ?? 0),
          outputTokens:     (usage.output_tokens       ?? usage.outputTokens       ?? 0),
          cacheWriteTokens: (usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? usage.cacheWriteTokens ?? 0),
          cacheReadTokens:  (usage.cache_read_input_tokens     ?? usage.cacheReadInputTokens     ?? usage.cacheReadTokens  ?? 0),
        };

        if (!dayMap.has(date)) dayMap.set(date, new Map());
        const modelMap = dayMap.get(date)!;
        const existing = modelMap.get(model) ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
        modelMap.set(model, {
          inputTokens:      existing.inputTokens      + entry.inputTokens,
          outputTokens:     existing.outputTokens     + entry.outputTokens,
          cacheWriteTokens: existing.cacheWriteTokens + entry.cacheWriteTokens,
          cacheReadTokens:  existing.cacheReadTokens  + entry.cacheReadTokens,
        });
      } catch { /* skip malformed lines */ }
    });

    rl.on('close', () => resolve());
    rl.on('error', () => resolve());
    stream.on('error', () => resolve());
  });
}

// ── Discover all session JSONL files ─────────────────────────────────────────

function findSessionFiles(): string[] {
  const claudeDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'projects')
    : path.join(os.homedir(), '.claude', 'projects');
  const files: string[] = [];

  let projects: fs.Dirent[];
  try { projects = fs.readdirSync(claudeDir, { withFileTypes: true }); }
  catch { return []; }

  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(claudeDir, proj.name);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(projDir, { withFileTypes: true }); }
    catch { continue; }

    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        files.push(path.join(projDir, e.name));
      }
    }
  }

  return files;
}

// ── Build aggregated response ─────────────────────────────────────────────────

function buildSummaries(dayMap: Map<string, Map<string, UsageEntry>>): DaySummary[] {
  const summaries: DaySummary[] = [];

  for (const [date, modelMap] of dayMap) {
    const models: DayModel[] = [];
    let totalIn = 0, totalOut = 0, totalCW = 0, totalCR = 0, totalCost = 0;

    for (const [model, usage] of modelMap) {
      const p = getPrice(model);
      const cost = calcCost(p, usage);
      models.push({ model, usage, costUSD: cost });
      totalIn   += usage.inputTokens;
      totalOut  += usage.outputTokens;
      totalCW   += usage.cacheWriteTokens;
      totalCR   += usage.cacheReadTokens;
      totalCost += cost;
    }

    models.sort((a, b) => b.costUSD - a.costUSD);

    summaries.push({
      date,
      inputTokens:      totalIn,
      outputTokens:     totalOut,
      cacheWriteTokens: totalCW,
      cacheReadTokens:  totalCR,
      totalTokens:      totalIn + totalOut + totalCW + totalCR,
      costUSD:          totalCost,
      models,
    });
  }

  summaries.sort((a, b) => b.date.localeCompare(a.date));
  return summaries;
}

// ── GET /api/claude/usage ─────────────────────────────────────────────────────

router.get('/api/claude/usage', async (_req, res) => {
  const files = findSessionFiles();
  const dayMap = new Map<string, Map<string, UsageEntry>>();

  // Parse all files in parallel (capped at 20 concurrent to avoid FD exhaustion)
  const BATCH = 20;
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(f => parseSession(f, dayMap)));
  }

  const daily = buildSummaries(dayMap);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo  = new Date(Date.now() - 7  * 86400_000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  function aggregate(from: string, to: string) {
    const days = daily.filter(d => d.date >= from && d.date <= to);
    return {
      costUSD: days.reduce((s, d) => s + d.costUSD, 0),
      totalTokens: days.reduce((s, d) => s + d.totalTokens, 0),
      inputTokens: days.reduce((s, d) => s + d.inputTokens, 0),
      outputTokens: days.reduce((s, d) => s + d.outputTokens, 0),
      cacheWriteTokens: days.reduce((s, d) => s + d.cacheWriteTokens, 0),
      cacheReadTokens: days.reduce((s, d) => s + d.cacheReadTokens, 0),
    };
  }

  res.json({
    today:  aggregate(today, today),
    week:   aggregate(weekAgo, today),
    month:  aggregate(monthAgo, today),
    all:    aggregate('2020-01-01', today),
    daily:  daily.slice(0, 30), // last 30 days
  });
});

// ── GET /api/claude/limits ────────────────────────────────────────────────────

router.get('/api/claude/limits', async (_req, res) => {
  const data = await getLimits();
  if (!data) {
    res.json({ available: false });
    return;
  }
  res.json({ available: true, ...data });
});

export default router;
