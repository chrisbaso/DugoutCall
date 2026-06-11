import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { WebSocketServer } from 'ws';
import { createLiveKitVoiceToken, createRoomToken, verifyRoomToken } from './auth.js';
import { buildClientConfig } from './config.js';
import { RoomDiagnostics } from './diagnostics.js';
import { CodeLockout, SlidingWindowRateLimiter } from './rateLimit.js';
import { RoomStore } from './rooms.js';
import { attachWebSocketServer, type WebSocketServerOptions } from './websocket.js';
import type { UserRole } from './types.js';

export interface DugoutServerOptions {
  tokenSecret: string;
  isProduction?: boolean;
  corsOrigins?: string[];
  rooms?: RoomStore;
  diagnostics?: RoomDiagnostics;
  createRoomLimit?: { limit: number; windowMs: number };
  joinLimit?: { limit: number; windowMs: number };
  lockout?: { threshold: number; lockMs: number };
  websocket?: Partial<Pick<WebSocketServerOptions, 'pingIntervalMs' | 'sweepIntervalMs' | 'now'>>;
}

export interface DugoutServer {
  app: express.Express;
  server: http.Server;
  wss: WebSocketServer;
  rooms: RoomStore;
  diagnostics: RoomDiagnostics;
}

// Error messages that are user-actionable and safe to pass through in production.
const safeClientErrors = new Set(['Room not found', 'Room expired', 'Room already has a catcher']);

export function createDugoutServer(options: DugoutServerOptions): DugoutServer {
  const { tokenSecret } = options;
  const isProduction = options.isProduction ?? false;
  const rooms = options.rooms ?? new RoomStore();
  const diagnostics = options.diagnostics ?? new RoomDiagnostics();
  const createLimiter = new SlidingWindowRateLimiter(
    options.createRoomLimit ?? { limit: 10, windowMs: 60 * 60_000 }
  );
  const joinLimiter = new SlidingWindowRateLimiter(
    options.joinLimit ?? { limit: 10, windowMs: 60_000 }
  );
  const lockout = new CodeLockout(options.lockout ?? {});

  const app = express();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const demoWebPath = path.resolve(__dirname, '../../demo-web');

  if (isProduction) app.set('trust proxy', 1);

  if (options.corsOrigins?.length) {
    app.use(cors({ origin: options.corsOrigins }));
  } else if (!isProduction) {
    app.use(cors());
  }
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(demoWebPath));

  const clientErrorMessage = (error: unknown, fallback: string): string => {
    const message = error instanceof Error ? error.message : fallback;
    if (!isProduction || safeClientErrors.has(message)) return message;
    return fallback;
  };

  const bearerToken = (request: express.Request): string | undefined => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
    return typeof request.query.token === 'string' ? request.query.token : undefined;
  };

  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'dugoutcall-server' });
  });

  app.get('/config', (_request, response) => {
    response.json(buildClientConfig());
  });

  app.post('/rooms', async (request, response) => {
    if (!createLimiter.consume(request.ip ?? 'unknown')) {
      response.status(429).json({ error: 'Too many rooms created; try again later' });
      return;
    }
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
        error: clientErrorMessage(error, 'Unable to create room')
      });
    }
  });

  app.post('/rooms/:code/join', async (request, response) => {
    const code = request.params.code;
    if (!joinLimiter.consume(request.ip ?? 'unknown')) {
      response.status(429).json({ error: 'Too many join attempts; try again later' });
      return;
    }
    if (lockout.isLocked(code)) {
      response.status(429).json({ error: 'Too many failed attempts for this room code' });
      return;
    }
    try {
      const role = request.body?.role as UserRole;

      // Relay-restart recovery: a Bearer token signed by this relay proves the
      // room existed; recreate it instead of failing the rejoin.
      try {
        rooms.getRoom(code);
      } catch {
        const token = bearerToken(request);
        if (token) {
          try {
            const claims = verifyRoomToken(token, tokenSecret);
            if (claims.roomCode === code) rooms.restoreRoom(claims);
          } catch {
            // Invalid token: fall through to the normal join failure.
          }
        }
      }

      const participant = rooms.joinRoom(code, {
        role,
        displayName: request.body?.displayName
      });
      const room = rooms.getRoom(code);
      lockout.clear(code);
      diagnostics.record(room.code, { kind: 'http_join', role: participant.role });
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
      lockout.recordFailure(code);
      response.status(400).json({
        error: clientErrorMessage(error, 'Unable to join room')
      });
    }
  });

  app.get('/rooms/:code/diagnostics', (request, response) => {
    try {
      const claims = verifyRoomToken(bearerToken(request) ?? '', tokenSecret);
      if (claims.roomCode !== request.params.code) throw new Error('Token mismatch');
    } catch {
      response.status(401).json({ error: 'A valid room token is required' });
      return;
    }
    try {
      rooms.getRoom(request.params.code);
      response.json(diagnostics.snapshot(request.params.code));
    } catch (error) {
      response.status(404).json({
        error: clientErrorMessage(error, 'Room diagnostics unavailable')
      });
    }
  });

  app.get('*', (_request, response) => {
    response.sendFile(path.join(demoWebPath, 'index.html'));
  });

  const server = http.createServer(app);
  const wss = attachWebSocketServer(server, rooms, {
    tokenSecret,
    diagnostics,
    ...options.websocket
  });

  return { app, server, wss, rooms, diagnostics };
}
