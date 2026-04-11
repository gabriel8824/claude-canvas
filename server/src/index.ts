import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { TerminalManager } from './terminal';
import { registerWsHandlers } from './ws/handlers';
import filesRouter from './routes/files';
import gitRouter from './routes/git';
import stateRouter from './routes/state';
import aiRouter from './routes/ai';
import dbRouter from './routes/db';
import { createProcessesRouter } from './routes/processes';
import usageRouter from './routes/usage';

const PORT = Number(process.env.PORT || 3001);

const app = express();
const allowedOrigins = [
  `http://localhost:${PORT}`,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Serve client build
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// Mount route modules
app.use(filesRouter);
app.use(gitRouter);
app.use(stateRouter);
app.use(aiRouter);
app.use(dbRouter);
app.use(usageRouter);

// WebSocket + terminal manager
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const termManager = new TerminalManager();

registerWsHandlers(wss, termManager);

// Process manager routes (needs termManager)
app.use(createProcessesRouter(termManager));

// Centralized error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Claude Canvas server running. Open the dev client at http://localhost:5173');
  });
});

server.listen(PORT, () => {
  console.log(`\n🎨 Claude Canvas server running at http://localhost:${PORT}\n`);
});

process.on('SIGTERM', () => { termManager.killAll(); process.exit(0); });
process.on('SIGINT', () => { termManager.killAll(); process.exit(0); });
