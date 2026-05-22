import { describe, expect, it } from 'vitest';
import { createLiveKitVoiceToken, createRoomToken, verifyRoomToken } from '../src/auth.js';

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

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

describe('livekit voice tokens', () => {
  it('returns null until LiveKit environment is configured', async () => {
    const previousUrl = process.env.LIVEKIT_URL;
    const previousKey = process.env.LIVEKIT_API_KEY;
    const previousSecret = process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    await expect(
      createLiveKitVoiceToken({
        roomCode: '123456',
        role: 'coach',
        participantId: 'coach-1',
        expiresAt: Date.now() + 60_000
      })
    ).resolves.toBeNull();

    restoreEnv('LIVEKIT_URL', previousUrl);
    restoreEnv('LIVEKIT_API_KEY', previousKey);
    restoreEnv('LIVEKIT_API_SECRET', previousSecret);
  });

  it('creates role-scoped LiveKit credentials when environment is configured', async () => {
    const previousUrl = process.env.LIVEKIT_URL;
    const previousKey = process.env.LIVEKIT_API_KEY;
    const previousSecret = process.env.LIVEKIT_API_SECRET;
    process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'devsecret';

    const livekit = await createLiveKitVoiceToken({
      roomCode: '123456',
      role: 'catcher',
      participantId: 'catcher-1',
      displayName: 'Catcher',
      expiresAt: Date.now() + 60_000
    });

    expect(livekit?.serverUrl).toBe('wss://example.livekit.cloud');
    expect(livekit?.roomName).toBe('dugoutcall-123456');
    expect(livekit?.token).toEqual(expect.any(String));

    restoreEnv('LIVEKIT_URL', previousUrl);
    restoreEnv('LIVEKIT_API_KEY', previousKey);
    restoreEnv('LIVEKIT_API_SECRET', previousSecret);
  });
});
