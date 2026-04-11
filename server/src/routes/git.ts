import express from 'express';
import { spawn } from 'child_process';
import { exec } from 'child_process';
import { toUnix } from '../files';
import { resolvePath } from '../utils';

const router = express.Router();

// Native folder picker (macOS + Windows + Linux)
router.get('/api/pick-folder', (_req, res) => {
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description='Selecione uma pasta';if($d.ShowDialog()-eq'OK'){$d.SelectedPath}`;
    exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 120_000 }, (err, stdout) => {
      res.json({ path: err ? null : toUnix(stdout.trim()) || null });
    });
  } else if (process.platform === 'darwin') {
    exec(
      `osascript -e 'tell app "Finder" to POSIX path of (choose folder with prompt "Selecione uma pasta")'`,
      { timeout: 120_000 },
      (err, stdout) => res.json({ path: err ? null : toUnix(stdout.trim()) || null })
    );
  } else {
    exec('zenity --file-selection --directory --title="Selecione uma pasta"', { timeout: 120_000 }, (err, stdout) => {
      if (!err && stdout.trim()) { res.json({ path: stdout.trim() }); return; }
      exec('kdialog --getexistingdirectory ~', { timeout: 120_000 }, (err2, stdout2) => {
        res.json({ path: !err2 && stdout2.trim() ? stdout2.trim() : null });
      });
    });
  }
});

// AI commit message generation
router.post('/api/git/generate-commit', (req, res) => {
  const { path: p } = req.body as { path: string };
  if (!p) { res.status(400).json({ error: 'missing path' }); return; }
  const cwd = resolvePath(p);

  const gitProc = spawn('git', ['-C', cwd, 'diff', '--staged']);
  let diff = '', diffErr = '';
  gitProc.stdout.on('data', (d: Buffer) => { diff += d.toString(); });
  gitProc.stderr.on('data', (d: Buffer) => { diffErr += d.toString(); });
  gitProc.on('error', (err) => res.status(500).json({ error: err.message }));
  gitProc.on('close', async (code) => {
    const err = code !== 0 ? new Error(diffErr || `git exit ${code}`) : null;
    if (err) { res.status(500).json({ error: err.message }); return; }

    const trimmedDiff = diff.slice(0, 12000);

    if (!trimmedDiff.trim()) {
      res.json({ error: 'Nenhuma alteração staged para gerar mensagem.' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' });
      return;
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `You are a Git commit message generator. Given the following diff, write a concise, descriptive commit message following conventional commits format (e.g. "feat: add user login", "fix: resolve null pointer in auth"). Output ONLY the commit message, no explanation, no quotes.\n\nDiff:\n${trimmedDiff}`,
          }],
        }),
      });

      const data = await response.json() as any;
      if (data.error) {
        res.json({ error: data.error.message ?? 'Erro da API Anthropic' });
        return;
      }

      const message = data.content?.[0]?.text?.trim() ?? '';
      res.json({ message });
    } catch (fetchErr: any) {
      res.status(500).json({ error: fetchErr.message });
    }
  });
});

export default router;
