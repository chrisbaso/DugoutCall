import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyRoomToken } from './auth.js';
import type { ClientMessage, ServerMessage, UserRole } from './types.js';
import type { RoomStore } from './rooms.js';
import type { RoomDiagnostics } from './diagnostics.js';
import { isSignalingMessage } from './signaling.js';

interface Session {
  socket: WebSocket;
  code?: string;
  role?: UserRole;
  missedPongs: number;
}

export interface WebSocketServerOptions {
  tokenSecret: string;
  diagnostics?: RoomDiagnostics;
  pingIntervalMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
}

const send = (socket: WebSocket, message: ServerMessage) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

export function attachWebSocketServer(
  server: http.Server,
  rooms: RoomStore,
  options: WebSocketServerOptions
): WebSocketServer {
  const { tokenSecret, diagnostics } = options;
  const now = options.now ?? Date.now;
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
  const sessions = new Map<WebSocket, Session>();

  const relayToRole = (code: string, role: UserRole, message: ServerMessage): number => {
    let recipients = 0;
    for (const session of sessions.values()) {
      if (session.code === code && session.role === role) {
        send(session.socket, message);
        recipients += 1;
      }
    }
    return recipients;
  };

  const relayToCatcher = (code: string, message: ServerMessage) => relayToRole(code, 'catcher', message);
  const relayToCoach = (code: string, message: ServerMessage) => relayToRole(code, 'coach', message);

  const hasRole = (code: string, role: UserRole): boolean => {
    for (const session of sessions.values()) {
      if (session.code === code && session.role === role) return true;
    }
    return false;
  };

  const closeRoomSessions = (code: string, reason: string) => {
    for (const session of sessions.values()) {
      if (session.code === code) {
        send(session.socket, { type: 'room_closed', reason });
        session.socket.close();
      }
    }
  };

  // Detect half-open sockets so zombie sessions stop inflating recipientCount.
  const pingInterval = setInterval(() => {
    for (const session of sessions.values()) {
      if (session.missedPongs >= 2) {
        session.socket.terminate();
        continue;
      }
      session.missedPongs += 1;
      session.socket.ping();
    }
  }, options.pingIntervalMs ?? 30_000);
  pingInterval.unref();

  const sweepInterval = setInterval(() => {
    for (const code of rooms.sweepExpired()) {
      closeRoomSessions(code, 'expired');
      diagnostics?.drop(code);
    }
  }, options.sweepIntervalMs ?? 60_000);
  sweepInterval.unref();

  server.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(sweepInterval);
  });

  wss.on('connection', (socket) => {
    const session: Session = { socket, missedPongs: 0 };
    sessions.set(socket, session);

    socket.on('pong', () => {
      session.missedPongs = 0;
    });

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;

        if (message.type === 'join_room') {
          let claims;
          try {
            claims = verifyRoomToken(message.token ?? '', tokenSecret, now());
          } catch {
            send(socket, { type: 'error', message: 'A valid room token is required to join' });
            return;
          }
          if (claims.roomCode !== message.code || claims.role !== message.role) {
            send(socket, { type: 'error', message: 'Room token does not match this room and role' });
            return;
          }

          // The session role comes from the verified claims, never the client's word.
          let room;
          try {
            room = rooms.getRoom(message.code);
          } catch {
            room = rooms.restoreRoom(claims);
          }
          const participant = rooms.joinRoom(message.code, {
            role: claims.role,
            displayName: message.displayName
          });
          session.code = message.code;
          session.role = participant.role;
          diagnostics?.record(message.code, {
            kind: 'socket_joined',
            role: participant.role
          });
          send(socket, {
            type: 'role_assigned',
            code: message.code,
            role: participant.role,
            mode: room.mode,
            expiresAt: room.expiresAt
          });
          if (participant.role === 'catcher') {
            relayToCoach(message.code, { type: 'peer_status', role: 'catcher', connected: true });
          } else {
            send(socket, {
              type: 'peer_status',
              role: 'catcher',
              connected: hasRole(message.code, 'catcher')
            });
          }
          return;
        }

        if (!session.code || !session.role) {
          send(socket, { type: 'error', message: 'Join a room before sending messages' });
          return;
        }

        try {
          rooms.getRoom(session.code);
        } catch {
          send(socket, { type: 'room_closed', reason: 'expired' });
          socket.close();
          return;
        }

        if (message.type === 'heartbeat') {
          diagnostics?.record(session.code, { kind: 'heartbeat', role: session.role });
          send(socket, { type: 'heartbeat', timestamp: now() });
          return;
        }

        if (isSignalingMessage(message)) {
          const recipients =
            session.role === 'coach'
              ? relayToCatcher(session.code, message)
              : relayToCoach(session.code, message);
          diagnostics?.record(session.code, {
            kind: message.type,
            role: session.role,
            recipientCount: recipients
          });
          return;
        }

        if (session.role !== 'coach') {
          send(socket, { type: 'error', message: 'Game Mode is one-way coach-to-catcher only' });
          return;
        }

        if (message.type === 'pitch_call') {
          const recipients = relayToCatcher(session.code, message);
          // Call contents (spokenText) and names are deliberately not recorded.
          diagnostics?.record(session.code, {
            kind: 'pitch_call',
            role: session.role,
            recipientCount: recipients
          });
          send(socket, {
            type: 'call_ack',
            id: message.id,
            recipientCount: recipients,
            timestamp: now()
          });
          return;
        }

        if (message.type === 'ptt_start' || message.type === 'ptt_stop') {
          const recipients = relayToCatcher(session.code, {
            type: message.type,
            timestamp: message.timestamp ?? now()
          });
          diagnostics?.record(session.code, {
            kind: message.type,
            role: session.role,
            recipientCount: recipients
          });
        }
      } catch (error) {
        send(socket, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Invalid message'
        });
      }
    });

    socket.on('close', () => {
      const { code, role } = session;
      sessions.delete(socket);
      if (code && role) {
        diagnostics?.record(code, { kind: 'socket_closed', role });
        if (role === 'catcher') {
          relayToCoach(code, {
            type: 'peer_status',
            role: 'catcher',
            connected: hasRole(code, 'catcher')
          });
        }
      }
    });
  });

  return wss;
}
