import express from 'express';
import { loadState, saveState, listWorkspaces, loadWorkspace, saveWorkspace, deleteWorkspace, renameWorkspace } from '../db';

const router = express.Router();

// Canvas state persistence
router.get('/api/state', (_req, res) => {
  const state = loadState();
  res.json({ state });
});

router.post('/api/state', (req, res) => {
  try {
    saveState(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Beacon endpoint: called by navigator.sendBeacon on page unload (body is text/plain)
router.post('/api/state-beacon', express.text({ type: '*/*' }), (req, res) => {
  try {
    const state = JSON.parse(req.body as string);
    saveState(state);
    res.status(204).end();
  } catch {
    res.status(204).end(); // always 204 — browser ignores beacon responses
  }
});

// ── Workspace endpoints ───────────────────────────────────────────────────────

router.get('/api/workspaces', (_req, res) => {
  try {
    const workspaces = listWorkspaces();
    res.json({ workspaces });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/workspaces/:name', (req, res) => {
  try {
    const state = loadWorkspace(req.params.name);
    res.json({ state });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/workspaces/:name', (req, res) => {
  try {
    saveWorkspace(req.params.name, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.delete('/api/workspaces/:name', (req, res) => {
  try {
    const all = listWorkspaces();
    if (all.length <= 1) {
      res.status(400).json({ error: 'Cannot delete the last workspace' });
      return;
    }
    deleteWorkspace(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post('/api/workspaces/:name/rename', (req, res) => {
  try {
    const { newName } = req.body as { newName: string };
    if (!newName || typeof newName !== 'string' || !newName.trim()) {
      res.status(400).json({ error: 'newName is required' });
      return;
    }
    renameWorkspace(req.params.name, newName.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Probe: check if a URL is reachable (used by preview to wait for dev server)
router.get('/api/probe', async (req, res) => {
  const url = (req.query.url as string) || '';
  if (!url || !url.startsWith('http')) { res.json({ ok: false }); return; }
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { method: 'GET', signal: ctrl.signal });
    clearTimeout(tid);
    res.json({ ok: r.status > 0 });
  } catch {
    res.json({ ok: false });
  }
});

export default router;
