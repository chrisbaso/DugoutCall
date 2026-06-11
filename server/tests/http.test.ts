import { afterEach, describe, expect, it } from 'vitest';
import { createDugoutServer, type DugoutServer } from '../src/server.js';

const SECRET = 'test-secret';

describe('HTTP endpoints', () => {
  let instance: DugoutServer | undefined;
  let baseUrl = '';

  const start = async (options: Partial<Parameters<typeof createDugoutServer>[0]> = {}) => {
    instance = createDugoutServer({ tokenSecret: SECRET, ...options });
    await new Promise<void>((resolve) => {
      instance!.server.listen(0, () => resolve());
    });
    const address = instance.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    return instance;
  };

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (!instance) {
          resolve();
          return;
        }
        instance.server.close(() => {
          instance = undefined;
          resolve();
        });
      })
  );

  const createRoom = async () => {
    const response = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachName: 'Coach', teamName: 'Team', mode: 'game' })
    });
    return { response, body: await response.json() as any };
  };

  it('creates rooms with a signed token', async () => {
    await start();
    const { response, body } = await createRoom();

    expect(response.status).toBe(201);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(typeof body.token).toBe('string');
    expect(body.token).toContain('.');
  });

  it('returns the join error message for a missing room', async () => {
    await start();
    const response = await fetch(`${baseUrl}/rooms/000000/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'catcher', displayName: 'Catcher' })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Room not found' });
  });

  it('rate limits room creation per IP', async () => {
    await start({ createRoomLimit: { limit: 2, windowMs: 60_000 } });

    expect((await createRoom()).response.status).toBe(201);
    expect((await createRoom()).response.status).toBe(201);
    const third = await createRoom();
    expect(third.response.status).toBe(429);
  });

  it('locks a room code after repeated failed joins', async () => {
    await start({
      joinLimit: { limit: 100, windowMs: 60_000 },
      lockout: { threshold: 3, lockMs: 60_000 }
    });

    const attempt = () =>
      fetch(`${baseUrl}/rooms/111111/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'catcher' })
      });

    expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(400);
    const locked = await attempt();
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({
      error: expect.stringMatching(/failed attempts/i)
    });
  });

  it('requires a matching room token for diagnostics', async () => {
    await start();
    const { body } = await createRoom();

    const unauthorized = await fetch(`${baseUrl}/rooms/${body.code}/diagnostics`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/rooms/${body.code}/diagnostics`, {
      headers: { Authorization: `Bearer ${body.token}` }
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ code: body.code });
  });

  it('resurrects a missing room when the join carries a valid Bearer token', async () => {
    const started = await start();
    const { body } = await createRoom();

    // Simulate relay restart: the room evaporates but the client still has its token.
    started.rooms.closeRoom(body.code);

    const withoutToken = await fetch(`${baseUrl}/rooms/${body.code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'coach', displayName: 'Coach' })
    });
    expect(withoutToken.status).toBe(400);

    const withToken = await fetch(`${baseUrl}/rooms/${body.code}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.token}`
      },
      body: JSON.stringify({ role: 'coach', displayName: 'Coach' })
    });
    expect(withToken.status).toBe(200);
    expect(await withToken.json()).toMatchObject({ code: body.code, role: 'coach' });
  });

  it('masks unexpected error details in production but passes safe ones through', async () => {
    await start({ isProduction: true });

    const response = await fetch(`${baseUrl}/rooms/000000/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'catcher' })
    });
    // 'Room not found' is on the safe list and stays user-actionable.
    expect(await response.json()).toMatchObject({ error: 'Room not found' });
  });

  it('omits identifying details from HTTP-join diagnostics', async () => {
    const started = await start();
    const { body } = await createRoom();
    await fetch(`${baseUrl}/rooms/${body.code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'catcher', displayName: 'Kid Real Name' })
    });

    const snapshot = started.diagnostics.snapshot(body.code);
    expect(JSON.stringify(snapshot)).not.toContain('Real Name');
    expect(snapshot.counters).toMatchObject({ http_join: 1 });
  });
});
