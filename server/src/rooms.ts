import crypto from 'node:crypto';
import type { Participant, Room, UserRole } from './types.js';

export interface RoomStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  initCreatedAt = Date.now();

  constructor(options: RoomStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? Number(process.env.ROOM_TTL_MS ?? 2 * 60 * 60 * 1000);
    this.now = options.now ?? Date.now;
  }

  createRoom(input: { coachName?: string; teamName?: string; mode?: 'game' | 'practice' } = {}): Room {
    this.cleanupExpired();
    const createdAt = this.now();
    const code = this.uniqueCode();
    const room: Room = {
      code,
      mode: input.mode ?? 'game',
      coach: {
        id: crypto.randomUUID(),
        role: 'coach',
        displayName: input.coachName,
        joinedAt: createdAt
      },
      teamName: input.teamName,
      createdAt,
      expiresAt: createdAt + this.ttlMs
    };

    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found');
    if (room.expiresAt <= this.now()) {
      this.rooms.delete(code);
      throw new Error('Room expired');
    }
    return room;
  }

  joinRoom(code: string, input: { role: UserRole; displayName?: string }): Participant {
    const room = this.getRoom(code);
    const participant: Participant = {
      id: crypto.randomUUID(),
      role: input.role,
      displayName: input.displayName,
      joinedAt: this.now()
    };

    if (input.role === 'coach') {
      if (room.coach) return room.coach;
      room.coach = participant;
      return participant;
    }

    if (room.catcher && room.catcher.displayName === input.displayName) {
      return room.catcher;
    }

    if (room.catcher) {
      throw new Error('Room already has a catcher');
    }

    room.catcher = participant;
    return participant;
  }

  closeRoom(code: string): void {
    this.rooms.delete(code);
  }

  private uniqueCode(): string {
    for (let i = 0; i < 20; i += 1) {
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
      if (!this.rooms.has(code)) return code;
    }

    throw new Error('Unable to allocate room code');
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [code, room] of this.rooms.entries()) {
      if (room.expiresAt <= now) this.rooms.delete(code);
    }
  }
}
