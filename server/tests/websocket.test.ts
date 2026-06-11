import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRoomToken } from '../src/auth.js';
import { RoomDiagnostics } from '../src/diagnostics.js';
import { RoomStore } from '../src/rooms.js';
import { attachWebSocketServer, type WebSocketServerOptions } from '../src/websocket.js';

const SECRET = 'test-secret';

const tokenFor = (roomCode: string, role: 'coach' | 'catcher', expiresAt: number) =>
  createRoomToken({ secret: SECRET, roomCode, role, expiresAt });

const onceMessageOfType = (socket: WebSocket, type: string) =>
  new Promise<any>((resolve) => {
    const listener = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === type) {
        socket.off('message', listener);
        resolve(parsed);
      }
    };
    socket.on('message', listener);
  });

const opened = (socket: WebSocket) => new Promise((resolve) => socket.once('open', resolve));

describe('websocket relay', () => {
  let server: http.Server | undefined;

  const startServer = (store: RoomStore, options: Partial<WebSocketServerOptions> = {}) =>
    new Promise<string>((resolve) => {
      server = http.createServer();
      attachWebSocketServer(server, store, { tokenSecret: SECRET, ...options });
      server.listen(0, () => {
        const address = server!.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        resolve(`ws://127.0.0.1:${address.port}`);
      });
    });

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => {
          server = undefined;
          resolve();
        });
      })
  );

  const joinedPair = async (store: RoomStore, now: () => number) => {
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now });
    const coach = new WebSocket(url);
    const catcher = new WebSocket(url);
    await Promise.all([opened(coach), opened(catcher)]);

    const coachAssigned = onceMessageOfType(coach, 'role_assigned');
    coach.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'coach',
        token: tokenFor(room.code, 'coach', room.expiresAt)
      })
    );
    await coachAssigned;

    const catcherAssigned = onceMessageOfType(catcher, 'role_assigned');
    catcher.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'catcher',
        token: tokenFor(room.code, 'catcher', room.expiresAt)
      })
    );
    await catcherAssigned;

    return { room, coach, catcher };
  };

  it('relays pitch calls from coach to catcher without catcher acknowledgements', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const { coach, catcher } = await joinedPair(store, now);

    const delivered = onceMessageOfType(catcher, 'pitch_call');
    coach.send(
      JSON.stringify({
        type: 'pitch_call',
        id: 'call-1',
        pitch: 'Fastball',
        location: 'Away',
        spokenText: 'Fastball away',
        timestamp: 123456789
      })
    );

    await expect(delivered).resolves.toMatchObject({
      type: 'pitch_call',
      spokenText: 'Fastball away'
    });

    coach.close();
    catcher.close();
  });

  it('acks relayed pitch calls back to the coach with the recipient count', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const { coach, catcher } = await joinedPair(store, now);

    const ack = onceMessageOfType(coach, 'call_ack');
    coach.send(
      JSON.stringify({
        type: 'pitch_call',
        id: 'call-7',
        pitch: 'Curveball',
        spokenText: 'Curveball',
        timestamp: 123456789
      })
    );

    await expect(ack).resolves.toMatchObject({
      type: 'call_ack',
      id: 'call-7',
      recipientCount: 1
    });

    coach.close();
    catcher.close();
  });

  it('reports zero recipients when no catcher socket is attached', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now });

    const coach = new WebSocket(url);
    await opened(coach);
    const assigned = onceMessageOfType(coach, 'role_assigned');
    coach.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'coach',
        token: tokenFor(room.code, 'coach', room.expiresAt)
      })
    );
    await assigned;

    const ack = onceMessageOfType(coach, 'call_ack');
    coach.send(
      JSON.stringify({
        type: 'pitch_call',
        id: 'call-8',
        pitch: 'Fastball',
        spokenText: 'Fastball',
        timestamp: 1
      })
    );

    await expect(ack).resolves.toMatchObject({ id: 'call-8', recipientCount: 0 });

    coach.close();
  });

  it('rejects join_room without a token', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now });

    const socket = new WebSocket(url);
    await opened(socket);

    const rejection = onceMessageOfType(socket, 'error');
    socket.send(JSON.stringify({ type: 'join_room', code: room.code, role: 'coach' }));
    await expect(rejection).resolves.toMatchObject({
      message: expect.stringMatching(/valid room token/i)
    });

    // The session must not be joined: relaying is refused.
    const relayRefused = onceMessageOfType(socket, 'error');
    socket.send(
      JSON.stringify({ type: 'pitch_call', id: 'x', pitch: 'Fastball', spokenText: 'Fastball', timestamp: 1 })
    );
    await expect(relayRefused).resolves.toMatchObject({
      message: expect.stringMatching(/join a room/i)
    });

    socket.close();
  });

  it('rejects a token whose role does not match the claimed role', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now });

    const socket = new WebSocket(url);
    await opened(socket);

    const rejection = onceMessageOfType(socket, 'error');
    socket.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'coach',
        token: tokenFor(room.code, 'catcher', room.expiresAt)
      })
    );
    await expect(rejection).resolves.toMatchObject({
      message: expect.stringMatching(/does not match/i)
    });

    socket.close();
  });

  it('rejects a tampered token', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now });

    const socket = new WebSocket(url);
    await opened(socket);

    const token = tokenFor(room.code, 'coach', room.expiresAt);
    const rejection = onceMessageOfType(socket, 'error');
    socket.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'coach',
        token: `${token.split('.')[0]}.tampered-signature`
      })
    );
    await expect(rejection).resolves.toMatchObject({
      message: expect.stringMatching(/valid room token/i)
    });

    socket.close();
  });

  it('resurrects a room from a valid token after a relay restart', async () => {
    const now = () => 1_000;
    // Fresh store simulating a restarted relay: the room no longer exists.
    const store = new RoomStore({ ttlMs: 60_000, now });
    const url = await startServer(store, { now });

    const coach = new WebSocket(url);
    await opened(coach);
    const assigned = onceMessageOfType(coach, 'role_assigned');
    coach.send(
      JSON.stringify({
        type: 'join_room',
        code: '424242',
        role: 'coach',
        token: tokenFor('424242', 'coach', 61_000)
      })
    );

    await expect(assigned).resolves.toMatchObject({
      type: 'role_assigned',
      role: 'coach',
      code: '424242',
      expiresAt: 61_000
    });

    coach.close();
  });

  it('does not resurrect a room from an expired token', async () => {
    const now = () => 100_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const url = await startServer(store, { now });

    const coach = new WebSocket(url);
    await opened(coach);
    const rejection = onceMessageOfType(coach, 'error');
    coach.send(
      JSON.stringify({
        type: 'join_room',
        code: '424242',
        role: 'coach',
        token: tokenFor('424242', 'coach', 61_000)
      })
    );

    await expect(rejection).resolves.toMatchObject({
      message: expect.stringMatching(/valid room token/i)
    });

    coach.close();
  });

  it('notifies the coach of catcher socket presence', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now });

    const coach = new WebSocket(url);
    await opened(coach);
    const initialStatus = onceMessageOfType(coach, 'peer_status');
    coach.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'coach',
        token: tokenFor(room.code, 'coach', room.expiresAt)
      })
    );
    await expect(initialStatus).resolves.toMatchObject({ role: 'catcher', connected: false });

    const catcher = new WebSocket(url);
    await opened(catcher);
    const joinedStatus = onceMessageOfType(coach, 'peer_status');
    catcher.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'catcher',
        token: tokenFor(room.code, 'catcher', room.expiresAt)
      })
    );
    await expect(joinedStatus).resolves.toMatchObject({ role: 'catcher', connected: true });

    const droppedStatus = onceMessageOfType(coach, 'peer_status');
    catcher.close();
    await expect(droppedStatus).resolves.toMatchObject({ role: 'catcher', connected: false });

    coach.close();
  });

  it('closes live sessions with room_closed when the room expires', async () => {
    let currentTime = 1_000;
    const now = () => currentTime;
    const store = new RoomStore({ ttlMs: 1_000, now });
    const { catcher, coach } = await joinedPair(store, now);

    const closed = onceMessageOfType(catcher, 'room_closed');
    currentTime = 3_000;
    coach.send(
      JSON.stringify({ type: 'pitch_call', id: 'late', pitch: 'Fastball', spokenText: 'Fastball', timestamp: 1 })
    );
    const coachClosed = onceMessageOfType(coach, 'room_closed');
    await expect(coachClosed).resolves.toMatchObject({ reason: 'expired' });

    // Sweep (driven here by a heartbeat-triggered expiry check on the catcher)
    catcher.send(JSON.stringify({ type: 'heartbeat' }));
    await expect(closed).resolves.toMatchObject({ reason: 'expired' });

    coach.close();
    catcher.close();
  });

  it('sweeps expired rooms on the interval and notifies sessions', async () => {
    let currentTime = 1_000;
    const now = () => currentTime;
    const store = new RoomStore({ ttlMs: 1_000, now });
    const diagnostics = new RoomDiagnostics();
    const room = store.createRoom({ coachName: 'Coach B' });

    server = http.createServer();
    attachWebSocketServer(server, store, {
      tokenSecret: SECRET,
      diagnostics,
      now,
      sweepIntervalMs: 20
    });
    const url = await new Promise<string>((resolve) => {
      server!.listen(0, () => {
        const address = server!.address();
        if (!address || typeof address === 'string') throw new Error('missing address');
        resolve(`ws://127.0.0.1:${address.port}`);
      });
    });

    const catcher = new WebSocket(url);
    await opened(catcher);
    const assigned = onceMessageOfType(catcher, 'role_assigned');
    catcher.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'catcher',
        token: tokenFor(room.code, 'catcher', room.expiresAt)
      })
    );
    await assigned;

    const closed = onceMessageOfType(catcher, 'room_closed');
    currentTime = 3_000;
    await expect(closed).resolves.toMatchObject({ reason: 'expired' });
    expect(diagnostics.snapshot(room.code).recentEvents).toEqual([]);

    catcher.close();
  });

  it('relays WebRTC signaling in both directions as technical transport only', async () => {
    const now = () => 1_000;
    const store = new RoomStore({ ttlMs: 60_000, now });
    const { coach, catcher } = await joinedPair(store, now);

    const offerDelivered = onceMessageOfType(catcher, 'webrtc_offer');
    coach.send(JSON.stringify({ type: 'webrtc_offer', sdp: 'coach-offer' }));
    await expect(offerDelivered).resolves.toMatchObject({ sdp: 'coach-offer' });

    const answerDelivered = onceMessageOfType(coach, 'webrtc_answer');
    catcher.send(JSON.stringify({ type: 'webrtc_answer', sdp: 'catcher-answer' }));
    await expect(answerDelivered).resolves.toMatchObject({ sdp: 'catcher-answer' });

    coach.close();
    catcher.close();
  });

  it('records diagnostics without pitch-call contents or display names', async () => {
    const now = () => 1_000;
    const diagnostics = new RoomDiagnostics();
    const store = new RoomStore({ ttlMs: 60_000, now });
    const room = store.createRoom({ coachName: 'Coach B' });
    const url = await startServer(store, { now, diagnostics });

    const coach = new WebSocket(url);
    const catcher = new WebSocket(url);
    await Promise.all([opened(coach), opened(catcher)]);

    const coachAssigned = onceMessageOfType(coach, 'role_assigned');
    coach.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'coach',
        displayName: 'Coach Real Name',
        token: tokenFor(room.code, 'coach', room.expiresAt)
      })
    );
    await coachAssigned;

    const catcherAssigned = onceMessageOfType(catcher, 'role_assigned');
    catcher.send(
      JSON.stringify({
        type: 'join_room',
        code: room.code,
        role: 'catcher',
        displayName: 'Kid Real Name',
        token: tokenFor(room.code, 'catcher', room.expiresAt)
      })
    );
    await catcherAssigned;

    const delivered = onceMessageOfType(catcher, 'pitch_call');
    coach.send(
      JSON.stringify({
        type: 'pitch_call',
        id: 'call-1',
        pitch: 'Fastball',
        spokenText: 'Fastball',
        timestamp: 123456789
      })
    );
    await delivered;

    const snapshot = diagnostics.snapshot(room.code);
    expect(snapshot.counters).toMatchObject({ socket_joined: 2, pitch_call: 1 });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Fastball');
    expect(serialized).not.toContain('Real Name');
    expect(
      snapshot.recentEvents.find((event) => event.kind === 'pitch_call')
    ).toMatchObject({ recipientCount: 1, role: 'coach' });

    coach.close();
    catcher.close();
  });
});
