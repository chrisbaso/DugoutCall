import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { createLiveKitVoiceToken, createRoomToken } from './auth.js';
import { buildClientConfig } from './config.js';
import { RoomDiagnostics } from './diagnostics.js';
import { RoomStore } from './rooms.js';
import { attachWebSocketServer } from './websocket.js';
import type { UserRole } from './types.js';

const port = Number(process.env.PORT ?? 8787);
const tokenSecret = process.env.DUGOUTCALL_TOKEN_SECRET ?? 'local-development-secret-change-me';
const rooms = new RoomStore();
const diagnostics = new RoomDiagnostics();
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

app.post('/rooms', async (request, response) => {
  try {
    const room = rooms.createRoom({
      coachName: request.body?.coachName,
      teamName: request.body?.teamName,
      mode: request.body?.mode === 'practice' ? 'practice' : 'game'
    });
    diagnostics.record(room.code, {
      kind: 'room_created',
      role: 'coach',
      detail: request.body?.teamName
    });
    const coach = room.coach;
    if (!coach) {
      response.status(500).json({ error: 'Coach participant was not created' });
      return;
    }
    response.status(201).json({
      code: room.code,
      mode: room.mode,
      expiresAt: room.expiresAt,
      token: createRoomToken({
        secret: tokenSecret,
        roomCode: room.code,
        role: 'coach',
        expiresAt: room.expiresAt
      }),
      livekit: await createLiveKitVoiceToken({
        roomCode: room.code,
        role: 'coach',
        participantId: coach.id,
        displayName: coach.displayName,
        expiresAt: room.expiresAt
      })
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to create room'
    });
  }
});

app.post('/rooms/:code/join', async (request, response) => {
  try {
    const role = request.body?.role as UserRole;
    const participant = rooms.joinRoom(request.params.code, {
      role,
      displayName: request.body?.displayName
    });
    const room = rooms.getRoom(request.params.code);
    diagnostics.record(room.code, {
      kind: 'http_join',
      role: participant.role,
      detail: request.body?.displayName
    });
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
      }),
      livekit: await createLiveKitVoiceToken({
        roomCode: room.code,
        role: participant.role,
        participantId: participant.id,
        displayName: participant.displayName,
        expiresAt: room.expiresAt
      })
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Unable to join room'
    });
  }
});

app.get('/rooms/:code/diagnostics', (request, response) => {
  try {
    rooms.getRoom(request.params.code);
    response.json(diagnostics.snapshot(request.params.code));
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : 'Room diagnostics unavailable'
    });
  }
});

app.get('*', (_request, response) => {
  response.sendFile(path.join(demoWebPath, 'index.html'));
});

const server = http.createServer(app);
attachWebSocketServer(server, rooms, diagnostics);

server.listen(port, () => {
  console.log(`DugoutCall server listening on http://localhost:${port}`);
});
