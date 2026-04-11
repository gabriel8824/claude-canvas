import { useState, useEffect, useCallback, useRef } from 'react';
import { ws } from '../../ws';
import { GitData } from '../../types';

// ── Git status parsing ────────────────────────────────────────────────────────

interface GitFile {
  path: string;
  x: string; // staged char
  y: string; // unstaged char
}

interface StatusResult {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
}

function parseStatus(raw: string): StatusResult {
  const lines = raw.split('\n').filter(Boolean);
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const staged: GitFile[] = [];
  const unstaged: GitFile[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const rest = line.slice(3);
      const branchPart = rest.split('...')[0];
      branch = branchPart === 'HEAD (no branch)' ? 'detached HEAD' : branchPart;
      if (branch.startsWith('No commits yet on ')) branch = branch.replace('No commits yet on ', '') + ' (sem commits)';
      const aM = rest.match(/ahead (\d+)/);
      const bM = rest.match(/behind (\d+)/);
      if (aM) ahead = Number(aM[1]);
      if (bM) behind = Number(bM[1]);
    } else if (line.length >= 3) {
      const x = line[0];
      const y = line[1];
      const path = line.slice(3).split(' -> ').pop()!; // handle renames
      const f: GitFile = { path, x, y };
      if (x !== ' ' && x !== '?') staged.push(f);
      if (y !== ' ' || x === '?') unstaged.push(f);
    }
  }

  return { branch, ahead, behind, staged, unstaged };
}

// ── Visual helpers ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  M: '#facc15', A: '#4ade80', D: '#f87171',
  R: '#a78bfa', C: '#67e8f9', '?': 'rgba(255,255,255,0.45)',
};
const STATUS_LABEL: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', '?': 'U',
};

function fileLabel(code: string) {
  return STATUS_LABEL[code] ?? code;
}
function fileColor(code: string) {
  return STATUS_COLOR[code] ?? 'rgba(255,255,255,0.6)';
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function colorDiffLine(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return '#4ade80';
  if (line.startsWith('-') && !line.startsWith('---')) return '#f87171';
  if (line.startsWith('@@')) return '#7eb6ff';
  if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) return 'rgba(255,255,255,0.35)';
  return 'rgba(200,215,240,0.7)';
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  nodeId: string;
  data: GitData;
}

type OpLog = { type: 'push' | 'pull'; output: string; done: boolean; code?: number };

export function GitNode({ nodeId, data }: Props) {
  const repoPath = data.repoPath;
  const reqC = useRef(0);

  const [status,      setStatus]      = useState<StatusResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [commitMsg,   setCommitMsg]   = useState('');
  const [committing,  setCommitting]  = useState(false);
  const [commitErr,   setCommitErr]   = useState<string | null>(null);
  const [commitOk,    setCommitOk]    = useState(false);
  const [opLog,       setOpLog]       = useState<OpLog | null>(null);
  const [generating,  setGenerating]  = useState(false);
  const [genErr,      setGenErr]      = useState<string | null>(null);
  const [diff,        setDiff]        = useState<{ file: string; content: string } | null>(null);
  const [logContent,  setLogContent]  = useState('');
  const [section,     setSection]     = useState<'changes' | 'log' | 'branches' | 'stash'>('changes');

  // ── Branches state ──────────────────────────────────────────────────────────
  const [branches,      setBranches]      = useState<Array<{ name: string; current: boolean }>>([]);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError,   setBranchError]   = useState<string | null>(null);

  // ── Stash state ─────────────────────────────────────────────────────────────
  const [stashes,     setStashes]     = useState<Array<{ ref: string; message: string; date: string }>>([]);
  const [stashMsg,    setStashMsg]    = useState('');
  const [stashLoading, setStashLoading] = useState(false);
  const [stashError,  setStashError]  = useState<string | null>(null);

  // ── Refresh status ──────────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    const reqId = `gs-${nodeId}-${++reqC.current}`;
    setLoading(true);
    setError(null);
    const unsub = ws.on('git:status', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub();
      setLoading(false);
      if (msg.error) { setError(msg.error); return; }
      setStatus(parseStatus(msg.raw ?? ''));
    });
    ws.send({ type: 'git:status', reqId, path: repoPath });
  }, [repoPath]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Stage / unstage ─────────────────────────────────────────────────────────

  function stageFile(file: string, all = false) {
    const reqId = `ga-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:add', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub(); refresh();
    });
    ws.send({ type: 'git:add', reqId, path: repoPath, file: all ? '.' : file });
  }

  function unstageFile(file: string) {
    const reqId = `gr-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:restore', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub(); refresh();
    });
    ws.send({ type: 'git:restore', reqId, path: repoPath, file, staged: true });
  }

  // ── Commit ──────────────────────────────────────────────────────────────────

  function commit() {
    if (!commitMsg.trim() || !status?.staged.length) return;
    setCommitting(true); setCommitErr(null); setCommitOk(false);
    const reqId = `gc-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:commit', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub(); setCommitting(false);
      if (msg.error) { setCommitErr(msg.error); return; }
      setCommitOk(true);
      setCommitMsg('');
      setTimeout(() => setCommitOk(false), 2500);
      refresh();
    });
    ws.send({ type: 'git:commit', reqId, path: repoPath, message: commitMsg });
  }

  // ── Generate commit message with AI ────────────────────────────────────────

  async function generateCommitMsg() {
    setGenerating(true);
    setGenErr(null);
    try {
      const r = await fetch('/api/git/generate-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: repoPath }),
      });
      const data = await r.json();
      if (data.error) { setGenErr(data.error); return; }
      setCommitMsg(data.message ?? '');
    } catch (e: any) {
      setGenErr(String(e));
    } finally {
      setGenerating(false);
    }
  }

  // ── Commit and push ─────────────────────────────────────────────────────────

  function commitAndPush() {
    if (!commitMsg.trim() || !status?.staged.length) return;
    setCommitting(true); setCommitErr(null); setCommitOk(false);
    const reqId = `gc-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:commit', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub(); setCommitting(false);
      if (msg.error) { setCommitErr(msg.error); return; }
      setCommitMsg('');
      refresh();
      // Push after commit
      setTimeout(() => startOp('push'), 300);
    });
    ws.send({ type: 'git:commit', reqId, path: repoPath, message: commitMsg });
  }

  // ── Push / Pull ─────────────────────────────────────────────────────────────

  function startOp(op: 'push' | 'pull') {
    const reqId = `gp-${nodeId}-${++reqC.current}`;
    setOpLog({ type: op, output: '', done: false });
    const unsub1 = ws.on(`git:${op}:output`, (msg) => {
      if (msg.reqId !== reqId) return;
      setOpLog(prev => prev ? { ...prev, output: prev.output + msg.data } : null);
    });
    const unsub2 = ws.on(`git:${op}:done`, (msg) => {
      if (msg.reqId !== reqId) return;
      unsub1(); unsub2();
      setOpLog(prev => prev ? { ...prev, done: true, code: msg.code } : null);
      if (msg.code === 0) setTimeout(refresh, 500);
    });
    ws.send({ type: `git:${op}`, reqId, path: repoPath });
  }

  // ── Show diff ───────────────────────────────────────────────────────────────

  function showDiff(file: string, staged: boolean) {
    const reqId = `gd-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:diff', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub();
      setDiff({ file, content: msg.output || '(sem diff)' });
    });
    ws.send({ type: 'git:diff', reqId, path: repoPath, file, staged });
  }

  // ── Load log ────────────────────────────────────────────────────────────────

  function loadLog() {
    const reqId = `gl-${nodeId}-${++reqC.current}`;
    setSection('log');
    const unsub = ws.on('git:log', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub();
      setLogContent(msg.output || '(sem commits)');
    });
    ws.send({ type: 'git:log', reqId, path: repoPath });
  }

  // ── Git init ────────────────────────────────────────────────────────────────

  function initRepo() {
    const reqId = `gi-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:init', (msg) => {
      if (msg.reqId !== reqId) return;
      unsub(); refresh();
    });
    ws.send({ type: 'git:init', reqId, path: repoPath });
  }

  // ── Branches ────────────────────────────────────────────────────────────────

  function loadBranches() {
    setBranchLoading(true);
    setBranchError(null);
    const reqId = `branches-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:branches', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      setBranchLoading(false);
      if (msg.error) { setBranchError(msg.error); return; }
      setBranches(msg.branches || []);
    });
    ws.send({ type: 'git:branches', reqId, path: repoPath });
  }

  function createBranch() {
    if (!newBranchName.trim()) return;
    setBranchError(null);
    const reqId = `branch-create-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:branch:create', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      if (msg.error) { setBranchError(msg.error); return; }
      setNewBranchName('');
      loadBranches();
      refresh();
    });
    ws.send({ type: 'git:branch:create', reqId, path: repoPath, name: newBranchName.trim() });
  }

  function checkoutBranch(name: string) {
    setBranchError(null);
    const reqId = `branch-checkout-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:branch:checkout', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      if (msg.error) { setBranchError(msg.error); return; }
      loadBranches();
      refresh();
    });
    ws.send({ type: 'git:branch:checkout', reqId, path: repoPath, name });
  }

  function deleteBranch(name: string) {
    if (!confirm(`Deletar branch "${name}"?`)) return;
    setBranchError(null);
    const reqId = `branch-delete-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:branch:delete', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      if (msg.error) { setBranchError(msg.error); return; }
      loadBranches();
    });
    ws.send({ type: 'git:branch:delete', reqId, path: repoPath, name });
  }

  // ── Stash ────────────────────────────────────────────────────────────────────

  function loadStashes() {
    setStashLoading(true);
    setStashError(null);
    const reqId = `stash-list-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:stash:list', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      setStashLoading(false);
      if (msg.error) { setStashError(msg.error); return; }
      setStashes(msg.stashes || []);
    });
    ws.send({ type: 'git:stash:list', reqId, path: repoPath });
  }

  function saveStash() {
    setStashError(null);
    const reqId = `stash-save-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:stash:save', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      if (msg.error) { setStashError(msg.error); return; }
      setStashMsg('');
      loadStashes();
      refresh();
    });
    ws.send({ type: 'git:stash:save', reqId, path: repoPath, message: stashMsg || undefined });
  }

  function popStash(ref: string) {
    setStashError(null);
    const reqId = `stash-pop-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:stash:pop', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      if (msg.error) { setStashError(msg.error); return; }
      loadStashes();
      refresh();
    });
    ws.send({ type: 'git:stash:pop', reqId, path: repoPath, ref });
  }

  function dropStash(ref: string) {
    if (!confirm(`Remover ${ref}?`)) return;
    setStashError(null);
    const reqId = `stash-drop-${nodeId}-${++reqC.current}`;
    const unsub = ws.on('git:stash:drop', (msg: any) => {
      if (msg.reqId !== reqId) return;
      unsub();
      if (msg.error) { setStashError(msg.error); return; }
      loadStashes();
    });
    ws.send({ type: 'git:stash:drop', reqId, path: repoPath, ref });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isNotRepo = !!error; // any git error → show the "not a repo" UI
  const totalChanged = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(4,6,16,0.88)', color: 'rgba(215,230,250,0.9)', fontSize: 12 }}>

      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
      }}>
        {/* Branch */}
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(140,190,255,0.9)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? '…' : status ? `⎇ ${status.branch}` : '—'}
        </span>

        {/* Ahead/behind */}
        {status && (status.ahead > 0 || status.behind > 0) && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>
            {status.ahead > 0  && `↑${status.ahead}`}
            {status.behind > 0 && ` ↓${status.behind}`}
          </span>
        )}

        {/* Action buttons */}
        <HBtn title="Pull" onClick={() => startOp('pull')} disabled={!!opLog && !opLog.done}>↓</HBtn>
        <HBtn title="Push" onClick={() => startOp('push')} disabled={!!opLog && !opLog.done}>↑</HBtn>
        <HBtn title="Atualizar" onClick={refresh}>↻</HBtn>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, overflowX: 'auto' }}>
        {(['changes', 'log', 'branches', 'stash'] as const).map(t => (
          <button key={t} onClick={() => {
            setSection(t);
            if (t === 'log') loadLog();
            if (t === 'branches') loadBranches();
            if (t === 'stash') loadStashes();
          }} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '5px 12px', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
            color: section === t ? 'rgba(200,220,255,0.9)' : 'rgba(255,255,255,0.3)',
            borderBottom: `2px solid ${section === t ? 'rgba(120,170,255,0.7)' : 'transparent'}`,
            transition: 'all 0.15s',
          }}>
            {t === 'changes' ? `Alterações${totalChanged ? ` (${totalChanged})` : ''}`
              : t === 'log' ? 'Histórico'
              : t === 'branches' ? `Branches${branches.length ? ` (${branches.length})` : ''}`
              : `Stash${stashes.length ? ` (${stashes.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Diff overlay */}
        {diff && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(4,6,16,0.97)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
              <button onClick={() => setDiff(null)} style={iconBtn}>←</button>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(200,220,255,0.8)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{diff.file}</span>
            </div>
            <pre style={{ flex: 1, margin: 0, padding: '8px 12px', overflow: 'auto', fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {diff.content.split('\n').map((l, i) => (
                <span key={i} style={{ display: 'block', color: colorDiffLine(l) }}>{l || ' '}</span>
              ))}
            </pre>
          </div>
        )}

        {/* Op log (push/pull output) */}
        {opLog && (
          <div style={{ margin: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.35)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', background: 'rgba(255,255,255,0.03)', fontSize: 10, color: 'rgba(255,255,255,0.4)', gap: 6 }}>
              <span style={{ color: opLog.type === 'push' ? 'rgba(140,190,255,0.8)' : 'rgba(120,240,160,0.8)' }}>
                {opLog.type === 'push' ? '↑ push' : '↓ pull'}
              </span>
              {opLog.done && (
                <span style={{ color: opLog.code === 0 ? '#4ade80' : '#f87171' }}>
                  {opLog.code === 0 ? '✓ concluído' : '✗ erro'}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button onClick={() => setOpLog(null)} style={{ ...iconBtn, fontSize: 12 }}>×</button>
            </div>
            <pre style={{ margin: 0, padding: '6px 10px', fontSize: 10, fontFamily: 'monospace', color: 'rgba(180,210,190,0.85)', maxHeight: 90, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {opLog.output || '…'}
            </pre>
          </div>
        )}

        {section === 'log' ? (
          /* ── History ── */
          <pre style={{ margin: 0, padding: '10px 12px', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6, color: 'rgba(200,215,240,0.8)', whiteSpace: 'pre-wrap', flex: 1 }}>
            {logContent || 'Carregando…'}
          </pre>
        ) : section === 'branches' ? (
          /* ── Branches ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* New branch input */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, display: 'flex', gap: 6 }}>
              <input
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createBranch(); }}
                placeholder="Nova branch…"
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
                  padding: '5px 8px', fontSize: 11, color: 'rgba(215,230,250,0.9)',
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={createBranch}
                disabled={!newBranchName.trim()}
                style={{
                  background: 'rgba(80,160,80,0.2)', border: '1px solid rgba(74,222,128,0.3)',
                  borderRadius: 6, color: 'rgba(134,239,172,0.95)', cursor: newBranchName.trim() ? 'pointer' : 'not-allowed',
                  padding: '5px 10px', fontSize: 11, fontWeight: 600,
                  opacity: newBranchName.trim() ? 1 : 0.4, whiteSpace: 'nowrap',
                }}
              >
                + Criar
              </button>
            </div>
            {branchError && (
              <div style={{ padding: '4px 10px', fontSize: 11, color: '#f87171', fontFamily: 'monospace', flexShrink: 0 }}>{branchError}</div>
            )}
            {/* Branch list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {branchLoading ? (
                <div style={{ padding: 16, color: 'rgba(255,255,255,0.25)', textAlign: 'center', fontSize: 12 }}>Carregando…</div>
              ) : branches.length === 0 ? (
                <div style={{ padding: 16, color: 'rgba(255,255,255,0.25)', textAlign: 'center', fontSize: 12 }}>Nenhuma branch encontrada</div>
              ) : (
                branches.map(b => (
                  <BranchRow
                    key={b.name}
                    branch={b}
                    onCheckout={() => checkoutBranch(b.name)}
                    onDelete={() => deleteBranch(b.name)}
                  />
                ))
              )}
            </div>
          </div>
        ) : section === 'stash' ? (
          /* ── Stash ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Stash save input */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, display: 'flex', gap: 6 }}>
              <input
                value={stashMsg}
                onChange={e => setStashMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveStash(); }}
                placeholder="Mensagem (opcional)…"
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
                  padding: '5px 8px', fontSize: 11, color: 'rgba(215,230,250,0.9)',
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={saveStash}
                style={{
                  background: 'rgba(60,120,220,0.2)', border: '1px solid rgba(100,160,255,0.3)',
                  borderRadius: 6, color: 'rgba(140,190,255,0.9)', cursor: 'pointer',
                  padding: '5px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                Salvar stash
              </button>
            </div>
            {stashError && (
              <div style={{ padding: '4px 10px', fontSize: 11, color: '#f87171', fontFamily: 'monospace', flexShrink: 0 }}>{stashError}</div>
            )}
            {/* Stash list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {stashLoading ? (
                <div style={{ padding: 16, color: 'rgba(255,255,255,0.25)', textAlign: 'center', fontSize: 12 }}>Carregando…</div>
              ) : stashes.length === 0 ? (
                <div style={{ padding: 16, color: 'rgba(255,255,255,0.25)', textAlign: 'center', fontSize: 12 }}>Nenhum stash</div>
              ) : (
                stashes.map(s => (
                  <StashRow
                    key={s.ref}
                    stash={s}
                    onPop={() => popStash(s.ref)}
                    onDrop={() => dropStash(s.ref)}
                  />
                ))
              )}
            </div>
          </div>
        ) : isNotRepo ? (
          /* ── Not a git repo ── */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, padding: 24 }}>
            <span style={{ fontSize: 28 }}>🔀</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
              Esta pasta não é um repositório git.
            </span>
            {error && (
              <span style={{ fontSize: 10, color: 'rgba(248,113,113,0.7)', fontFamily: 'monospace', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
                {error}
              </span>
            )}
            <button onClick={initRepo} style={{
              background: 'rgba(120,100,255,0.2)', border: '1px solid rgba(160,130,255,0.35)',
              borderRadius: 8, color: 'rgba(190,170,255,0.95)', cursor: 'pointer',
              padding: '7px 16px', fontSize: 12, fontWeight: 500,
            }}>
              Inicializar repositório
            </button>
          </div>
        ) : (
          /* ── Changes ── */
          <div style={{ flex: 1 }}>

            {/* Staged changes */}
            {(status?.staged.length ?? 0) > 0 && (
              <Section
                label={`Staged (${status!.staged.length})`}
                action={{ label: 'Remover tudo', onClick: () => status!.staged.forEach(f => unstageFile(f.path)) }}
              >
                {status!.staged.map(f => (
                  <FileRow
                    key={'s-' + f.path} file={f.path} code={f.x}
                    action={{ label: '−', title: 'Remover do stage', onClick: () => unstageFile(f.path) }}
                    onDiff={() => showDiff(f.path, true)}
                  />
                ))}
              </Section>
            )}

            {/* Unstaged changes */}
            {(status?.unstaged.length ?? 0) > 0 && (
              <Section
                label={`Alterações (${status!.unstaged.length})`}
                action={{ label: 'Stage tudo', onClick: () => stageFile('.', true) }}
              >
                {status!.unstaged.map(f => (
                  <FileRow
                    key={'u-' + f.path} file={f.path} code={f.x === '?' ? '?' : f.y}
                    action={{ label: '+', title: 'Adicionar ao stage', onClick: () => stageFile(f.path) }}
                    onDiff={f.x !== '?' ? () => showDiff(f.path, false) : undefined}
                  />
                ))}
              </Section>
            )}

            {/* Clean state */}
            {status && status.staged.length === 0 && status.unstaged.length === 0 && (
              <div style={{ padding: '28px 16px', color: 'rgba(255,255,255,0.25)', textAlign: 'center', fontSize: 12 }}>
                ✓ Nenhuma alteração
              </div>
            )}

            {loading && !status && (
              <div style={{ padding: 16, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>Carregando…</div>
            )}
          </div>
        )}
      </div>

      {/* ── Commit bar ── */}
      {section === 'changes' && !isNotRepo && (
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Textarea + AI button row */}
          <div style={{ position: 'relative' }}>
            <textarea
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commit(); }}
              placeholder="Mensagem do commit (⌘Enter para confirmar)"
              rows={2}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${commitErr ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 8, padding: '7px 36px 7px 10px', resize: 'none',
                color: 'rgba(215,230,250,0.9)', fontSize: 12, fontFamily: 'inherit',
                outline: 'none', width: '100%', boxSizing: 'border-box',
              }}
            />
            <button
              title="Gerar mensagem com IA"
              onClick={generateCommitMsg}
              disabled={generating || !status?.staged.length}
              style={{
                position: 'absolute', right: 6, top: 6,
                background: 'rgba(160,100,255,0.15)',
                border: '1px solid rgba(180,120,255,0.3)',
                borderRadius: 6, cursor: generating || !status?.staged.length ? 'not-allowed' : 'pointer',
                color: generating ? 'rgba(180,120,255,0.4)' : 'rgba(200,160,255,0.9)',
                width: 24, height: 24, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: !status?.staged.length ? 0.35 : 1,
                transition: 'all 0.15s',
              }}
            >
              {generating ? '…' : '✨'}
            </button>
          </div>
          {genErr && (
            <div style={{ fontSize: 11, color: '#f87171', fontFamily: 'monospace', padding: '3px 4px' }}>{genErr}</div>
          )}
          {commitErr && (
            <div style={{ fontSize: 11, color: '#f87171', fontFamily: 'monospace', padding: '3px 4px' }}>{commitErr}</div>
          )}
          {commitOk && (
            <div style={{ fontSize: 11, color: '#4ade80', padding: '2px 4px' }}>✓ Commit realizado!</div>
          )}
          {/* Action buttons row */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={commit}
              disabled={!commitMsg.trim() || !status?.staged.length || committing}
              style={{
                flex: 1,
                background: 'rgba(80,160,80,0.22)',
                border: '1px solid rgba(74,222,128,0.3)',
                borderRadius: 8, color: 'rgba(134,239,172,0.95)',
                cursor: commitMsg.trim() && status?.staged.length ? 'pointer' : 'not-allowed',
                padding: '7px 0', fontSize: 12, fontWeight: 600,
                opacity: commitMsg.trim() && status?.staged.length ? 1 : 0.4,
                transition: 'opacity 0.15s',
              }}
            >
              {committing ? 'Commitando…' : `✓ Commit${status?.staged.length ? ` (${status.staged.length})` : ''}`}
            </button>
            <button
              onClick={commitAndPush}
              disabled={!commitMsg.trim() || !status?.staged.length || committing || (!!opLog && !opLog.done)}
              title="Commit e Push"
              style={{
                background: 'rgba(60,120,220,0.2)',
                border: '1px solid rgba(100,160,255,0.3)',
                borderRadius: 8, color: 'rgba(140,190,255,0.9)',
                cursor: commitMsg.trim() && status?.staged.length && !committing ? 'pointer' : 'not-allowed',
                padding: '7px 12px', fontSize: 12, fontWeight: 600,
                opacity: commitMsg.trim() && status?.staged.length && !committing ? 1 : 0.4,
                transition: 'opacity 0.15s', whiteSpace: 'nowrap',
              }}
            >
              ↑ Push
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, action, children }: {
  label: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', padding: '5px 10px 3px',
        fontSize: 10, color: 'rgba(255,255,255,0.35)',
        letterSpacing: '0.07em', textTransform: 'uppercase',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <span style={{ flex: 1 }}>{label}</span>
        {action && (
          <button onClick={action.onClick} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.3)', fontSize: 10, padding: '1px 4px',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.75)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.3)'; }}
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function FileRow({ file, code, action, onDiff }: {
  file: string;
  code: string;
  action: { label: string; title: string; onClick: () => void };
  onDiff?: () => void;
}) {
  const [hov, setHov] = useState(false);
  const name = file.split('/').pop()!;
  const dir  = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px',
        background: hov ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.1s', cursor: onDiff ? 'pointer' : 'default',
      }}
      onClick={onDiff}
    >
      {/* Status badge */}
      <span style={{
        fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
        color: fileColor(code), minWidth: 12, textAlign: 'center',
      }}>
        {fileLabel(code)}
      </span>

      {/* File name */}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'rgba(200,215,240,0.9)', fontSize: 12 }}>{name}</span>
        {dir && <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}> {dir}</span>}
      </span>

      {/* Stage/unstage button */}
      {hov && (
        <button
          title={action.title}
          onClick={e => { e.stopPropagation(); action.onClick(); }}
          style={{
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 5, color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
            width: 20, height: 20, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function BranchRow({ branch, onCheckout, onDelete }: {
  branch: { name: string; current: boolean };
  onCheckout: () => void;
  onDelete: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
        background: branch.current ? 'rgba(126,182,255,0.07)' : hov ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.1s',
        borderLeft: branch.current ? '2px solid rgba(126,182,255,0.6)' : '2px solid transparent',
      }}
    >
      <span style={{ fontSize: 10, color: branch.current ? 'rgba(140,190,255,0.9)' : 'rgba(255,255,255,0.3)', minWidth: 10 }}>
        {branch.current ? '●' : '○'}
      </span>
      <span style={{
        flex: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: branch.current ? 'rgba(200,220,255,0.95)' : 'rgba(200,215,240,0.75)',
        fontWeight: branch.current ? 600 : 400,
      }}>
        {branch.name}
      </span>
      {hov && !branch.current && (
        <>
          <button
            title="Checkout"
            onClick={onCheckout}
            style={{
              background: 'rgba(80,160,80,0.18)', border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 5, color: 'rgba(134,239,172,0.9)', cursor: 'pointer',
              padding: '2px 8px', fontSize: 10, fontWeight: 600,
            }}
          >
            Checkout
          </button>
          <button
            title="Deletar branch"
            onClick={onDelete}
            style={{
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 5, color: 'rgba(248,113,113,0.8)', cursor: 'pointer',
              width: 20, height: 20, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

function StashRow({ stash, onPop, onDrop }: {
  stash: { ref: string; message: string; date: string };
  onPop: () => void;
  onDrop: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 10px',
        background: hov ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.1s', borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}
    >
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(200,215,240,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'rgba(140,190,255,0.7)', marginRight: 6 }}>{stash.ref}</span>
          {stash.message}
        </div>
        {stash.date && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2, fontFamily: 'monospace' }}>
            {stash.date.slice(0, 10)}
          </div>
        )}
      </div>
      {hov && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            title="Pop (aplicar e remover)"
            onClick={onPop}
            style={{
              background: 'rgba(80,160,80,0.18)', border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 5, color: 'rgba(134,239,172,0.9)', cursor: 'pointer',
              padding: '2px 8px', fontSize: 10, fontWeight: 600,
            }}
          >
            Pop
          </button>
          <button
            title="Drop (remover)"
            onClick={onDrop}
            style={{
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 5, color: 'rgba(248,113,113,0.8)', cursor: 'pointer',
              padding: '2px 8px', fontSize: 10,
            }}
          >
            Drop
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 5, color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
  width: 22, height: 22, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function HBtn({ children, title, onClick, disabled }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      title={title} onClick={onClick} disabled={disabled}
      style={{ ...iconBtn, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.9)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)'; }}
    >
      {children}
    </button>
  );
}
