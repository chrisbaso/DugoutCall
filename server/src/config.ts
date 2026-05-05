export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ClientConfig {
  appVersion: string;
  iceServers: RTCIceServerConfig[];
}

const defaultIceServers: RTCIceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export function parseIceServers(raw = process.env.DUGOUTCALL_ICE_SERVERS): RTCIceServerConfig[] {
  if (!raw?.trim()) return defaultIceServers;

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('DUGOUTCALL_ICE_SERVERS must be a JSON array');
  }

  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('ICE server entries must be objects');
    }
    const server = entry as RTCIceServerConfig;
    if (!server.urls || (typeof server.urls !== 'string' && !Array.isArray(server.urls))) {
      throw new Error('ICE server entry requires urls');
    }
    return server;
  });
}

export function buildClientConfig(input: {
  iceServersJson?: string;
  appVersion?: string;
} = {}): ClientConfig {
  return {
    appVersion: input.appVersion ?? process.env.npm_package_version ?? '0.1.0',
    iceServers: parseIceServers(input.iceServersJson)
  };
}
