import crypto from 'node:crypto';
import type { UserRole } from './types.js';

export interface RoomTokenClaims {
  roomCode: string;
  role: UserRole;
  expiresAt: number;
}

interface CreateRoomTokenInput extends RoomTokenClaims {
  secret: string;
}

const base64Url = (input: string | Buffer) =>
  Buffer.from(input).toString('base64url');

const sign = (payload: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function createRoomToken(input: CreateRoomTokenInput): string {
  const payload = base64Url(
    JSON.stringify({
      roomCode: input.roomCode,
      role: input.role,
      expiresAt: input.expiresAt
    })
  );
  return `${payload}.${sign(payload, input.secret)}`;
}

export function verifyRoomToken(token: string, secret: string, now = Date.now()): RoomTokenClaims {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new Error('Invalid token');

  const expected = sign(payload, secret);
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !crypto.timingSafeEqual(actual, expectedBuffer)) {
    throw new Error('Invalid token signature');
  }

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RoomTokenClaims;
  if (claims.expiresAt <= now) throw new Error('Room token expired');
  if (claims.role !== 'coach' && claims.role !== 'catcher') throw new Error('Invalid token role');
  return claims;
}
