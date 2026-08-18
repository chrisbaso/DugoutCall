import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { createLiveKitVoiceToken, createRoomToken, verifyRoomToken } from './auth.js';
import { buildClientConfig } from './config.js';
import { RoomDiagnostics } from './diagnostics.js';
import { RoomStore } from './rooms.js';
import { isUserRole } from './types.js';

export type DugoutCallAppOptions = {
  tokenSecret: string;
  rooms?: RoomStore;
  diagnostics?: RoomDiagnostics;
  demoWebPath?: string;
};

export function createDugoutCallApp(options: DugoutCallAppOptions) {
  const rooms = options.rooms ?? new RoomStore();
  const diagnostics = options.diagnostics ?? new RoomDiagnostics();
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  app.set('trust proxy', 1);
  app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
  app.use(express.json({ limit: '32kb' }));
  if (options.demoWebPath) app.use(express.static(options.demoWebPath));

  const roomRateLimit: express.RequestHandler = (request, response, next) => {
    const now = Date.now();
    const key = `${request.ip}:${request.path.includes('/join') ? 'join' : 'create'}`;
    const current = rateBuckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 10 * 60_000 } : current;
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    if (bucket.count > 30) {
      response.status(429).json({ error: 'Too many room attempts. Try again later.' });
      return;
    }
    next();
  };

  app.get('/health', (_request, response) => response.json({ ok: true, service: 'dugoutcall-server' }));
  app.get('/config', (_request, response) => response.json(buildClientConfig()));

  app.post('/rooms', roomRateLimit, async (request, response) => {
    try {
      const room = rooms.createRoom({
        coachName: request.body?.coachName,
        teamName: request.body?.teamName,
        mode: request.body?.mode === 'practice' ? 'practice' : 'game'
      });
      diagnostics.record(room.code, { kind: 'room_created', role: 'coach' });
      const coach = room.coach;
      if (!coach) {
        response.status(500).json({ error: 'Coach participant was not created' });
        return;
      }
      response.status(201).json({
        code: room.code,
        mode: room.mode,
        expiresAt: room.expiresAt,
        token: createRoomToken({ secret: options.tokenSecret, roomCode: room.code, role: 'coach', expiresAt: room.expiresAt }),
        livekit: await createLiveKitVoiceToken({
          roomCode: room.code,
          role: 'coach',
          participantId: coach.id,
          displayName: coach.displayName,
          expiresAt: room.expiresAt
        })
      });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create room' });
    }
  });

  app.post('/rooms/:code/join', roomRateLimit, async (request, response) => {
    try {
      const role = request.body?.role;
      if (!isUserRole(role)) {
        response.status(400).json({ error: 'Role must be coach or catcher' });
        return;
      }
      const participant = rooms.joinRoom(request.params.code, { role, displayName: request.body?.displayName });
      const room = rooms.getRoom(request.params.code);
      diagnostics.record(room.code, { kind: 'http_join', role: participant.role });
      response.json({
        code: room.code,
        role: participant.role,
        mode: room.mode,
        expiresAt: room.expiresAt,
        token: createRoomToken({ secret: options.tokenSecret, roomCode: room.code, role: participant.role, expiresAt: room.expiresAt }),
        livekit: await createLiveKitVoiceToken({
          roomCode: room.code,
          role: participant.role,
          participantId: participant.id,
          displayName: participant.displayName,
          expiresAt: room.expiresAt
        })
      });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to join room' });
    }
  });

  app.get('/rooms/:code/diagnostics', (request, response) => {
    try {
      rooms.getRoom(request.params.code);
      const header = request.header('authorization') ?? '';
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      const claims = verifyRoomToken(token, options.tokenSecret);
      if (claims.roomCode !== request.params.code) {
        response.status(403).json({ error: 'Room credential does not match room' });
        return;
      }
      response.json(diagnostics.snapshot(request.params.code));
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : 'Room diagnostics unavailable' });
    }
  });

  if (options.demoWebPath) {
    app.get('*', (_request, response) => response.sendFile(path.join(options.demoWebPath!, 'index.html')));
  }
  return { app, rooms, diagnostics };
}
