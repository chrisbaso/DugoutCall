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

  it('restores a room from signed-token claims after a restart', () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 1_000 });

    const restored = store.restoreRoom({ roomCode: '424242', expiresAt: 61_000 });

    expect(restored.code).toBe('424242');
    expect(restored.expiresAt).toBe(61_000);
    expect(store.getRoom('424242')).toBe(restored);
    // A coach can claim the slot in the restored room.
    expect(store.joinRoom('424242', { role: 'coach' }).role).toBe('coach');
  });

  it('refuses to restore a room from expired claims', () => {
    const store = new RoomStore({ ttlMs: 60_000, now: () => 100_000 });

    expect(() => store.restoreRoom({ roomCode: '424242', expiresAt: 61_000 })).toThrow(/expired/i);
  });

  it('sweeps expired rooms and reports their codes', () => {
    let now = 1_000;
    const store = new RoomStore({ ttlMs: 1_000, now: () => now });
    const expired = store.createRoom({ coachName: 'Coach A' });
    now = 1_500;
    const alive = store.createRoom({ coachName: 'Coach B' });

    now = 2_200;
    const removed = store.sweepExpired();

    expect(removed).toEqual([expired.code]);
    expect(() => store.getRoom(expired.code)).toThrow(/not found/i);
    expect(store.getRoom(alive.code).code).toBe(alive.code);
  });
});
