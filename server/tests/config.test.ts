import { describe, expect, it } from 'vitest';
import { buildClientConfig, parseIceServers } from '../src/config.js';

describe('client config', () => {
  it('uses public STUN by default', () => {
    expect(parseIceServers()).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('parses JSON ICE server configuration for TURN deployments', () => {
    const raw = JSON.stringify([
      {
        urls: ['turn:relay.example.com:3478'],
        username: 'dugout',
        credential: 'secret'
      }
    ]);

    expect(parseIceServers(raw)).toEqual([
      {
        urls: ['turn:relay.example.com:3478'],
        username: 'dugout',
        credential: 'secret'
      }
    ]);
  });

  it('builds a safe client config without exposing server secrets', () => {
    const config = buildClientConfig({
      iceServersJson: '[{"urls":"stun:example.com:19302"}]',
      appVersion: 'demo'
    });

    expect(config).toEqual({
      appVersion: 'demo',
      iceServers: [{ urls: 'stun:example.com:19302' }]
    });
    expect(JSON.stringify(config)).not.toContain('DUGOUTCALL_TOKEN_SECRET');
  });
});
