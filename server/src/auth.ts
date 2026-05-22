import crypto from 'node:crypto';
import { TrackSource } from '@livekit/protocol';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import type { UserRole } from './types.js';

export interface RoomTokenClaims {
  roomCode: string;
  role: UserRole;
  expiresAt: number;
}

interface CreateRoomTokenInput extends RoomTokenClaims {
  secret: string;
}

export interface LiveKitVoiceToken {
  serverUrl: string;
  token: string;
  roomName: string;
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

export async function createLiveKitVoiceToken(input: {
  roomCode: string;
  role: UserRole;
  participantId: string;
  displayName?: string;
  expiresAt: number;
}): Promise<LiveKitVoiceToken | null> {
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) return null;

  const roomName = `dugoutcall-${input.roomCode}`;
  const identity = `${input.role}-${input.participantId}`;
  const ttlSeconds = Math.max(60, Math.ceil((input.expiresAt - Date.now()) / 1000));
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: input.displayName ?? input.role,
    ttl: ttlSeconds
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: input.role === 'coach',
    canPublishSources: input.role === 'coach' ? [TrackSource.MICROPHONE] : [],
    canSubscribe: input.role === 'catcher',
    canPublishData: false
  };

  token.addGrant(grant);

  return {
    serverUrl,
    token: await token.toJwt(),
    roomName
  };
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
