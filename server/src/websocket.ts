import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, UserRole } from './types.js';
import type { RoomStore } from './rooms.js';
import { isSignalingMessage } from './signaling.js';

interface Session {
  socket: WebSocket;
  code?: string;
  role?: UserRole;
}

const send = (socket: WebSocket, message: ServerMessage) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

export function attachWebSocketServer(server: http.Server, rooms: RoomStore): WebSocketServer {
  const wss = new WebSocketServer({ server });
  const sessions = new Map<WebSocket, Session>();

  const relayToCatcher = (code: string, message: ServerMessage) => {
    for (const session of sessions.values()) {
      if (session.code === code && session.role === 'catcher') send(session.socket, message);
    }
  };

  const relayToCoach = (code: string, message: ServerMessage) => {
    for (const session of sessions.values()) {
      if (session.code === code && session.role === 'coach') send(session.socket, message);
    }
  };

  wss.on('connection', (socket) => {
    const session: Session = { socket };
    sessions.set(socket, session);

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;

        if (message.type === 'join_room') {
          const participant = rooms.joinRoom(message.code, {
            role: message.role,
            displayName: message.displayName
          });
          const room = rooms.getRoom(message.code);
          session.code = message.code;
          session.role = participant.role;
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
          send(socket, { type: 'heartbeat', timestamp: Date.now() });
          return;
        }

        if (isSignalingMessage(message)) {
          if (session.role === 'coach') {
            relayToCatcher(session.code, message);
          } else {
            relayToCoach(session.code, message);
          }
          return;
        }

        if (session.role !== 'coach') {
          send(socket, { type: 'error', message: 'Game Mode is one-way coach-to-catcher only' });
          return;
        }

        if (message.type === 'pitch_call') {
          relayToCatcher(session.code, message);
          return;
        }

        if (message.type === 'ptt_start' || message.type === 'ptt_stop') {
          relayToCatcher(session.code, {
            type: message.type,
            timestamp: message.timestamp ?? Date.now()
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
      sessions.delete(socket);
    });
  });

  return wss;
}
