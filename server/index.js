import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { GameService } from './game-service.js';
import { MemoryRoomStore, MongoRoomStore } from './store.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(currentDir, '..');
const port = Number(process.env.PORT || 8787);
const store = process.env.MONGODB_URI
  ? new MongoRoomStore(process.env.MONGODB_URI, process.env.MONGODB_DATABASE || 'mindsync')
  : new MemoryRoomStore();

if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Using in-memory rooms; active matches will be lost if this server restarts.');
}

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'mindsync', time: new Date().toISOString() }));

const distDir = path.join(projectDir, 'dist');
app.use(express.static(distDir, { index: false, maxAge: '1h' }));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (error) => { if (error) next(); });
});

const server = createServer(app);
const io = new SocketServer(server, {
  maxHttpBufferSize: 16_000,
  pingInterval: 20_000,
  pingTimeout: 25_000,
});
const game = new GameService({ store, io });
io.on('connection', (socket) => game.attach(socket));

await store.connect();
await game.restoreRooms();
server.listen(port, '0.0.0.0', () => console.log(`MindSync listening on 0.0.0.0:${port}`));

const shutdown = async () => {
  io.close(async () => {
    await store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

