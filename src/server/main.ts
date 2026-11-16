// MODULE: server entry (Express and Socket.io, /health, bot training log endpoints, serves the client) | DEPENDS ON: server/bots/scheduler, server/bots/sim, server/bots/trainingLog, server/net, server/persistence, server/socket | USED BY: none
import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { initBots } from './bots/scheduler';
import { simulateGame } from './bots/sim';
import { exportTrainingLogsJsonl, getAllTrainingLogs, getTrainingLogForRoom } from './bots/trainingLog';
import { setIo } from './net';
import { exportMemoryCode, importMemoryCode } from './persistence';
import { registerSocketHandlers } from './socket';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });
setIo(io);
initBots();

app.get('/health', (req, res) => res.status(200).send('ok'));

// S0.15 Cross-game bot memory & player profile portable export/import for Render free tier
app.get('/api/memory/export', (req, res) => {
  try {
    const code = exportMemoryCode();
    res.status(200).json({ ok: true, code });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Export failed' });
  }
});

app.post('/api/memory/import', (req, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const result = importMemoryCode(code);
    res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || 'Import failed' });
  }
});

// AI Bot Training Data export endpoint (JSONL or JSON)
app.get('/api/bot-training-logs', (req, res) => {
  const room = typeof req.query.room === 'string' ? req.query.room.trim().toUpperCase() : '';
  const format = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'jsonl';
  if (format === 'json') {
    const data = room ? (getTrainingLogForRoom(room) ? [getTrainingLogForRoom(room)] : []) : getAllTrainingLogs();
    res.status(200).json({ count: data.length, games: data });
    return;
  }
  const jsonl = exportTrainingLogsJsonl(room || undefined);
  const filename = room ? `bot_training_${room}.jsonl` : `bot_training_logs_${Date.now()}.jsonl`;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(jsonl);
});

// Generate and log simulated bot-vs-bot training games on demand
app.post('/api/bot-training-sim', (req, res) => {
  const games = Math.max(1, Math.min(20, Number(req.body?.games) || 3));
  const players = Math.max(2, Math.min(6, Number(req.body?.players) || 4));
  const baseSeed = Number(req.body?.seed) || Math.floor(Math.random() * 100000);
  const generated = [];
  for (let i = 0; i < games; i++) {
    const sim = simulateGame({
      seed: baseSeed + i,
      players,
      tiers: ['main', 'secondary', 'overload', 'secondary'],
      recordTrainingLog: true
    });
    if (sim.trainingLog) generated.push(sim.trainingLog);
  }
  res.status(200).json({ ok: true, generatedCount: generated.length, games: generated });
});

// Bundled output is dist/main.js (CJS), so __dirname is dist/ and static files live in dist/public.
app.use(express.static(path.join(__dirname, 'public')));

registerSocketHandlers(io);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Colonist-Style HexSettlers (Hard Bots + Full Trade) running at http://0.0.0.0:${PORT}`);
});

const shutdown = (): void => {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 200).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

