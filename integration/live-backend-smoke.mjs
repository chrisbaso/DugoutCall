import WebSocket from '../server/node_modules/ws/index.js';

const baseUrl = (process.argv[2] ?? '').replace(/\/$/, '');
if (!baseUrl.startsWith('https://')) {
  throw new Error('usage: node integration/live-backend-smoke.mjs https://backend.example');
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requestJson = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { response, body };
};

const openSocket = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
});

const nextMessage = (socket) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('WebSocket message timed out')), 10_000);
  socket.once('message', (data) => {
    clearTimeout(timeout);
    resolve(JSON.parse(data.toString()));
  });
});

const { response: healthResponse, body: health } = await requestJson('/health');
assert(healthResponse.ok && health.ok === true, 'health endpoint failed');

const { response: configResponse, body: config } = await requestJson('/config');
assert(configResponse.ok && Array.isArray(config.iceServers) && config.iceServers.length > 0, 'client config failed');

const { response: createResponse, body: coach } = await requestJson('/rooms', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ coachName: 'Pilot Smoke Coach', teamName: 'Pilot Smoke', mode: 'game' })
});
assert(createResponse.status === 201, 'room creation failed');
assert(/^\d{6}$/.test(coach.code), 'room code does not have the expected shape');
assert(coach.token && coach.livekit?.serverUrl && coach.livekit?.token, 'coach signed room or LiveKit credential missing');

const { response: joinResponse, body: catcher } = await requestJson(`/rooms/${coach.code}/join`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'catcher', displayName: 'Pilot Smoke Catcher' })
});
assert(joinResponse.ok, 'catcher join failed');
assert(catcher.token && catcher.livekit?.serverUrl && catcher.livekit?.token, 'catcher signed room or LiveKit credential missing');

const wsUrl = baseUrl.replace(/^https:/, 'wss:');
const coachSocket = await openSocket(wsUrl);
const catcherSocket = await openSocket(wsUrl);
try {
  const coachAssigned = nextMessage(coachSocket);
  const catcherAssigned = nextMessage(catcherSocket);
  coachSocket.send(JSON.stringify({ type: 'join_room', code: coach.code, role: 'coach', token: coach.token, displayName: 'Pilot Smoke Coach' }));
  catcherSocket.send(JSON.stringify({ type: 'join_room', code: coach.code, role: 'catcher', token: catcher.token, displayName: 'Pilot Smoke Catcher' }));
  assert((await coachAssigned).role === 'coach', 'coach WebSocket role assignment failed');
  assert((await catcherAssigned).role === 'catcher', 'catcher WebSocket role assignment failed');

  const relayed = nextMessage(catcherSocket);
  coachSocket.send(JSON.stringify({
    type: 'pitch_call',
    id: 'live-smoke-call',
    pitch: 'Fastball',
    location: 'Away',
    spokenText: 'live smoke content',
    timestamp: Date.now()
  }));
  assert((await relayed).id === 'live-smoke-call', 'coach-to-catcher pitch relay failed');

  const catcherRejected = nextMessage(catcherSocket);
  catcherSocket.send(JSON.stringify({
    type: 'pitch_call',
    id: 'blocked-catcher-call',
    pitch: 'Fastball',
    location: 'Away',
    spokenText: 'must not relay',
    timestamp: Date.now()
  }));
  assert((await catcherRejected).type === 'error', 'catcher-to-coach call was not rejected');
} finally {
  coachSocket.close();
  catcherSocket.close();
}

const unauthorizedDiagnostics = await fetch(`${baseUrl}/rooms/${coach.code}/diagnostics`);
assert(!unauthorizedDiagnostics.ok, 'diagnostics allowed anonymous access');
const { response: diagnosticsResponse, body: diagnostics } = await requestJson(`/rooms/${coach.code}/diagnostics`, {
  headers: { authorization: `Bearer ${coach.token}` }
});
assert(diagnosticsResponse.ok, 'signed diagnostics request failed');
assert(!JSON.stringify(diagnostics).includes('live smoke content'), 'diagnostics retained spoken pitch content');

console.log(JSON.stringify({
  status: 'PASS',
  https: true,
  wss: true,
  room_code_shape: true,
  signed_roles: true,
  livekit_credentials: true,
  one_way_relay: true,
  diagnostics_protected_and_redacted: true
}));
