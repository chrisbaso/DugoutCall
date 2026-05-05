import { describe, expect, it } from 'vitest';
import { createRoomToken, verifyRoomToken } from '../src/auth.js';

describe('room tokens', () => {
  it('round trips signed role claims', () => {
    const token = createRoomToken({
      secret: 'test-secret',
      roomCode: '123456',
      role: 'coach',
      expiresAt: 10_000
    });

    expect(verifyRoomToken(token, 'test-secret', 1_000)).toEqual({
      roomCode: '123456',
      role: 'coach',
      expiresAt: 10_000
    });
  });

  it('rejects tampered tokens', () => {
    const token = createRoomToken({
      secret: 'test-secret',
      roomCode: '123456',
      role: 'catcher',
      expiresAt: 10_000
    });

    const [payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ roomCode: '123456', role: 'coach', expiresAt: 10_000 })
    ).toString('base64url');
    const tampered = `${tamperedPayload}.${signature}`;

    expect(() => verifyRoomToken(tampered, 'test-secret', 1_000)).toThrow(/invalid token/i);
  });
});
