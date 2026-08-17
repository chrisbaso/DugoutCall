import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, UserRole } from './types.js';
import type { RoomStore } from './rooms.js';
import type { RoomDiagnostics } from './diagnostics.js';
import { isSignalingMessage } from './signaling.js';
import { verifyRoomToken } from './auth.js';
import { isUserRole } from './types.js';

interface Session {
  socket: WebSocket;
  code?: string;
  role?: UserRole;
}

const send = (socket: WebSocket, message: ServerMessage) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

export function attachWebSocketServer(
  server: http.Server,
  rooms: RoomStore,
  diagnostics?: RoomDiagnostics,
  tokenSecret = process.env.DUGOUTCALL_TOKEN_SECRET ?? 'local-development-secret-change-me'
): WebSocketServer {
  const wss = new WebSocketServer({ server });
  const sessions = new Map<WebSocket, Session>();

  const relayToCatcher = (code: string, message: ServerMessage): number => {
    let recipients = 0;
    for (const session of sessions.values()) {
      if (session.code === code && session.role === 'catcher') {
        send(session.socket, message);
        recipients += 1;
      }
    }
    return recipients;
  };

  const relayToCoach = (code: string, message: ServerMessage): number => {
    let recipients = 0;
    for (const session of sessions.values()) {
      if (session.code === code && session.role === 'coach') {
        send(session.socket, message);
        recipients += 1;
      }
    }
    return recipients;
  };

  wss.on('connection', (socket) => {
    const session: Session = { socket };
    sessions.set(socket, session);

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;

        if (message.type === 'join_room') {
          if (!isUserRole(message.role)) throw new Error('Invalid participant role');
          if (!message.token) throw new Error('Room credential required');
          const claims = verifyRoomToken(message.token, tokenSecret);
          if (claims.roomCode !== message.code || claims.role !== message.role) {
            throw new Error('Room credential does not match requested room and role');
          }
          const participant = rooms.joinRoom(message.code, {
            role: message.role,
            displayName: message.displayName
          });
          const room = rooms.getRoom(message.code);
          session.code = message.code;
          session.role = participant.role;
          diagnostics?.record(message.code, {
            kind: 'socket_joined',
            role: participant.role,
            detail: message.displayName
          });
          send(socket, {
            type: 'role_assigned',
            code: message.code,
            role: participant.role,
            mode: room.mode,
            expiresAt: room.expiresAt
          });
          return;
        }

        if (!session.code || !session.role) {
          send(socket, { type: 'error', message: 'Join a room before sending messages' });
          return;
        }

        if (message.type === 'heartbeat') {
          diagnostics?.record(session.code, { kind: 'heartbeat', role: session.role });
          send(socket, { type: 'heartbeat', timestamp: Date.now() });
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
          diagnostics?.record(session.code, {
            kind: 'pitch_call',
            role: session.role,
            recipientCount: recipients
          });
          return;
        }

        if (message.type === 'ptt_start' || message.type === 'ptt_stop') {
          const recipients = relayToCatcher(session.code, {
            type: message.type,
            timestamp: message.timestamp ?? Date.now()
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
      if (session.code && session.role) {
        diagnostics?.record(session.code, {
          kind: 'socket_closed',
          role: session.role
        });
      }
      sessions.delete(socket);
    });
  });

  return wss;
}
