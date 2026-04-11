import express from 'express';
import type { TerminalManager } from '../terminal';

export function createProcessesRouter(termManager: TerminalManager): express.Router {
  const router = express.Router();

  // List all running processes
  router.get('/api/processes', (_req, res) => {
    const processes = termManager.listProcesses();
    res.json({ processes });
  });

  // Kill a process by id
  router.delete('/api/processes/:id', (req, res) => {
    const { id } = req.params;
    try {
      termManager.kill(id);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'Process not found' });
    }
  });

  return router;
}
