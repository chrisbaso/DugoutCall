import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RoomDiagnostics } from '../src/diagnostics.js';
import { RoomStore } from '../src/rooms.js';
import { attachWebSocketServer } from '../src/websocket.js';
import { createRoomToken } from '../src/auth.js';

const tokenSecret = 'websocket-test-secret';
const joinMessage = (code: string, role: 'coach' | 'catcher', displayName?: string) => ({
  type: 'join_room',
  code,
  role,
  displayName,
  token: createRoomToken({ secret: tokenSecret, roomCode: code, role, expiresAt: Date.now() + 60_000 })
});

const onceMessage = (socket: WebSocket) =>
  new Promise<any>((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });

describe('websocket relay', () => {
  let server: http.Server | undefined;

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      })
  );

  it('relays pitch calls from coach to catcher without catcher acknowledgements', async () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });

    server = http.createServer();
    attachWebSocketServer(server, store, undefined, tokenSecret);

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const url = `ws://127.0.0.1:${address.port}`;
    const coach = new WebSocket(url);
    const catcher = new WebSocket(url);

    await Promise.all([
      new Promise((resolve) => coach.once('open', resolve)),
      new Promise((resolve) => catcher.once('open', resolve))
    ]);

    const coachAssigned = onceMessage(coach);
    const catcherAssigned = onceMessage(catcher);
    coach.send(JSON.stringify(joinMessage(room.code, 'coach')));
    catcher.send(JSON.stringify(joinMessage(room.code, 'catcher')));

    await Promise.all([coachAssigned, catcherAssigned]);

    const delivered = onceMessage(catcher);
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

  it('lets the catcher socket attach after HTTP join claims the catcher slot', async () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });
    store.joinRoom(room.code, { role: 'catcher', displayName: 'Catcher' });

    server = http.createServer();
    attachWebSocketServer(server, store, undefined, tokenSecret);

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const catcher = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise((resolve) => catcher.once('open', resolve));

    const assigned = onceMessage(catcher);
    catcher.send(
      JSON.stringify(joinMessage(room.code, 'catcher', 'Catcher'))
    );

    await expect(assigned).resolves.toMatchObject({
      type: 'role_assigned',
      role: 'catcher'
    });

    catcher.close();
  });

  it('relays WebRTC signaling in both directions as technical transport only', async () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });

    server = http.createServer();
    attachWebSocketServer(server, store, undefined, tokenSecret);

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const url = `ws://127.0.0.1:${address.port}`;
    const coach = new WebSocket(url);
    const catcher = new WebSocket(url);

    await Promise.all([
      new Promise((resolve) => coach.once('open', resolve)),
      new Promise((resolve) => catcher.once('open', resolve))
    ]);

    const coachAssigned = onceMessage(coach);
    const catcherAssigned = onceMessage(catcher);
    coach.send(JSON.stringify(joinMessage(room.code, 'coach')));
    catcher.send(JSON.stringify(joinMessage(room.code, 'catcher')));
    await Promise.all([coachAssigned, catcherAssigned]);

    const offerDelivered = onceMessage(catcher);
    coach.send(JSON.stringify({ type: 'webrtc_offer', sdp: 'coach-offer' }));
    await expect(offerDelivered).resolves.toMatchObject({
      type: 'webrtc_offer',
      sdp: 'coach-offer'
    });

    const answerDelivered = onceMessage(coach);
    catcher.send(JSON.stringify({ type: 'webrtc_answer', sdp: 'catcher-answer' }));
    await expect(answerDelivered).resolves.toMatchObject({
      type: 'webrtc_answer',
      sdp: 'catcher-answer'
    });

    coach.close();
    catcher.close();
  });

  it('records room diagnostics for coach-originated pitch relays', async () => {
    const diagnostics = new RoomDiagnostics();
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });

    server = http.createServer();
    attachWebSocketServer(server, store, diagnostics, tokenSecret);

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const url = `ws://127.0.0.1:${address.port}`;
    const coach = new WebSocket(url);
    const catcher = new WebSocket(url);

    await Promise.all([
      new Promise((resolve) => coach.once('open', resolve)),
      new Promise((resolve) => catcher.once('open', resolve))
    ]);

    const coachAssigned = onceMessage(coach);
    const catcherAssigned = onceMessage(catcher);
    coach.send(JSON.stringify(joinMessage(room.code, 'coach')));
    catcher.send(JSON.stringify(joinMessage(room.code, 'catcher')));
    await Promise.all([coachAssigned, catcherAssigned]);

    const delivered = onceMessage(catcher);
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

    expect(diagnostics.snapshot(room.code)).toMatchObject({
      counters: {
        socket_joined: 2,
        pitch_call: 1
      },
      recentEvents: expect.arrayContaining([
        expect.objectContaining({
          kind: 'pitch_call',
          recipientCount: 1,
          role: 'coach'
        })
      ])
    });
    expect(diagnostics.snapshot(room.code).recentEvents.some((event) => event.detail === 'Fastball')).toBe(false);

    coach.close();
    catcher.close();
  });

  it('rejects missing, expired, and role-mismatched room credentials', async () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });
    server = http.createServer();
    attachWebSocketServer(server, store, undefined, tokenSecret);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const attempt = async (message: unknown) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await new Promise((resolve) => socket.once('open', resolve));
      const result = onceMessage(socket);
      socket.send(JSON.stringify(message));
      const response = await result;
      socket.close();
      return response;
    };

    await expect(attempt({ type: 'join_room', code: room.code, role: 'coach' })).resolves.toMatchObject({
      type: 'error',
      message: expect.stringMatching(/credential required/i)
    });
    await expect(
      attempt({
        ...joinMessage(room.code, 'coach'),
        token: createRoomToken({ secret: tokenSecret, roomCode: room.code, role: 'coach', expiresAt: 1 })
      })
    ).resolves.toMatchObject({ type: 'error', message: expect.stringMatching(/expired/i) });
    await expect(
      attempt({
        ...joinMessage(room.code, 'catcher'),
        role: 'coach'
      })
    ).resolves.toMatchObject({ type: 'error', message: expect.stringMatching(/does not match/i) });
  });
});
