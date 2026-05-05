import { describe, expect, it } from 'vitest';
import { RoomStore } from '../src/rooms.js';

describe('RoomStore', () => {
  it('creates six digit rooms that expire', () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });

    const room = store.createRoom({ coachName: 'Coach B', teamName: 'Dugout' });

    expect(room.code).toMatch(/^\d{6}$/);
    expect(room.mode).toBe('game');
    expect(room.expiresAt).toBe(61_000);
  });

  it('assigns exactly one coach and one catcher in MVP', () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });

    const catcher = store.joinRoom(room.code, { role: 'catcher', displayName: 'Catcher' });

    expect(catcher.role).toBe('catcher');
    expect(() =>
      store.joinRoom(room.code, { role: 'catcher', displayName: 'Second Catcher' })
    ).toThrow(/already has a catcher/i);
  });

  it('allows the same catcher display name to reconnect', () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });
    const room = store.createRoom({ coachName: 'Coach B' });

    const first = store.joinRoom(room.code, { role: 'catcher', displayName: 'Catcher' });
    const reconnect = store.joinRoom(room.code, { role: 'catcher', displayName: 'Catcher' });

    expect(reconnect.id).toBe(first.id);
  });

  it('rejects joins for expired rooms', () => {
    let now = 1_000;
    const store = new RoomStore({ ttlMs: 1_000, now: () => now });
    const room = store.createRoom({ coachName: 'Coach B' });

    now = 3_000;

    expect(() => store.joinRoom(room.code, { role: 'catcher' })).toThrow(/expired/i);
  });
});
