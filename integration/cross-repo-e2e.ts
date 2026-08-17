import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { createDugoutCallApp } from '../server/src/app.js';
import { attachWebSocketServer } from '../server/src/websocket.js';
import { DiamondScoutClient } from '../mobile/src/diamondScout/client.js';
import { ScoutingCacheRepository, type LocalStore } from '../mobile/src/diamondScout/cache.js';
import { GameEventFactory } from '../mobile/src/diamondScout/gameSession.js';
import { OfflineEventQueue } from '../mobile/src/diamondScout/offlineQueue.js';
import { DevicePairingService, type SecretStore } from '../mobile/src/diamondScout/pairing.js';
import { DugoutRoomClient, roomSocketJoin } from '../mobile/src/dugoutCall/rooms.js';

class MemoryStore implements LocalStore, SecretStore {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  getItemAsync(key: string) { return this.getItem(key); }
  setItemAsync(key: string, value: string) { return this.setItem(key, value); }
  deleteItemAsync(key: string) { return this.removeItem(key); }
}

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const reservePort = () => new Promise<number>((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Unable to reserve port'));
    const port = address.port;
    server.close(() => resolve(port));
  });
});

const waitForFixture = (process: ChildProcessWithoutNullStreams) => new Promise<any>((resolve, reject) => {
  let output = '';
  const timeout = setTimeout(() => reject(new Error(`Diamond fixture startup timed out: ${output}`)), 20_000);
  process.stdout.on('data', (chunk) => {
    output += chunk.toString();
    const match = output.match(/READY (\{.*\})/);
    if (match) {
      clearTimeout(timeout);
      resolve(JSON.parse(match[1]!));
    }
  });
  process.stderr.on('data', (chunk) => { output += chunk.toString(); });
  process.once('exit', (code) => {
    clearTimeout(timeout);
    reject(new Error(`Diamond fixture exited ${code}: ${output}`));
  });
});

const waitForHealth = async (url: string) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Diamond fixture health check timed out');
};

const openSocket = (url: string) => new Promise<WebSocket>((resolve, reject) => {
  const socket = new WebSocket(url);
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
});

const nextMessage = (socket: WebSocket) => new Promise<any>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('WebSocket relay timed out')), 3_000);
  socket.once('message', (data) => {
    clearTimeout(timeout);
    resolve(JSON.parse(data.toString()));
  });
});

async function main() {
  const repo = path.resolve(process.cwd(), '..');
  const diamondRepo = path.resolve(process.env.DIAMOND_REPO ?? path.join(repo, '..', 'diamond-scout-assistant'));
  const diamondPort = await reservePort();
  const diamondUrl = `http://127.0.0.1:${diamondPort}`;
  const fixtureProcess = spawn(
    'python',
    [path.join(repo, 'integration', 'diamond_fixture_server.py'), diamondRepo, String(diamondPort)],
    { cwd: diamondRepo, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let roomServer: http.Server | undefined;
  let coachSocket: WebSocket | undefined;
  let catcherSocket: WebSocket | undefined;
  try {
    const fixture = await waitForFixture(fixtureProcess);
    await waitForHealth(diamondUrl);

    let ids = 0;
    const store = new MemoryStore();
    const pairing = new DevicePairingService(store, (credential) => new DiamondScoutClient(diamondUrl, credential), () => `install-${++ids}`);
    const paired = await pairing.pair(fixture.primary.pairing_code, 'E2E Coach iPhone');
    const diamond = new DiamondScoutClient(diamondUrl, paired.credential);
    const session = await diamond.session();
    assert(session.program.name === 'Synthetic Pilot Nine', 'pairing did not bind the expected program');
    assert(session.device?.id === paired.device.id, 'paired device was not returned by session');
    const games = await diamond.games();
    assert(games.length === 1, 'expected one synthetic upcoming game');
    const game = await diamond.createGame({
      client_game_id: 'fixture-1',
      opponent_id: fixture.primary.opponent_id,
      game_date: '2026-08-18',
      home_away: 'Home',
      location: 'Synthetic Pilot Field',
      lineup: fixture.primary.hitter_ids.map((hitter_id: number, index: number) => ({ slot: index + 1, hitter_id }))
    });
    const lineup = await diamond.lineupSummaries(game.game.id);
    assert(lineup.summaries.length === 2, 'canonical lineup summaries did not include no-data roster hitters');
    let current = await diamond.currentHitter(game.game.id);
    assert(current.lineup_slot === 1 && current.count.label === '0-0', 'first hitter/count was not server authoritative');

    const tokenSecret = 'synthetic-room-secret-at-least-32-characters';
    const roomApp = createDugoutCallApp({ tokenSecret });
    roomServer = http.createServer(roomApp.app);
    attachWebSocketServer(roomServer, roomApp.rooms, roomApp.diagnostics, tokenSecret);
    await new Promise<void>((resolve) => roomServer!.listen(0, '127.0.0.1', resolve));
    const roomAddress = roomServer.address();
    assert(roomAddress && typeof roomAddress !== 'string', 'room server did not bind');
    const roomUrl = `http://127.0.0.1:${roomAddress.port}`;
    const rooms = new DugoutRoomClient(roomUrl);
    const coachRoom = await rooms.create('Coach', session.program.name);
    const catcherRoom = await rooms.join(coachRoom.code, 'Catcher');
    assert(!JSON.stringify(catcherRoom).includes(paired.credential), 'catcher room payload leaked Diamond credential');

    const socketUrl = `ws://127.0.0.1:${roomAddress.port}`;
    coachSocket = await openSocket(socketUrl);
    catcherSocket = await openSocket(socketUrl);
    const coachAssigned = nextMessage(coachSocket);
    const catcherAssigned = nextMessage(catcherSocket);
    coachSocket.send(JSON.stringify(roomSocketJoin(coachRoom, 'coach', 'Coach')));
    catcherSocket.send(JSON.stringify(roomSocketJoin(catcherRoom, 'catcher', 'Catcher')));
    await Promise.all([coachAssigned, catcherAssigned]);

    const beforeCall = await diamond.game(game.game.id);
    const relayed = nextMessage(catcherSocket);
    coachSocket.send(JSON.stringify({
      type: 'pitch_call',
      id: 'call-only-1',
      pitch: 'Fastball',
      location: 'Away',
      spokenText: 'Fastball Away',
      timestamp: Date.now()
    }));
    assert((await relayed).id === 'call-only-1', 'catcher did not receive coach pitch call');
    const afterCall = await diamond.game(game.game.id);
    assert(
      afterCall.event_summary.accepted_events === beforeCall.event_summary.accepted_events,
      'pitch-call intent created Diamond statistical evidence'
    );

    const cache = new ScoutingCacheRepository(store);
    await cache.write(paired.device.id, game.game.id, { lineup, current });
    assert((await new ScoutingCacheRepository(store).read(paired.device.id, game.game.id)) !== null, 'cache did not survive repository restart');

    const queue = new OfflineEventQueue(store, () => Date.now());
    const enqueueOutcome = async (outcome: 'called_strike' | 'ball') => {
      const factory = new GameEventFactory(current, () => `evt-${++ids}`);
      const start = factory.beginPlateAppearance();
      const pitch = factory.confirmedPitch(outcome, undefined, 'call-only-1');
      if (start) await queue.enqueue(paired.device.id, game.game.id, start);
      await queue.enqueue(paired.device.id, game.game.id, pitch);
      await queue.flush(paired.device.id, (gameId, events) => diamond.postEvents(gameId, events), true);
      current = await diamond.currentHitter(game.game.id);
    };
    await enqueueOutcome('called_strike');
    assert(current.count.label === '0-1', 'confirmed strike did not update authoritative count');
    await enqueueOutcome('called_strike');
    assert(current.count.label === '0-2', 'second confirmed strike did not update authoritative count');
    await enqueueOutcome('called_strike');
    assert(current.lineup_slot === 2 && current.count.label === '0-0', 'resolved PA did not advance to next hitter');

    const offlineFactory = new GameEventFactory(current, () => `evt-${++ids}`);
    const offlineStart = offlineFactory.beginPlateAppearance();
    const offlinePitch = offlineFactory.confirmedPitch('ball');
    if (offlineStart) await queue.enqueue(paired.device.id, game.game.id, offlineStart);
    await queue.enqueue(paired.device.id, game.game.id, offlinePitch);
    await queue.flush(paired.device.id, async () => { throw new Error('synthetic network loss'); }, true);
    assert((await queue.list(paired.device.id)).length >= 1, 'offline outcomes were not retained');
    const restartedQueue = new OfflineEventQueue(store, () => Date.now() + 120_000);
    await restartedQueue.flush(paired.device.id, (gameId, events) => diamond.postEvents(gameId, events), true);
    current = await diamond.currentHitter(game.game.id);
    assert(current.count.label === '1-0', 'restored network did not drain ordered queue');
    await restartedQueue.enqueue(paired.device.id, game.game.id, offlinePitch);
    const replay = await restartedQueue.flush(paired.device.id, (gameId, events) => diamond.postEvents(gameId, events), true);
    assert(replay.synced === 1, 'idempotent replay was not treated as successful');

    const revoke = await fetch(`${diamondUrl}/__fixture/revoke?device_id=${encodeURIComponent(paired.device.id)}`, { method: 'POST' });
    assert(revoke.ok, 'fixture device revocation failed');
    let revoked = false;
    try { await diamond.session(); } catch { revoked = true; }
    assert(revoked, 'revoked device retained Diamond access');

    const secondPaired = await pairing.pair(fixture.secondary.pairing_code, 'Second E2E iPhone');
    const secondSession = await new DiamondScoutClient(diamondUrl, secondPaired.credential).session();
    assert(secondSession.program.name === 'Second Synthetic Nine', 'second organization pairing failed');
    assert(await cache.read(secondPaired.device.id, game.game.id) === null, 'first organization cache appeared under second device scope');

    const diagnostics = roomApp.diagnostics.snapshot(coachRoom.code);
    assert(!diagnostics.recentEvents.some((event) => event.detail === 'Fastball Away'), 'diagnostics retained spoken pitch content');
    console.log(JSON.stringify({
      status: 'PASS',
      diamond_contract: session.schema_version,
      room_code_shape: /^\d{6}$/.test(coachRoom.code),
      call_only_stat_protection: true,
      authoritative_count: current.count.label,
      queue_restart: true,
      revocation: true,
      cache_isolation: true
    }));
  } finally {
    coachSocket?.close();
    catcherSocket?.close();
    if (roomServer) await new Promise<void>((resolve) => roomServer!.close(() => resolve()));
    fixtureProcess.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
