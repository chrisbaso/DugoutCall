import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { createRoomToken } from './auth.js';
import { buildClientConfig } from './config.js';
import { RoomStore } from './rooms.js';
import { attachWebSocketServer } from './websocket.js';
import type { UserRole } from './types.js';

const port = Number(process.env.PORT ?? 8787);
const tokenSecret = process.env.DUGOUTCALL_TOKEN_SECRET ?? 'local-development-secret-change-me';
const rooms = new RoomStore();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoWebPath = path.resolve(__dirname, '../../demo-web');

app.use(cors());
app.use(express.json());
app.use(express.static(demoWebPath));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'dugoutcall-server' });
});

app.get('/config', (_request, response) => {
  response.json(buildClientConfig());
});

app.post('/rooms', (request, response) => {
  const room = rooms.createRoom({
    coachName: request.body?.coachName,
    teamName: request.body?.teamName,
    mode: request.body?.mode === 'practice' ? 'practice' : 'game'
  });
  response.status(201).json({
    code: room.code,
    mode: room.mode,
    expiresAt: room.expiresAt,
    token: createRoomToken({
      secret: tokenSecret,
      roomCode: room.code,
      role: 'coach',
      expiresAt: room.expiresAt
    })
  });
});

app.post('/rooms/:code/join', (request, response) => {
  try {
    const role = request.body?.role as UserRole;
    const participant = rooms.joinRoom(request.params.code, {
      role,
      displayName: request.body?.displayName
    });
    const room = rooms.getRoom(request.params.code);
    response.json({
      code: room.code,
      role: participant.role,
      mode: room.mode,
      expiresAt: room.expiresAt,
      token: createRoomToken({
        secret: tokenSecret,
        roomCode: room.code,
        role: participant.role,
        expiresAt: room.expiresAt
      })
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Unable to join room'
    });
  }
});

app.get('*', (_request, response) => {
  response.sendFile(path.join(demoWebPath, 'index.html'));
});

const server = http.createServer(app);
attachWebSocketServer(server, rooms);

server.listen(port, () => {
  console.log(`DugoutCall server listening on http://localhost:${port}`);
});
